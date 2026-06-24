/**
 * routes/admin.js
 *
 * Геймастерские эндпоинты (только для администратора).
 * Защищены заголовком x-admin-password.
 *
 * GET  /admin/stats              — общая статистика
 * GET  /admin/games              — список активных партий
 * POST /admin/games/:gameId/event          — внедрить событие в партию
 * POST /admin/games/:gameId/foreign-action — ход чужой страны (обрабатывается ИИ)
 * GET  /admin/games/:gameId/pending        — посмотреть очередь событий
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

  // GET /admin/games — активные партии с деталями
  fastify.get("/admin/games", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const res = await db.query(`
      SELECT g.id AS game_id, g.country_id, g.current_turn, g.status, g.created_at,
             u.display_name AS player_name,
             gs.stats, gs.relations
      FROM games g
      JOIN users u ON u.id = g.owner_user_id
      JOIN game_state gs ON gs.game_id = g.id
      WHERE g.status = 'active'
      ORDER BY g.updated_at DESC NULLS LAST
    `);
    return reply.send({ games: res.rows });
  });

  // POST /admin/games/:gameId/event — внедрить событие напрямую
  fastify.post("/admin/games/:gameId/event", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { text, source = "Внешний источник", statDeltas = {}, secret = false } = request.body || {};
    if (!text) return reply.code(400).send({ error: "text is required" });

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

  // POST /admin/games/:gameId/foreign-action — ИИ генерирует последствия от чужой страны
  fastify.post("/admin/games/:gameId/foreign-action", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { country, action, secret = false } = request.body || {};
    if (!country || !action) return reply.code(400).send({ error: "country and action are required" });

    // Получаем текущее состояние партии
    const gameRes = await db.query(
      `SELECT g.country_id, c.name AS country_name, gs.stats, gs.relations
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

Числа в statDeltas — от -15 до +5, отражают реальные последствия для ${game.country_name}.`;

    let parsed;
    try {
      const raw = await callClaudeApi([{ role: "user", content: prompt }], { maxTokens: 400 });
      const text = raw.content?.[0]?.text || raw;
      parsed = JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      return reply.code(500).send({ error: "AI failed to generate response" });
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

  // GET /admin/games/:gameId/detail — полная история ходов игрока
  fastify.get("/admin/games/:gameId/detail", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const [gameRes, turnsRes, newsfeedRes] = await Promise.all([
      db.query(`
        SELECT g.id, g.country_id, g.current_turn, g.status, g.created_at,
               u.display_name AS player_name, gs.stats, gs.relations, gs.policies
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

  // GET /admin/games/:gameId/pending — посмотреть что в очереди
  fastify.get("/admin/games/:gameId/pending", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const events = await adminEventStore.list(gameId);
    return reply.send({ events });
  });
}

module.exports = { registerAdminRoutes };
