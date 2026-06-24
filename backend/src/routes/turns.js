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
const { applyTurn, computeDelayedEffectDelta } = require("../rules/rules-engine");
const { generateWorldUpdate } = require("../ai/worldUpdate");

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
    const { playerInput } = request.body;

    if (!playerInput || typeof playerInput !== "string" || playerInput.trim().length === 0) {
      return reply.code(400).send({ error: "playerInput is required" });
    }

    // Только чтение — без FOR UPDATE, не открываем долгую транзакцию на время вызова ИИ
    const gameRes = await db.query(
      `SELECT g.current_turn, gs.stats, gs.relations, gs.policies, gs.delayed_effects, gs.overview, c.name AS country_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
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

    const gmClassification = await classifyTurn({
      params: {
        countryName: game.country_name,
        gameDate: game.overview?.date || "—",
        turnNumber: nextTurnNumber,
        currentState: { stats: statsAfterDelayed, relations: game.relations },
        activePolicies: game.policies,
        delayedEffects: remainingEffects,
        playerInput,
      },
      callClaudeApi,
    });

    // Считаем превью дельт ТЕМ ЖЕ rules-engine — то, что увидит игрок,
    // должно совпадать 1:1 с тем, что применится при confirm (тот же seed).
    const { statDeltas, relationDeltas } = applyTurn({
      state: { stats: statsAfterDelayed, relations: game.relations },
      gmClassification,
      gameId,
      turnNumber: nextTurnNumber,
    });

    await pendingTurnStore.save(gameId, {
      gmClassification,
      turnNumber: nextTurnNumber,
      statsAfterDelayed,
      remainingEffects,
    });

    return reply.send({
      turnNumber: nextTurnNumber,
      narrative: gmClassification.narrative,
      advisorObjection: gmClassification.advisor_objection,
      statDeltasPreview: statDeltas,
      relationDeltasPreview: relationDeltas,
      requiresConfirmation: true,
    });
  });

  // ---------- CONFIRM ----------
  fastify.post("/games/:gameId/turns/confirm", async (request, reply) => {
    const { gameId } = request.params;

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

      const { gmClassification, turnNumber, statsAfterDelayed, remainingEffects } = pending;

      const { newStats, newRelations, statDeltas, relationDeltas } = applyTurn({
        state: { stats: statsAfterDelayed, relations: game.relations },
        gmClassification,
        gameId,
        turnNumber,
      });

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
        `INSERT INTO turns (game_id, turn_n, player_input, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          gameId,
          turnNumber,
          request.body?.playerInput || "(см. gm_classification)",
          JSON.stringify(gmClassification),
          JSON.stringify(statDeltas),
          JSON.stringify(relationDeltas),
          gmClassification.narrative,
          gmClassification.advisor_objection,
        ]
      );

      let updatedPolicies = game.policies || [];
      if (gmClassification.policy_update?.is_new_policy) {
        updatedPolicies = [
          ...updatedPolicies,
          {
            title: gmClassification.policy_update.title,
            turn: turnNumber,
            status: "active",
            items: gmClassification.policy_update.items || [],
          },
        ];
      }

      await client.query(
        `UPDATE game_state
         SET stats = $1, relations = $2, policies = $3, delayed_effects = $4, updated_at = now()
         WHERE game_id = $5`,
        [JSON.stringify(newStats), JSON.stringify(newRelations), JSON.stringify(updatedPolicies), JSON.stringify(updatedDelayedEffects), gameId]
      );

      await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          gameId,
          turnNumber,
          gmClassification.policy_update?.is_new_policy ? "decree" : "news",
          "Брифинг штаба",
          gmClassification.narrative,
          JSON.stringify(gmClassification.newsfeed_reactions || []),
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
          playerInput: request.body?.playerInput || gmClassification.narrative,
          narrative: gmClassification.narrative,
          statDeltas,
          relationDeltas,
          currentStats: newStats,
          currentRelations: newRelations,
          prevOverview: game.overview || {},
        },
        callClaudeApi,
      }).then(async (worldUpdate) => {
        if (!worldUpdate) return;
        try {
          // Обновляем overview
          if (worldUpdate.overview) {
            await db.query(
              `UPDATE game_state SET overview = $1, updated_at = now() WHERE game_id = $2`,
              [JSON.stringify({ ...worldUpdate.overview, turn: turnNumber }), gameId]
            );
          }
          // Добавляем реакции стран в ленту
          for (const reaction of worldUpdate.world_reactions || []) {
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, 'reaction', $3, $4, '[]')`,
              [gameId, turnNumber, reaction.source, reaction.text]
            );
          }
          // Добавляем ходы других стран
          for (const move of worldUpdate.world_moves || []) {
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, 'world_move', $3, $4, $5)`,
              [gameId, turnNumber, move.country, move.action, JSON.stringify([{ user: "Аналитик", text: move.impact, tone: move.direction === "hostile" ? "neg" : move.direction === "cooperative" ? "pos" : "neutral" }])]
            );
          }
        } catch (err) {
          fastify.log.error({ err }, "worldUpdate DB write failed");
        }
      }).catch((err) => fastify.log.error({ err }, "worldUpdate failed"));

      return reply.send({
        turnNumber,
        narrative: gmClassification.narrative,
        statDeltas,
        relationDeltas,
        newStats,
        newRelations,
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
}

module.exports = { registerTurnRoutes };
