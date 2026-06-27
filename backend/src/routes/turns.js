/**
 * routes/turns.js
 *
 * Двухфазная обработка хода (см. docs/03-known-tradeoffs.md — Вариант A, выбран).
 *
 * POST /games/:gameId/turns/preview
 *   -> вызывает ИИ-геймместера, валидирует ответ, сохраняет классификацию
 *      в Redis (pending-turns.js) с TTL. НИЧЕГО не пишет в Postgres.
 *   -> возвращает { narrative, advisorObjection, statDeltasPreview } игроку
 *      для подтверждения. statDeltasPreview считается тем же rules-engine,
 *      но не применяется — это просто "что будет, если подтвердишь".
 *
 * POST /games/:gameId/turns/confirm
 *   -> читает pending-классификацию из Redis по gameId.
 *   -> если её нет (истёк TTL / не было preview) — 409, просит сделать preview заново.
 *   -> применяет rules-engine, пишет turn/game_state/newsfeed в Postgres
 *      в одной транзакции, как раньше.
 *   -> очищает pending-запись в Redis.
 *
 * POST /games/:gameId/turns/cancel
 *   -> игрок передумал после возражения советника. Просто чистит Redis.
 */

const { classifyTurn } = require("../ai/gamemaster");
const { verifyToken } = require("../middleware/auth");

/**
 * Проверяет победные/поражения условия после каждого хода.
 * Возвращает строку-статус или null если игра продолжается.
 *
 * Условия победы (ход 24):
 *   - peace_progress >= 100 + economy >= 55 + approval >= 60 + stability >= 60 → "victory"
 *   - peace_progress < 100 но economy/approval/stability в норме → "partial"
 *   - peace_progress >= 100 но статы не дотянули → "partial_peace"
 *
 * Условия поражения (в любой ход):
 *   - approval < 25 → "defeat_coup"
 *   - economy < 30  → "defeat_collapse"
 *   - stability < 20 → "defeat_unrest"
 */
function detectGameOutcome(stats, turnNumber, maxTurns) {
  // Поражение — проверяем каждый ход
  if (stats.approval < 25)   return "defeat_coup";
  if (stats.economy < 30)    return "defeat_collapse";
  if (stats.stability < 20)  return "defeat_unrest";

  // Победа — только по истечении срока
  if (turnNumber >= maxTurns) {
    const peace = (stats.peace_progress ?? 0) >= 100;
    const statsOk = stats.economy >= 55 && stats.approval >= 60 && stats.stability >= 60;
    if (peace && statsOk) return "victory";
    if (peace && !statsOk) return "partial_peace";
    if (!peace && statsOk)  return "partial";
    return "defeat_time";
  }

  return null;
}
const { applyTurn, computeDelayedEffectDelta, DECREE_DURATION, CRISIS_TURN_WEEKS, NORMAL_TURN_WEEKS } = require("../rules/rules-engine");
const { generateWorldUpdate } = require("../ai/worldUpdate");

