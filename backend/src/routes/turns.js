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
// verifyToken injected via options

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
  if (stats.approval < 30)   return "defeat_coup";       // повысили порог с 25
  if (stats.economy < 35)    return "defeat_collapse";   // повысили с 30
  if (stats.stability < 25)  return "defeat_unrest";     // повысили с 20
  if ((stats.diplomacy ?? 50) < 15) return "defeat_isolation"; // новый тип: изоляция
  if ((stats.war_escalation_counter ?? 0) >= 3) return "defeat_war"; // спираль войны

  // Военная победа: доступна с хода 8
  // Полный контроль над Донбассом + ещё минимум 2 региона + армия держится + дом не развалился
  if (turnNumber >= 8) {
    const militaryDominance = (stats.military ?? 50) >= 85;
    const armyReady = (stats.army_morale ?? 50) >= 70 && (stats.readiness ?? 50) >= 70;
    const homeStable = (stats.stability ?? 50) >= 52 && (stats.approval ?? 50) >= 52;
    const economyHolds = (stats.economy ?? 50) >= 36; // war economy — lower bar, just above collapse
    // Территориальные условия: Донбасс (оба) + хотя бы ещё два региона
    const donbassSecured = (stats.donetsk_control ?? 0) >= 92 && (stats.luhansk_control ?? 0) >= 98;
    const otherRegions = [
      (stats.zaporizhzhia_control ?? 0) >= 85,
      (stats.kherson_control ?? 0) >= 80,
      (stats.kharkiv_control ?? 0) >= 65,
    ].filter(Boolean).length;
    if (militaryDominance && armyReady && homeStable && economyHolds && donbassSecured && otherRegions >= 2) {
      return "victory_military";
    }
  }

  // Досрочная мирная победа: доступна начиная с хода 12
  if (turnNumber >= 12) {
    const peace = (stats.peace_progress ?? 0) >= 100;
    const statsOk = stats.economy >= 65 && stats.approval >= 65 && stats.stability >= 65;
    if (peace && statsOk) return "victory";
  }

  // Победа по истечении срока
  if (turnNumber >= maxTurns) {
    const peace = (stats.peace_progress ?? 0) >= 100;
    const statsOk = stats.economy >= 65 && stats.approval >= 65 && stats.stability >= 65;
    if (peace && statsOk) return "victory";
    if (peace && !statsOk) return "partial_peace";
    if (!peace && statsOk)  return "partial";
    // Военное доминирование без полной победы — частичный результат
    if ((stats.military ?? 50) >= 80) return "partial_military";
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

async function registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore, verifyToken }) {
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

      // --- ТЕРРИТОРИАЛЬНЫЙ КОНТРОЛЬ ---
      // military_offensive продвигает фронт, peace/diplomacy могут фиксировать или уступать территории
      {
        const TERRITORY_KEYS = ["donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"];
        const TERRITORY_HARDNESS = { donetsk: 1.0, luhansk: 0.6, zaporizhzhia: 1.2, kherson: 1.3, kharkiv: 1.5 };
        const at = gmClassification.action_type;
        const sev = gmClassification.severity || 2;

        if (at === "military_offensive") {
          // Прогресс зависит от армии и severity
          const armyQuality = ((newStats.army_morale ?? 50) + (newStats.readiness ?? 50) + (newStats.equipment ?? 50)) / 3;
          const baseGain = sev * 3 + Math.max(0, (armyQuality - 60) / 5); // 3-12 pts
          for (const key of TERRITORY_KEYS) {
            const regionName = key.replace("_control", "");
            const hardness = TERRITORY_HARDNESS[regionName] || 1.0;
            const current = newStats[key] ?? 50;
            if (current < 100) {
              // Труднее брать уже занятые территории и более укреплённые
              const effectiveness = Math.max(0.1, 1 - (current / 100) * 0.5);
              const gain = Math.round((baseGain / hardness) * effectiveness);
              newStats[key] = Math.min(100, current + Math.max(1, gain));
            }
          }
        } else if (at === "military_defensive") {
          // Оборона — удержание. Небольшое восстановление потерянных позиций
          for (const key of TERRITORY_KEYS) {
            const current = newStats[key] ?? 50;
            if (current < 60 && current > 0) {
              newStats[key] = Math.min(60, current + 2);
            }
          }
        } else if (at === "peace_initiative" || at === "diplomacy_outreach") {
          // Мирный трек — незначительные уступки на спорных территориях
          const concession = sev === 3 ? 4 : sev === 2 ? 2 : 1;
          for (const key of ["kharkiv_control", "kherson_control"]) {
            const current = newStats[key] ?? 50;
            // Уступаем только спорное — не более 20 пунктов за всю игру
            if (current > 5) {
              newStats[key] = Math.max(5, current - concession);
            }
          }
        } else if (at === "diplomacy_confrontation") {
          // Жёсткая риторика — обострение, мелкие тактические потери
          const kh = "kharkiv_control";
          const current = newStats[kh] ?? 12;
          newStats[kh] = Math.max(0, current - 3);
        } else if (at === "null_action") {
          // Бездействие — контрнаступление Украины на спорных направлениях
          for (const key of ["kharkiv_control", "kherson_control"]) {
            const current = newStats[key] ?? 50;
            newStats[key] = Math.max(0, current - 3);
          }
          newStats["zaporizhzhia_control"] = Math.max(0, (newStats["zaporizhzhia_control"] ?? 68) - 1);
        }
      }
      // --- конец территорий ---

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

      // --- ЕСТЕСТВЕННЫЙ РАСПАД МИРНОГО ТРЕКА ---
      // Если игрок не делает дипломатию/мирные инициативы — мир сам по себе распадается
      {
        const peaceDiplomacyActions = new Set(["diplomacy_outreach", "peace_initiative", "diplomacy_confrontation"]);
        const isActiveDiplomacy = peaceDiplomacyActions.has(gmClassification.action_type);
        if (!isActiveDiplomacy && (newStats.peace_progress ?? 0) > 5) {
          const decay = gmClassification.action_type === "military_offensive" ? 7 : 4;
          newStats.peace_progress = Math.max(0, (newStats.peace_progress ?? 0) - decay);
        }
      }

      // --- ВОЕННЫЙ БЛОУЭФФЕКТ ---
      // Военные наступления с вероятностью 35% вызывают эскалацию и международное осуждение
      if (gmClassification.action_type === "military_offensive" && Math.random() < 0.35) {
        const BLOWBACK_EVENTS = [
          { source: "AP", penalty: 8, diplomacyDelta: -5, approvalDelta: -4,
            text: "Международный суд ООН открыл расследование в связи с последними военными операциями. Верховный комиссар по правам человека ООН Гомес потребовал немедленного прекращения огня." },
          { source: "Reuters", penalty: 10, diplomacyDelta: -6, economyDelta: -4,
            text: "G7 ввела новый пакет санкций в ответ на военные действия. Под удар попали госбанки и экспорт энергоносителей. Рубль упал на 8% за один день." },
          { source: "Al Jazeera", penalty: 6, diplomacyDelta: -4, stabilityDelta: -3,
            text: "Массовые антивоенные протесты прошли в 20 городах страны. Матери погибших солдат вышли на улицы — полиция применила силу, что вызвало новую волну возмущения." },
          { source: "Financial Times", penalty: 12, economyDelta: -5, diplomacyDelta: -5,
            text: "Крупнейшие международные банки заморозили корреспондентские счета российских структур. Доступ к SWIFT для ещё 12 банков закрыт. Экспортные доходы резко сократились." },
          { source: "Bild", penalty: 7, diplomacyDelta: -5,
            text: "Германия, Франция и Италия потребовали созыва Совета Безопасности ООН. Европейские столицы говорят о «военных преступлениях» и готовят ордер Международного уголовного суда." },
        ];
        const blowback = BLOWBACK_EVENTS[Math.floor(Math.random() * BLOWBACK_EVENTS.length)];
        newStats.peace_progress = Math.max(0, (newStats.peace_progress ?? 0) - blowback.penalty);
        if (blowback.diplomacyDelta) newStats.diplomacy = Math.max(0, Math.min(100, (newStats.diplomacy ?? 50) + blowback.diplomacyDelta));
        if (blowback.approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + blowback.approvalDelta));
        if (blowback.economyDelta) newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + blowback.economyDelta));
        if (blowback.stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + blowback.stabilityDelta));
        // Счётчик военной эскалации — накапливается, ведёт к defeat_war
        newStats.war_escalation_counter = Math.min(5, (newStats.war_escalation_counter ?? 0) + 1);
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, turnNumber, "news", blowback.source, blowback.text, JSON.stringify([
            { emoji: "⚠️", label: "эскалация", count: Math.floor(Math.random() * 100) + 50 },
          ])]
        );
        fastify.log.info({ gameId, source: blowback.source }, "Military blowback fired");
      } else if (gmClassification.action_type !== "military_offensive") {
        // Снижаем счётчик если не воюем
        if ((newStats.war_escalation_counter ?? 0) > 0) {
          newStats.war_escalation_counter = Math.max(0, (newStats.war_escalation_counter ?? 0) - 1);
        }
      }

      // --- ВНУТРЕННИЕ КРИЗИСЫ ---
      // С вероятностью 12% каждый ход происходит внутренний кризис
      if (Math.random() < 0.12) {
        const DOMESTIC_CRISES = [
          { source: "Ведомости", approvalDelta: -6, economyDelta: -4,
            text: "Крупнейшая утечка капитала за последние годы: олигархи вывели за рубеж $40 млрд за месяц. Центробанк вынужден экстренно поднять ставку, что ударило по малому бизнесу." },
          { source: "Новая газета", stabilityDelta: -5, approvalDelta: -5,
            text: "В 15 регионах прошли антивоенные акции. Задержаны более 3000 человек. Социологи фиксируют рекордный рост недовольства среди молодёжи и женщин — тех, кто теряет мужей и сыновей." },
          { source: "РИА Новости", economyDelta: -7, stabilityDelta: -3,
            text: "Крупный банковский кризис: четыре региональных банка обратились за экстренной ликвидностью. ЦБ объявил о введении временной администрации. Вкладчики выстроились в очереди." },
          { source: "Интерфакс", approvalDelta: -5, stabilityDelta: -4,
            text: "Антикоррупционный скандал: в Telegram-каналах опубликованы данные о роскошной жизни окружения президента. Яхты, виллы, тайные счета. Рейтинг падает на фоне военных расходов." },
          { source: "ТАСС", economyDelta: -5, approvalDelta: -4,
            text: "Дефицит базовых товаров в ряде регионов: сахар, масло, лекарства исчезли с полок. Губернаторы просят федеральный центр о помощи. Граждане начали делать запасы." },
          { source: "Фонтанка", stabilityDelta: -6, approvalDelta: -3,
            text: "Семьи погибших военнослужащих провели демонстрацию у здания Министерства обороны. Требования о выплате компенсаций и возврате тел не выполняются уже полгода. Силовики разгоняют акцию." },
          { source: "Медиазона", stabilityDelta: -5, economyDelta: -3,
            text: "Бунт в нескольких исправительных колониях: заключённые отказываются подписывать контракты для отправки на фронт. Информация подтверждается перехватами ФСБ." },
          { source: "The Bell", economyDelta: -6, approvalDelta: -4,
            text: "Инфляция вышла из-под контроля — официально 24%, реально, по независимым оценкам, все 40%. Пенсии и зарплаты бюджетников обесценились. Недовольство растёт в базовом электорате." },
        ];
        const crisis = DOMESTIC_CRISES[Math.floor(Math.random() * DOMESTIC_CRISES.length)];
        if (crisis.approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + crisis.approvalDelta));
        if (crisis.economyDelta) newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + crisis.economyDelta));
        if (crisis.stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + crisis.stabilityDelta));
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, turnNumber, "news", crisis.source, crisis.text, JSON.stringify([
            { emoji: "😰", label: "тревога", count: Math.floor(Math.random() * 80) + 30 },
          ])]
        );
        fastify.log.info({ gameId, source: crisis.source }, "Domestic crisis fired");
      }

      // --- ВОЕННО-ЭКОНОМИЧЕСКОЕ ДАВЛЕНИЕ ---
      // Если военные расходы высокие (military > 70) — экономика страдает
      if ((newStats.military ?? 50) > 70) {
        const warTax = Math.floor(((newStats.military ?? 50) - 70) / 10) + 1; // 1-4 pts
        newStats.economy = Math.max(0, (newStats.economy ?? 50) - warTax);
        newStats.approval = Math.max(0, (newStats.approval ?? 50) - 1);
      }

      // --- ВМЕШАТЕЛЬСТВО ТРЕТЬИХ АКТОРОВ ---
      // Когда мирный трек растёт, акторы с интересом в войне мешают.
      // Вероятность: 20% при 30, до 65% при 90+.
      const peaceNow = newStats.peace_progress ?? 0;
      if (peaceNow >= 25) {
        const interferenceChance = Math.min(0.65, 0.20 + (peaceNow - 25) * 0.008);
        if (Math.random() < interferenceChance) {
          const INTERFERENCE_ACTORS = [
            // Западные правительства
            { minPeace: 25, source: "Reuters", penalty: 15, diplomacyDelta: -4,
              text: "Министр иностранных дел Великобритании Лэмонд экстренно прилетел в Киев. Лондон настаивает на продолжении боевых действий и обещает увеличить поставки вооружений — «не время для переговоров»." },
            { minPeace: 25, source: "BBC", penalty: 12, diplomacyDelta: -3,
              text: "Премьер-министр Великобритании Стармер объявил о «беспрецедентном» пакете военной помощи Украине. Лондон открыто предупредил Москву: любой мирный договор без одобрения Запада — «нелегитимен»." },
            { minPeace: 30, source: "Politico", penalty: 16, diplomacyDelta: -5,
              text: "Польша и страны Балтии сформировали «Коалицию несогласных» против переговоров. Варшава пригрозила наложить вето на любое решение ЕС, легитимизирующее российские территориальные претензии." },
            { minPeace: 30, source: "AP", penalty: 14, diplomacyDelta: -4,
              text: "Экстренное заседание НАТО в Брюсселе: альянс потребовал от Киева отклонить российские мирные условия. Генсек Альянса Руттерс заявил — любой договор без полного вывода российских войск неприемлем." },
            // Американский фактор
            { minPeace: 25, source: "Bloomberg", penalty: 13, economyDelta: -3,
              text: "Американский ВПК объявил о новом контракте на поставку Украине вооружений на $9 млрд. Конгресс одобрил экстренный пакет военной помощи. Акции Raytheon и Lockheed выросли на 12%." },
            { minPeace: 45, source: "NYT", penalty: 15, diplomacyDelta: -4,
              text: "Сенатор Хоукс инициировал слушания: «Любое мирное соглашение с Россией — это Мюнхен-2». Администрация Белого дома под давлением заморозила официальные контакты с российской стороной." },
            { minPeace: 55, source: "Washington Post", penalty: 17, diplomacyDelta: -5, economyDelta: -3,
              text: "Конгресс США принял закон о немедленных санкциях против любой страны, предоставляющей площадку для переговоров. Под ударом — ОАЭ, Турция, Индия. Международная дипломатия парализована." },
            // Внутренний российский фактор
            { minPeace: 30, source: "Коммерсантъ", penalty: 11, stabilityDelta: -4,
              text: "Силовой блок выразил несогласие с мирными инициативами президента. Директор ФСБ Патров провёл закрытое совещание — источники говорят о «красных линиях», которые не должны быть пересечены." },
            { minPeace: 35, source: "РБК", penalty: 10, stabilityDelta: -5, approvalDelta: -3,
              text: "Группа депутатов Думы потребовала денонсации мирных инициатив. «Мы отдали слишком много жизней, чтобы сейчас договариваться» — заявил Соколин. Силовики демонстративно бойкотировали совещание в Кремле." },
            { minPeace: 45, source: "Фонтанка", penalty: 9, stabilityDelta: -4, approvalDelta: -4,
              text: "Ветеранские организации и «Комитет матерей погибших» вступили в открытое противостояние: одни требуют мира, другие — продолжения «до победы». Раскол в обществе усиливается." },
            { minPeace: 50, source: "Медиазона", penalty: 8, stabilityDelta: -6,
              text: "Утечка: группа генералов направила закрытое письмо в Совет Безопасности с требованием отставки гражданских советников, выступающих за переговоры. Армия не готова принять «позорный мир»." },
            // Украинский фактор
            { minPeace: 35, source: "Kyiv Post", penalty: 14, diplomacyDelta: -5,
              text: "Националистические формирования Украины отказались выполнять приказ об отводе войск. Командиры заявили: «Мы не подчиняемся приказам, противоречащим нашей присяге освободить все украинские земли»." },
            { minPeace: 50, source: "Украинская правда", penalty: 12, diplomacyDelta: -4,
              text: "Митинги в Киеве: сотни тысяч вышли против любых переговоров с Россией. Зелин под давлением сделал жёсткое заявление — никаких компромиссов по территориям. Мирный трек трещит по швам." },
            // Европейский фактор
            { minPeace: 40, source: "Le Monde", penalty: 18, diplomacyDelta: -6,
              text: "Экстренный саммит G7: лидеры семёрки потребовали от Киева отклонить российские инициативы и пригрозили санкциями посредникам, содействующим «несправедливому миру»." },
            { minPeace: 60, source: "Der Spiegel", penalty: 20, stabilityDelta: -5, economyDelta: -4,
              text: "Утечка из BND: США рассматривают прямое участие в конфликте если Украина подпишет мирный договор. «Стратегическое поражение» неприемлемо для Вашингтона. Немецкие политики в панике." },
            { minPeace: 55, source: "Financial Times", penalty: 16, economyDelta: -6, diplomacyDelta: -4,
              text: "Европейский банк реконструкции и развития объявил о заморозке финансирования любых проектов с российским участием. Брюссель ввёл 14-й пакет санкций — удар по нефтяному экспорту." },
            // Азиатский и Ближневосточный фактор
            { minPeace: 35, source: "South China Morning Post", penalty: 10, diplomacyDelta: -3,
              text: "Китай публично дистанцировался от мирных инициатив — «Пекин не вмешивается во внутренние дела суверенных государств». Китайские компании приостановили сделки с Россией под давлением США." },
            { minPeace: 40, source: "Haaretz", penalty: 9, diplomacyDelta: -4,
              text: "Израиль отказался выступить посредником в переговорах. Иерусалим «не намерен ссориться с Вашингтоном». Израильские компании тихо сворачивают деловые связи с российскими структурами." },
            { minPeace: 45, source: "Arab News", penalty: 11, economyDelta: -4,
              text: "Саудовская Аравия резко увеличила добычу нефти, обвалив цены. Нефтегазовые доходы России упали на 18%. Эр-Рияд недвусмысленно дал понять: цена мира — экономические уступки." },
            { minPeace: 50, source: "Al Jazeera", penalty: 8, diplomacyDelta: -3,
              text: "Турция под давлением США заморозила переговорную площадку в Стамбуле. Эрдоев вынужден выбирать между ролью посредника и членством в НАТО — Анкара выбирает Брюссель." },
            // ВПК и финансовые интересы
            { minPeace: 30, source: "Defense News", penalty: 13, economyDelta: -3,
              text: "Консорциум западных оружейных концернов выделил $500 млн на лоббирование «продолжения конфликта» в Конгрессе и парламентах ЕС. PR-кампания «Мир — это капитуляция» запущена в 40 странах." },
            { minPeace: 55, source: "Axios", penalty: 14, diplomacyDelta: -5, economyDelta: -4,
              text: "Утечка: крупнейшие хедж-фонды Уолл-стрит сделали ставки на продолжение войны на $200 млрд. Финансовое лобби давит на Белый дом — «мир обвалит наши портфели»." },
            // Внутренние олигархи и ФСБ
            { minPeace: 60, source: "The Bell", penalty: 12, stabilityDelta: -5, economyDelta: -3,
              text: "Олигархи, нажившиеся на военных контрактах, организовали кампанию против мира. Сотни миллиардов рублей в военной промышленности оказались под угрозой при завершении конфликта." },
            { minPeace: 70, source: "Новая газета", penalty: 16, stabilityDelta: -6, approvalDelta: -4,
              text: "ФСБ инициировала уголовные дела против нескольких чиновников, поддержавших мирный трек. Послание чёткое: кто выступает за переговоры — предатель. Часть советников президента молчит." },
          ].filter(a => a.minPeace <= peaceNow);

          if (INTERFERENCE_ACTORS.length > 0) {
            const actor = INTERFERENCE_ACTORS[Math.floor(Math.random() * INTERFERENCE_ACTORS.length)];
            newStats.peace_progress = Math.max(0, peaceNow - actor.penalty);
            if (actor.diplomacyDelta) newStats.diplomacy = Math.max(0, Math.min(100, (newStats.diplomacy ?? 50) + actor.diplomacyDelta));
            if (actor.stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + actor.stabilityDelta));
            if (actor.economyDelta) newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + actor.economyDelta));
            if (actor.approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + actor.approvalDelta));
            await client.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
              [gameId, turnNumber, "news", actor.source, actor.text, JSON.stringify([
                { emoji: "😤", label: "возмущение", count: Math.floor(Math.random() * 80) + 40 },
                { emoji: "😟", label: "беспокойство", count: Math.floor(Math.random() * 60) + 20 },
              ])]
            );
            await client.query(
              `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
              [JSON.stringify(newStats), gameId]
            );
            fastify.log.info({ gameId, actor: actor.source, penalty: actor.penalty }, "Third-party interference fired");
          }
        }
      }
      // --- конец вмешательства ---

      // Сохраняем все изменения stats (decay + blowback + crisis + interference)
      await client.query(
        `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
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
