/**
 * routes/admin.js
 *
 * Геймастерские эндпоинты (только для администратора).
 * Защищены заголовком x-admin-password.
 *
 * GET  /admin/stats
 * GET  /admin/games
 * POST /admin/games/:gameId/event          — внедрить событие (immediate или очередь)
 * POST /admin/games/:gameId/foreign-action — ход чужой страны (ИИ + immediate)
 * POST /admin/games/:gameId/set-stats      — напрямую изменить показатели
 * POST /admin/games/:gameId/set-initiative — изменить инициативу
 * DELETE /admin/games/:gameId             — сбросить/деактивировать игру
 * GET  /admin/games/:gameId/detail
 * GET  /admin/games/:gameId/pending
 */

async function registerAdminRoutes(fastify, { db, callClaudeApi, adminEventStore }) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "realpolitik-admin";

  function checkAuth(request, reply) {
    if (request.headers["x-admin-password"] !== ADMIN_PASSWORD) {
      reply.code(403).send({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  // Вспомогательная: применить stat deltas немедленно
  async function applyStatDeltas(gameId, statDeltas) {
    if (!statDeltas || Object.keys(statDeltas).length === 0) return;
    const statsRes = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
    if (statsRes.rowCount === 0) return;
    const current = statsRes.rows[0].stats;
    const patched = { ...current };
    for (const [k, v] of Object.entries(statDeltas)) {
      if (typeof patched[k] === "number") {
        patched[k] = Math.min(100, Math.max(0, patched[k] + Number(v)));
      }
    }
    await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(patched), gameId]);
    return patched;
  }

  // GET /admin/stats
  fastify.get("/admin/stats", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const [usersRes, gamesRes, turnsRes, playersRes] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN created_at > now() - interval '24 hours' THEN 1 END) AS today FROM users`),
      db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'active' THEN 1 END) AS active FROM games`),
      db.query(`SELECT COUNT(*) AS total FROM turns`),
      db.query(`
        SELECT u.display_name, g.id AS game_id, g.country_id, g.current_turn, g.created_at, g.status,
               ls.score
        FROM games g
        JOIN users u ON u.id = g.owner_user_id
        LEFT JOIN leaderboard_snap ls ON ls.game_id = g.id AND ls.turn_n = g.current_turn
        ORDER BY g.created_at DESC
        LIMIT 50
      `),
    ]);
    return reply.send({
      users: usersRes.rows[0],
      games: gamesRes.rows[0],
      turns: turnsRes.rows[0],
      players: playersRes.rows,
    });
  });

  // GET /admin/games
  fastify.get("/admin/games", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const res = await db.query(`
      SELECT g.id AS game_id, g.country_id, g.current_turn, g.status, g.created_at,
             u.display_name AS player_name,
             gs.stats, gs.relations, gs.initiative
      FROM games g
      JOIN users u ON u.id = g.owner_user_id
      JOIN game_state gs ON gs.game_id = g.id
      WHERE g.status = 'active'
      ORDER BY g.updated_at DESC NULLS LAST
    `);
    return reply.send({ games: res.rows });
  });

  // POST /admin/games/:gameId/event
  // immediate=true → применяет сразу, не ждёт хода
  fastify.post("/admin/games/:gameId/event", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { text, source = "Внешний источник", statDeltas = {}, secret = false, immediate = false } = request.body || {};
    if (!text) return reply.code(400).send({ error: "text is required" });

    if (immediate) {
      // Применяем сразу
      const gameRes = await db.query(`SELECT current_turn FROM games WHERE id = $1`, [gameId]);
      if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
      const turnN = gameRes.rows[0].current_turn;

      const newStats = await applyStatDeltas(gameId, statDeltas);

      if (!secret) {
        const reactions = Object.keys(statDeltas).length > 0
          ? JSON.stringify([{ user: "Аналитик", text: "Прямое вмешательство зафиксировано.", tone: "neg", stat_delta: statDeltas }])
          : "[]";
        await db.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, 'world_move', $3, $4, $5)`,
          [gameId, turnN, source, text, reactions]
        );
      }
      return reply.send({ ok: true, immediate: true, newStats: newStats || null });
    }

    // В очередь — сработает при следующем ходе
    await adminEventStore.push(gameId, {
      type: "event",
      text,
      source,
      statDeltas,
      secret,
      createdAt: new Date().toISOString(),
    });
    return reply.send({ ok: true, queued: true });
  });

  // POST /admin/games/:gameId/foreign-action
  fastify.post("/admin/games/:gameId/foreign-action", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { country, action, secret = false, immediate = true } = request.body || {};
    if (!country || !action) return reply.code(400).send({ error: "country and action are required" });

    const gameRes = await db.query(
      `SELECT g.country_id, g.current_turn, c.name AS country_name, gs.stats, gs.relations
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       WHERE g.id = $1`,
      [gameId]
    );
    if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    const game = gameRes.rows[0];

    const prompt = `Ты — геополитический аналитик. Страна-игрок: ${game.country_name}.
Другая держава "${country}" совершает следующее действие: "${action}".
Текущие показатели страны-игрока: ${JSON.stringify(game.stats)}.

Ответь ТОЛЬКО JSON без markdown-блоков:
{
  "narrative": "2-3 предложения: что произошло и как это влияет на ${game.country_name}",
  "statDeltas": { "stability": 0, "economy": 0, "military": 0, "diplomacy": 0, "approval": 0 },
  "severity": "low|medium|high"
}

Числа в statDeltas — от -10 до +5, отражают реальные последствия для ${game.country_name}.`;

    let parsed;
    try {
      const raw = await callClaudeApi({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });
      const rawText = raw.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      parsed = JSON.parse(rawText.replace(/```json\s*|\s*```/g, "").trim());
    } catch (e) {
      fastify.log.error({ e }, "AI failed in foreign-action");
      return reply.code(500).send({ error: "AI failed to generate response", detail: e.message });
    }

    if (immediate) {
      const newStats = await applyStatDeltas(gameId, parsed.statDeltas || {});
      if (!secret) {
        await db.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, 'world_move', $3, $4, $5)`,
          [gameId, game.current_turn, country, parsed.narrative,
           JSON.stringify([{ user: "Аналитик", text: `Последствия действий ${country} зафиксированы.`, tone: "neg", stat_delta: parsed.statDeltas || {} }])]
        );
      }
      return reply.send({ ok: true, immediate: true, preview: parsed, newStats: newStats || null });
    }

    await adminEventStore.push(gameId, {
      type: "foreign_action",
      source: country,
      text: parsed.narrative,
      statDeltas: parsed.statDeltas || {},
      severity: parsed.severity || "medium",
      secret,
      createdAt: new Date().toISOString(),
    });
    return reply.send({ ok: true, queued: true, preview: parsed });
  });

  // POST /admin/games/:gameId/set-stats — прямое изменение показателей
  fastify.post("/admin/games/:gameId/set-stats", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { stats } = request.body || {};
    if (!stats || typeof stats !== "object") return reply.code(400).send({ error: "stats object required" });

    const VALID = new Set(["economy", "military", "stability", "diplomacy", "approval"]);
    const res = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "Game not found" });

    const current = res.rows[0].stats;
    const patched = { ...current };
    for (const [k, v] of Object.entries(stats)) {
      if (VALID.has(k)) patched[k] = Math.min(100, Math.max(0, Number(v)));
    }
    await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(patched), gameId]);
    return reply.send({ ok: true, stats: patched });
  });

  // POST /admin/games/:gameId/set-initiative
  fastify.post("/admin/games/:gameId/set-initiative", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { initiative } = request.body || {};
    if (typeof initiative !== "number") return reply.code(400).send({ error: "initiative (number) required" });

    const clamped = Math.min(200, Math.max(0, initiative));
    const res = await db.query(
      `UPDATE game_state SET initiative = $1, updated_at = now() WHERE game_id = $2 RETURNING initiative`,
      [clamped, gameId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    return reply.send({ ok: true, initiative: clamped });
  });

  // DELETE /admin/games/:gameId — деактивировать игру
  fastify.delete("/admin/games/:gameId", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const res = await db.query(
      `UPDATE games SET status = 'inactive', updated_at = now() WHERE id = $1 RETURNING id`,
      [gameId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    return reply.send({ ok: true, deactivated: gameId });
  });

  // GET /admin/games/:gameId/detail
  fastify.get("/admin/games/:gameId/detail", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const [gameRes, turnsRes, newsfeedRes] = await Promise.all([
      db.query(`
        SELECT g.id, g.country_id, g.current_turn, g.status, g.created_at,
               u.display_name AS player_name, gs.stats, gs.relations, gs.policies, gs.initiative
        FROM games g
        JOIN users u ON u.id = g.owner_user_id
        JOIN game_state gs ON gs.game_id = g.id
        WHERE g.id = $1
      `, [gameId]),
      db.query(`
        SELECT turn_n, player_input, action_mode, narrative_text, advisor_objection,
               stat_deltas, gm_classification->>'action_type' AS action_type, created_at
        FROM turns WHERE game_id = $1 ORDER BY turn_n ASC
      `, [gameId]),
      db.query(`
        SELECT turn_n, item_type, source, text, created_at
        FROM newsfeed_items WHERE game_id = $1 ORDER BY turn_n DESC, created_at DESC LIMIT 30
      `, [gameId]),
    ]);
    if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    return reply.send({
      game: gameRes.rows[0],
      turns: turnsRes.rows,
      newsfeed: newsfeedRes.rows,
    });
  });

  // GET /admin/games/:gameId/pending
  fastify.get("/admin/games/:gameId/pending", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const events = await adminEventStore.list(gameId);
    return reply.send({ events });
  });
}

module.exports = { registerAdminRoutes };
