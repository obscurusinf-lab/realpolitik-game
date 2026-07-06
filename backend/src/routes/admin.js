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
 * POST /admin/games/:gameId/ukraine-action — записать действие ЗА Украину (в очередь, на след. ход)
 * POST /admin/games/:gameId/advisor-note   — переопределить рекомендацию министра (персистентно)
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
             gs.stats, gs.relations, gs.initiative,
             g.last_ping_at, (g.last_ping_at > now() - interval '45 seconds') AS online
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

  // POST /admin/games/:gameId/ukraine-action — админ пишет действие ЗА Украину.
  // Кладёт в очередь (ukraine_manual_queue); реально применяется runUkraineTurn() в turns.js
  // при СЛЕДУЮЩЕМ ходе (confirm/regroup) — тем же путём, что и обычное действие Украины
  // (пишет в newsfeed_items, двигает статы), только вместо ИИ/Math.random() берёт эти
  // title/text/deltas как есть. Очередь одноразовая — turns.js сам обнуляет её после использования.
  fastify.post("/admin/games/:gameId/ukraine-action", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { action_type, title, text, deltas } = request.body || {};
    if (!title || !text) return reply.code(400).send({ error: "title и text обязательны" });

    const VALID_STATS = new Set([
      "economy", "military", "stability", "diplomacy", "approval", "peace_progress",
      "army_morale", "readiness", "kharkiv_control", "kherson_control",
      "zaporizhzhia_control", "donetsk_control", "luhansk_control",
    ]);
    const cleanDeltas = {};
    for (const [k, v] of Object.entries(deltas || {})) {
      if (VALID_STATS.has(k) && Number(v) !== 0) cleanDeltas[k] = Number(v);
    }

    const queue = { action_type: action_type || "admin_scripted", title, text, deltas: cleanDeltas };
    const res = await db.query(
      `UPDATE games SET ukraine_manual_queue = $1 WHERE id = $2 RETURNING id`,
      [JSON.stringify(queue), gameId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    return reply.send({ ok: true, queued: queue });
  });

  // POST /admin/games/:gameId/advisor-note — админ пишет/меняет/убирает рекомендацию
  // конкретного министра. Персистентно (пока не сменят/не очистят), не одноразово —
  // применяется в advisors.js при каждом /advisors/consult, пока заметка стоит.
  fastify.post("/admin/games/:gameId/advisor-note", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { gameId } = request.params;
    const { advisorId, text } = request.body || {};
    const VALID_ADVISORS = new Set(["defense", "foreign", "finance", "security", "press"]);
    if (!VALID_ADVISORS.has(advisorId)) return reply.code(400).send({ error: "advisorId должен быть одним из: defense, foreign, finance, security, press" });

    const res = await db.query(`SELECT admin_advisor_notes FROM games WHERE id = $1`, [gameId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "Game not found" });

    const notes = { ...(res.rows[0].admin_advisor_notes || {}) };
    if (text && text.trim()) notes[advisorId] = text.trim();
    else delete notes[advisorId];

    await db.query(`UPDATE games SET admin_advisor_notes = $1 WHERE id = $2`, [JSON.stringify(notes), gameId]);
    return reply.send({ ok: true, notes });
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
               g.last_ping_at, (g.last_ping_at > now() - interval '45 seconds') AS online,
               g.ukraine_manual_queue, g.admin_advisor_notes,
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

  // GET /admin/users — все пользователи с агрегатами по партиям
  fastify.get("/admin/users", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const res = await db.query(`
      SELECT
        u.id, u.username, u.display_name, u.is_anonymous, u.created_at,
        COUNT(g.id)::int                                        AS games_total,
        COUNT(CASE WHEN g.status = 'active' THEN 1 END)::int   AS games_active,
        MAX(g.updated_at)                                       AS last_active,
        MAX(g.current_turn)                                     AS max_turn,
        MAX(g.last_ping_at)                                     AS last_ping_at,
        BOOL_OR(g.last_ping_at > now() - interval '45 seconds') AS online
      FROM users u
      LEFT JOIN games g ON g.owner_user_id = u.id
      GROUP BY u.id
      ORDER BY last_active DESC NULLS LAST
    `);
    return reply.send({ users: res.rows });
  });

  // GET /admin/users/:userId — полное досье: все партии + ходы каждой
  fastify.get("/admin/users/:userId", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { userId } = request.params;

    const userRes = await db.query(
      `SELECT id, username, display_name, is_anonymous, created_at FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rowCount === 0) return reply.code(404).send({ error: "User not found" });

    const gamesRes = await db.query(`
      SELECT g.id, g.country_id, g.status, g.current_turn, g.assist_mode,
             g.president_name, g.created_at, g.updated_at,
             c.name AS country_name,
             gs.stats, gs.policies,
             ls.score
      FROM games g
      JOIN countries c ON c.id = g.country_id
      JOIN game_state gs ON gs.game_id = g.id
      LEFT JOIN leaderboard_snap ls ON ls.game_id = g.id AND ls.turn_n = g.current_turn
      WHERE g.owner_user_id = $1
      ORDER BY g.updated_at DESC NULLS LAST
    `, [userId]);

    // Для каждой партии тянем ходы
    const gameIds = gamesRes.rows.map(g => g.id);
    let turnsMap = {};
    if (gameIds.length > 0) {
      const turnsRes = await db.query(`
        SELECT game_id, turn_n, player_input, action_mode,
               gm_classification->>'action_type' AS action_type,
               narrative_text, advisor_objection, stat_deltas, created_at
        FROM turns
        WHERE game_id = ANY($1::uuid[])
        ORDER BY game_id, turn_n ASC
      `, [gameIds]);
      for (const t of turnsRes.rows) {
        (turnsMap[t.game_id] = turnsMap[t.game_id] || []).push(t);
      }
    }

    const games = gamesRes.rows.map(g => ({ ...g, turns: turnsMap[g.id] || [] }));
    return reply.send({ user: userRes.rows[0], games });
  });

  // GET /admin/feedback — все репорты
  fastify.get("/admin/feedback", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { status } = request.query;
    let q = `
      SELECT f.id, f.message, f.contact, f.page, f.status, f.created_at,
             u.display_name AS user_name, u.username,
             g.country_id, g.current_turn
      FROM feedback_items f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN games g ON g.id = f.game_id
    `;
    const params = [];
    if (status) { q += ` WHERE f.status = $1`; params.push(status); }
    q += ` ORDER BY f.created_at DESC`;
    const res = await db.query(q, params);
    return reply.send({ items: res.rows });
  });

  // PATCH /admin/feedback/:id — изменить статус репорта
  fastify.patch("/admin/feedback/:id", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { id } = request.params;
    const { status } = request.body || {};
    const VALID_STATUS = ["new", "in_review", "resolved", "wontfix"];
    if (!VALID_STATUS.includes(status)) return reply.code(400).send({ error: "Invalid status" });
    const res = await db.query(
      `UPDATE feedback_items SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "Not found" });
    return reply.send({ ok: true, id: res.rows[0].id, status: res.rows[0].status });
  });
}

module.exports = { registerAdminRoutes };