// Вычисляет новую дату игры (+1 месяц в обычном режиме, +2 недели в кризисном)
function advanceGameDate(currentDateStr, crisisMode) {
  try {
    const d = new Date(currentDateStr);
    if (isNaN(d)) throw new Error("invalid");
    if (crisisMode) {
      d.setDate(d.getDate() + CRISIS_TURN_WEEKS * 7);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return currentDateStr;
  }
}

async function registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore }) {
  async function loadGameForUpdate(client, gameId) {
    const res = await client.query(
      `SELECT g.*, gs.stats, gs.relations, gs.policies, gs.delayed_effects, gs.overview, c.name AS country_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       WHERE g.id = $1 FOR UPDATE`,
      [gameId]
    );
    return res.rows[0] || null;
  }

  // ---------- PREVIEW ----------
  fastify.post("/games/:gameId/turns/preview", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { playerInput, actionMode = "decree" } = request.body;

    if (!playerInput || typeof playerInput !== "string" || playerInput.trim().length === 0) {
      return reply.code(400).send({ error: "playerInput is required" });
    }
    const VALID_MODES = ["decree", "decree_fast", "decree_reform", "decree_program", "crisis", "intel", "military"];
    if (!VALID_MODES.includes(actionMode)) {
      return reply.code(400).send({ error: `actionMode must be one of: ${VALID_MODES.join("|")}` });
    }

    // Проверяем хватает ли инициативы
    const { INITIATIVE_COST, INITIATIVE_REGEN_PER_TURN, INITIATIVE_MAX } = require("../rules/rules-engine");
    const initiativeCheck = await db.query(`SELECT gs.stats FROM game_state gs WHERE gs.game_id = $1`, [gameId]);
    if (initiativeCheck.rowCount > 0) {
      const currentStats = initiativeCheck.rows[0].stats;
      const currentInit = typeof currentStats.initiative === "number" ? currentStats.initiative : INITIATIVE_MAX;
      const regenedInit = Math.min(INITIATIVE_MAX, currentInit + INITIATIVE_REGEN_PER_TURN);
      const cost = INITIATIVE_COST[actionMode];
      if (regenedInit < cost) {
        return reply.code(400).send({ error: `Недостаточно инициативы. Нужно ${cost}, доступно ~${regenedInit}. Подождите следующего хода.` });
      }
    }

    // Только чтение — без FOR UPDATE, не открываем долгую транзакцию на время вызова ИИ
    const gameRes = await db.query(
      `SELECT g.current_turn, gs.stats, gs.relations, gs.policies, gs.delayed_effects, gs.overview,
              c.name AS country_name, u.display_name AS player_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       LEFT JOIN users u ON u.id = g.owner_user_id
       WHERE g.id = $1`,
      [gameId]
    );

    if (gameRes.rowCount === 0) {
      return reply.code(404).send({ error: "Game not found" });
    }

    const game = gameRes.rows[0];
    const nextTurnNumber = game.current_turn + 1;

    const dueEffects = (game.delayed_effects || []).filter((e) => e.trigger_turn <= nextTurnNumber);
    const remainingEffects = (game.delayed_effects || []).filter((e) => e.trigger_turn > nextTurnNumber);

    let statsAfterDelayed = { ...game.stats };
    for (const effect of dueEffects) {
      for (const [stat, delta] of Object.entries(effect.effect || {})) {
        statsAfterDelayed[stat] = Math.max(0, Math.min(100, (statsAfterDelayed[stat] || 0) + delta));
      }
    }

    const effectiveActionMode = /ядерн|термоядер|nuclear|атомн.*удар/i.test(playerInput) ? "military" : actionMode;

    const gmClassification = await classifyTurn({
      params: {
        countryName: game.country_name,
        playerName: game.player_name || null,
        gameDate: game.overview?.date || "—",
        turnNumber: nextTurnNumber,
        currentState: { stats: statsAfterDelayed, relations: game.relations },
        activePolicies: game.policies,
        delayedEffects: remainingEffects,
        playerInput,
        actionMode: effectiveActionMode,
      },
      callClaudeApi,
    });

    // Intel RNG: случайный исход разведывательной операции
    if (gmClassification.action_type === "intelligence_covert" || effectiveActionMode === "intel") {
      const roll = Math.random();
      let intelOutcome, outcomeLabel;
      if (roll < 0.08) {
        intelOutcome = "intel_critical_failure";
        outcomeLabel = "ПРОВАЛ — агент задержан";
      } else if (roll < 0.25) {
        intelOutcome = "intel_failure";
        outcomeLabel = "Операция провалена";
      } else if (roll < 0.80) {
        intelOutcome = "intelligence_covert"; // норма
        outcomeLabel = null;
      } else if (roll < 0.95) {
        intelOutcome = "intel_success";
        outcomeLabel = "Операция успешна";
      } else {
        intelOutcome = "intel_critical_success";
        outcomeLabel = "БЛЕСТЯЩАЯ ОПЕРАЦИЯ";
      }
      if (intelOutcome !== "intelligence_covert") {
        gmClassification.action_type = intelOutcome;
        if (outcomeLabel) {
          gmClassification.narrative = `[${outcomeLabel}] ${gmClassification.narrative || ""}`.trim();
        }
        if (intelOutcome === "intel_failure" || intelOutcome === "intel_critical_failure") {
          gmClassification.advisor_objection = gmClassification.advisor_objection ||
            "Директор СВР: Операция скомпрометирована. Необходимо немедленно отозвать агентурную сеть во избежание дальнейших потерь.";
        }
      }
    }

    // Защита: если AI вернул null_action при явном упоминании ядерного оружия — форсируем nuclear_strike
    const NUCLEAR_RE = /ядерн|термоядер|nuclear|атомн.*удар/i;
    if (gmClassification.action_type === "null_action" && NUCLEAR_RE.test(playerInput)) {
      gmClassification.action_type = "nuclear_strike";
      gmClassification.severity = 3;
      gmClassification.advisor_objection = gmClassification.advisor_objection ||
        "Начальник Генерального штаба: Господин Президент, это решение необратимо. Применение ядерного оружия повлечёт немедленный международный ответ и, вероятно, ядерный удар по нашей территории.";
      if (!gmClassification.narrative || gmClassification.narrative.includes("уточнение") || gmClassification.narrative.includes("не зафиксировано")) {
        gmClassification.narrative = `Приказ о применении ядерного оружия зафиксирован. Штаб Верховного Главнокомандующего переведён в режим боевого дежурства. Мир стоит на пороге ядерной катастрофы впервые с 1945 года.`;
      }
    }

    // Считаем превью дельт ТЕМ ЖЕ rules-engine — то, что увидит игрок,
    // должно совпадать 1:1 с тем, что применится при confirm (тот же seed).
    const { statDeltas, relationDeltas } = applyTurn({
      state: { stats: statsAfterDelayed, relations: game.relations },
      gmClassification,
      gameId,
      turnNumber: nextTurnNumber,
      actionMode,
    });

    await pendingTurnStore.save(gameId, {
      gmClassification,
      turnNumber: nextTurnNumber,
      statsAfterDelayed,
      remainingEffects,
      actionMode,
    });

    return reply.send({
      turnNumber: nextTurnNumber,
      narrative: gmClassification.narrative,
      advisorObjection: gmClassification.advisor_objection,
      statDeltasPreview: statDeltas,
      relationDeltasPreview: relationDeltas,
      gmActionType: gmClassification.action_type,
      requiresConfirmation: true,
    });
  });

  // ---------- CONFIRM ----------
  fastify.post("/games/:gameId/turns/confirm", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const pending = await pendingTurnStore.get(gameId);
    if (!pending) {
      return reply.code(409).send({
        error: "No pending turn found (expired or never previewed). Call /turns/preview first.",
      });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const game = await loadGameForUpdate(client, gameId);
      if (!game) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Game not found" });
      }

      // Защита от рассинхрона: если current_turn успел измениться с момента
      // preview (например другой клиент того же игрока), отклоняем confirm.
      if (game.current_turn + 1 !== pending.turnNumber) {
        await client.query("ROLLBACK");
        await pendingTurnStore.clear(gameId);
        return reply.code(409).send({
          error: "Game state changed since preview. Call /turns/preview again.",
        });
      }

      const { gmClassification, turnNumber, statsAfterDelayed, remainingEffects, actionMode: pendingActionMode = "decree" } = pending;

      const crisisMode = !!(game.stats?.crisis_mode || game.overview?.crisis_mode);

      const { newStats, newRelations, statDeltas, relationDeltas } = applyTurn({
        state: { stats: statsAfterDelayed, relations: game.relations },
        gmClassification,
        gameId,
        turnNumber,
        actionMode: pendingActionMode,
        crisisMode,
      });

      // Автоматический выход из кризиса если стабильность восстановилась
      if (crisisMode && newStats.stability >= 40) {
        newStats.crisis_mode = false;
      } else if (crisisMode) {
        newStats.crisis_mode = true;
      }
      // Автоматический вход в кризис
      if (!crisisMode && newStats.stability < 25) {
        newStats.crisis_mode = true;
      }

      // Сдвигаем дату игры
      const currentGameDate = game.overview?.date;
      const newGameDate = currentGameDate ? advanceGameDate(currentGameDate, crisisMode) : null;

      const newDelayedEffects = (gmClassification.delayed_effects || []).map((e, idx) => {
        const delta = computeDelayedEffectDelta({
          category: gmClassification.action_type,
          stat: e.stat,
          gameId,
          turnNumber,
          effectIndex: idx,
        });
        return {
          trigger_turn: turnNumber + e.trigger_turn_offset,
          effect: { [e.stat]: delta },
          reason: e.reason,
        };
      });

      const updatedDelayedEffects = [...remainingEffects, ...newDelayedEffects];

      await client.query(
        `INSERT INTO turns (game_id, turn_n, player_input, action_mode, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection, stats_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          gameId,
          turnNumber,
          request.body?.playerInput || "(см. gm_classification)",
          pendingActionMode,
          JSON.stringify(gmClassification),
          JSON.stringify(statDeltas),
          JSON.stringify(relationDeltas),
          gmClassification.narrative,
          gmClassification.advisor_objection,
          JSON.stringify(newStats),
        ]
      );

      let updatedPolicies = game.policies || [];
      if (gmClassification.policy_update?.is_new_policy) {
        const policyDuration = gmClassification.policy_update.duration_turns || DECREE_DURATION[pendingActionMode] || 5;
        updatedPolicies = [
          ...updatedPolicies,
          {
            title: gmClassification.policy_update.title,
            turn: turnNumber,
            target_turn: turnNumber + policyDuration,
            duration_turns: policyDuration,
            status: "active",
            items: gmClassification.policy_update.items || [],
            completion_conditions: gmClassification.policy_update.completion_conditions || null,
            newsfeed_keyword: gmClassification.policy_update.title,
          },
        ];
      }

      // Обновляем дату в overview
      let updatedOverview = game.overview || {};
      if (newGameDate) updatedOverview = { ...updatedOverview, date: newGameDate };
      if (newStats.crisis_mode !== undefined) {
        updatedOverview = { ...updatedOverview, crisis_mode: newStats.crisis_mode };
      }

      await client.query(
        `UPDATE game_state
         SET stats = $1, relations = $2, policies = $3, delayed_effects = $4, overview = $5, updated_at = now()
         WHERE game_id = $6`,
        [JSON.stringify(newStats), JSON.stringify(newRelations), JSON.stringify(updatedPolicies), JSON.stringify(updatedDelayedEffects), JSON.stringify(updatedOverview), gameId]
      );

      await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);

      // Для тайных операций — без публичных комментариев, только внутренний брифинг
      const isSecret = pendingActionMode === "intel";
      const isDecree = pendingActionMode.startsWith("decree") || pendingActionMode === "crisis";
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          gameId,
          turnNumber,
          isSecret ? "news" : (gmClassification.policy_update?.is_new_policy ? "decree" : "news"),
          isSecret ? "Служба внешней разведки" : (isDecree ? "Президентский указ" : "Брифинг штаба"),
          isSecret ? `[СЕКРЕТНО] ${gmClassification.narrative}` : gmClassification.narrative,
          isSecret ? "[]" : JSON.stringify(gmClassification.newsfeed_reactions || []),
        ]
      );

      // Записываем снапшот для лидерборда (score = среднее ключевых показателей)
      const scoreKeys = ["stability", "economy", "military", "diplomacy", "approval"];
      const scoreVals = scoreKeys.map(k => newStats[k] ?? 50);
      const score = Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length);
      const scoreBreakdown = Object.fromEntries(scoreKeys.map(k => [k, newStats[k] ?? 50]));
      await client.query(
        `INSERT INTO leaderboard_snap (game_id, turn_n, score, score_breakdown)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [gameId, turnNumber, score, JSON.stringify(scoreBreakdown)]
      );

      await client.query("COMMIT");
      await pendingTurnStore.clear(gameId);

      // Применяем события геймастера (если есть) — после основной транзакции
      if (adminEventStore) {
        const adminEvents = await adminEventStore.popAll(gameId);
        for (const ev of adminEvents) {
          try {
            // Применяем stat deltas
            if (ev.statDeltas && Object.keys(ev.statDeltas).length > 0) {
              const statsRes = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
              if (statsRes.rowCount > 0) {
                const currentStats = statsRes.rows[0].stats;
                const patched = { ...currentStats };
                for (const [k, v] of Object.entries(ev.statDeltas)) {
                  if (typeof patched[k] === "number") {
                    patched[k] = Math.min(100, Math.max(0, patched[k] + v));
                  }
                }
                await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(patched), gameId]);
              }
            }
            // Добавляем в ленту (если не secret)
            if (!ev.secret) {
              await db.query(
                `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
                 VALUES ($1, $2, 'reaction', $3, $4, '[]')`,
                [gameId, turnNumber, ev.source || "Внешний источник", ev.text]
              );
            }
          } catch (evErr) {
            fastify.log.error({ evErr }, "Failed to apply admin event");
          }
        }
      }

      // Запускаем обновление мира ПОСЛЕ транзакции — не блокирует ответ игроку.
      // Результат (новый overview + реакции стран) сохраняется в БД асинхронно
      // и будет виден при следующем GET /games/:id (который фронт делает сразу после confirm).
      generateWorldUpdate({
        params: {
          countryName: game.country_name,
          turnNumber,
          actionType: gmClassification.action_type,
          playerInput: gmClassification.narrative,
          narrative: gmClassification.narrative,
          statDeltas,
          relationDeltas,
          currentStats: newStats,
          currentRelations: newRelations,
          prevOverview: game.overview || {},
        },
        callClaudeApi,
      }).then(async (worldUpdate) => {
        const isNuclearAction = gmClassification.action_type === "nuclear_strike";
        // Если worldUpdate упал и это был ядерный удар — пишем минимальные реакции-заглушки
        if (!worldUpdate) {
          if (isNuclearAction) {
            const fallbackReactions = [
              { source: "Совет Безопасности ООН", text: "Экстренное заседание СБ ООН созвано в связи с применением ядерного оружия. Мировое сообщество потрясено.", escalation: 1 },
              { source: "США / НАТО", text: "Президент США: «Это беспрецедентный акт агрессии. Мы рассматриваем все варианты ответа, включая применение ядерного оружия». НАТО переведено в DEFCON 2.", escalation: 3 },
              { source: "Китай", text: "МИД КНР осудил применение ядерного оружия и потребовал немедленного прекращения огня. Китай приводит собственные ядерные силы в повышенную готовность.", escalation: 2 },
              { source: "Мировые рынки", text: "Фондовые биржи рухнули. Нефть взлетела до исторического максимума. Международная торговля парализована.", escalation: 1 },
            ];
            for (const r of fallbackReactions) {
              await db.query(
                `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, 'nuclear_reaction', $3, $4, $5)`,
                [gameId, turnNumber, r.source, r.text, JSON.stringify([{ escalation: r.escalation }])]
              );
            }
          }
          return;
        }
        try {
          // Обновляем overview
          if (worldUpdate.overview) {
            await db.query(
              `UPDATE game_state SET overview = $1, updated_at = now() WHERE game_id = $2`,
              [JSON.stringify({ ...worldUpdate.overview, turn: turnNumber }), gameId]
            );
          }
          // Добавляем реакции стран в ленту
          const isNuclearUpdate = (worldUpdate.world_reactions || []).some(r => r.escalation);
          const reactionItemType = isNuclearUpdate ? "nuclear_reaction" : "reaction";
          const sortedReactions = isNuclearUpdate
            ? [...(worldUpdate.world_reactions || [])].sort((a, b) => (a.escalation || 1) - (b.escalation || 1))
            : (worldUpdate.world_reactions || []);
          for (const reaction of sortedReactions) {
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [gameId, turnNumber, reactionItemType, reaction.source, reaction.text,
               reaction.escalation ? JSON.stringify([{ escalation: reaction.escalation }]) : "[]"]
            );
          }
          // Добавляем ходы других стран + применяем stat_delta
          const VALID_STATS = new Set(["economy", "military", "stability", "diplomacy", "approval"]);
          for (const move of worldUpdate.world_moves || []) {
            const statDelta = move.stat_delta && typeof move.stat_delta === "object" ? move.stat_delta : {};
            // Валидируем и клэмпим delta
            const safeDelta = {};
            for (const [k, v] of Object.entries(statDelta)) {
              if (VALID_STATS.has(k) && typeof v === "number") {
                safeDelta[k] = Math.max(-5, Math.min(5, Math.round(v)));
              }
            }
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, 'world_move', $3, $4, $5)`,
              [gameId, turnNumber, move.country, move.action, JSON.stringify([{
                user: "Аналитик", text: move.impact,
                tone: move.direction === "hostile" ? "neg" : move.direction === "cooperative" ? "pos" : "neutral",
                stat_delta: safeDelta,
              }])]
            );
            // Применяем stat_delta к game_state
            if (Object.keys(safeDelta).length > 0) {
              const stateRow = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
              if (stateRow.rows[0]) {
                const cur = stateRow.rows[0].stats || {};
                const updated = { ...cur };
                for (const [k, v] of Object.entries(safeDelta)) {
                  updated[k] = Math.max(0, Math.min(100, (cur[k] ?? 50) + v));
                }
                await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
                  [JSON.stringify(updated), gameId]);
              }
            }
          }
        } catch (err) {
          fastify.log.error({ err }, "worldUpdate DB write failed");
        }
      }).catch((err) => fastify.log.error({ err }, "worldUpdate failed"));

      // Win/loss/partial outcome detection
      const MAX_TURNS = 24;
      const gameOutcome = detectGameOutcome(newStats, turnNumber, MAX_TURNS);
      if (gameOutcome) {
        await client.query(`UPDATE games SET status = $1, updated_at = now() WHERE id = $2`, [gameOutcome, gameId]);
      }

      return reply.send({
        turnNumber,
        narrative: gmClassification.narrative,
        statDeltas,
        relationDeltas,
        newStats,
        newRelations,
        gameOutcome: gameOutcome || null,
        maxTurns: MAX_TURNS,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Internal error confirming turn" });
    } finally {
      client.release();
    }
  });

  // ---------- CANCEL ----------
  fastify.post("/games/:gameId/turns/cancel", async (request, reply) => {
    const { gameId } = request.params;
    await pendingTurnStore.clear(gameId);
    return reply.send({ cancelled: true });
  });

  // ---------- SKIP (пропустить ход) ----------
  // Быстрый ход без ИИ: null_action + бонусная регенерация инициативы
  fastify.post("/games/:gameId/turns/skip", async (request, reply) => {
    const { gameId } = request.params;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const turnNumber = game.current_turn + 1;
      const currentStats = game.stats || {};
      const { INITIATIVE_MAX, INITIATIVE_SKIP_REGEN, applyTurn } = require("../rules/rules-engine");

      // Применяем null_action через rules-engine — штрафы к статам + бонусная регенерация инициативы
      const { newStats, statDeltas } = applyTurn({
        state: { stats: currentStats, relations: game.relations || [] },
        gmClassification: { action_type: "null_action", severity: 2, affected_relations: [] },
        gameId,
        turnNumber,
        actionMode: "skip",
      });

      // Пропуск: инициатива не тратится, а восстанавливается на INITIATIVE_SKIP_REGEN
      const currentInit = typeof currentStats.initiative === "number" ? currentStats.initiative : INITIATIVE_MAX;
      newStats.initiative = Math.min(INITIATIVE_MAX, currentInit + INITIATIVE_SKIP_REGEN);
      statDeltas.initiative = newStats.initiative - currentInit;

      const narrative = "Президент бездействует. Страна теряет темп — рейтинг и экономика проседают.";

      await client.query(
        `INSERT INTO turns (game_id, turn_n, player_input, action_mode, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection, stats_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [gameId, turnNumber, "[Пропуск хода]", "decree",
          JSON.stringify({ action_type: "null_action", severity: 2 }),
          JSON.stringify(statDeltas),
          "[]", narrative, null, JSON.stringify(newStats)]
      );
      await client.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);
      await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);
      await client.query("COMMIT");

      return reply.send({
        turnNumber,
        narrative,
        statDeltas,
        skipped: true,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Skip failed" });
    } finally {
      client.release();
    }
  });
  // GET /games/:gameId/stat-history — история всех статов по ходам
  fastify.get("/games/:gameId/stat-history", async (request, reply) => {
    const { gameId } = request.params;
    const res = await db.query(
      `SELECT turn_n, stats_snapshot, stat_deltas, gm_classification->>'action_type' AS action_type
       FROM turns WHERE game_id = $1 AND stats_snapshot IS NOT NULL ORDER BY turn_n ASC`,
      [gameId]
    );
    return reply.send({ history: res.rows });
  });

  // GET /games/:gameId/policy-news?keyword=X — новости связанные с политикой
  fastify.get("/games/:gameId/policy-news", async (request, reply) => {
    const { gameId } = request.params;
    const { keyword } = request.query;
    const res = await db.query(
      `SELECT turn_n, item_type, source, text, created_at FROM newsfeed_items
       WHERE game_id = $1 AND ($2::text IS NULL OR text ILIKE $3 OR source ILIKE $3)
       ORDER BY turn_n DESC LIMIT 20`,
      [gameId, keyword || null, keyword ? `%${keyword}%` : null]
    );
    return reply.send({ items: res.rows });
  });

  // POST /games/:gameId/cancel-policy — отменить активную политику
  fastify.post("/games/:gameId/cancel-policy", async (request, reply) => {
    const { gameId } = request.params;
    const { policyTitle } = request.body || {};
    if (!policyTitle) return reply.code(400).send({ error: "policyTitle required" });

    const gsRes = await db.query(`SELECT policies, stats FROM game_state WHERE game_id = $1`, [gameId]);
    if (gsRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });

    const policies = gsRes.rows[0].policies || [];
    const updated = policies.map(p =>
      p.title === policyTitle ? { ...p, status: "cancelled" } : p
    );

    // Небольшой штраф за отмену: стабильность -2, рейтинг -1
    const stats = { ...gsRes.rows[0].stats };
    stats.stability = Math.max(0, (stats.stability || 50) - 2);
    stats.approval = Math.max(0, (stats.approval || 50) - 1);

    await db.query(
      `UPDATE game_state SET policies = $1, stats = $2, updated_at = now() WHERE game_id = $3`,
      [JSON.stringify(updated), JSON.stringify(stats), gameId]
    );

    const gameRes = await db.query(`SELECT current_turn FROM games WHERE id = $1`, [gameId]);
    const turnN = gameRes.rows[0]?.current_turn || 0;
    await db.query(
      `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
      [gameId, turnN, "Кремль", `Указ «${policyTitle}» отменён. Стабильность и рейтинг снижены.`]
    );

    return reply.send({ ok: true, statPenalty: { stability: -2, approval: -1 } });
  });
}

module.exports = { registerTurnRoutes };
