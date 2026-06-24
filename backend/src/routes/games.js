/**
 * routes/games.js
 *
 * CRUD эндпоинты для партий:
 *   POST   /games                  — создать партию
 *   GET    /games/:gameId          — состояние партии (для App.jsx)
 *   GET    /games/:gameId/newsfeed — лента новостей
 *   GET    /games/:gameId/log      — журнал ходов
 *   GET    /leaderboard            — топ-20 партий по score
 */

const fs = require("fs");
const path = require("path");

const COUNTRIES_DIR = path.join(__dirname, "../db/seed/countries");

function loadOverviewSeed(countryId) {
  const files = fs.readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, file), "utf-8"));
    if (data.id === countryId) return data.overview_seed || null;
  }
  return null;
}

async function registerGameRoutes(fastify, { db }) {
  // ---------- POST /games ----------
  fastify.post("/games", async (request, reply) => {
    const { countryId, userId } = request.body || {};
    if (!countryId || typeof countryId !== "string") {
      return reply.code(400).send({ error: "countryId is required" });
    }
    if (!userId || typeof userId !== "string") {
      return reply.code(400).send({ error: "userId is required" });
    }

    const countryRes = await db.query(
      `SELECT id, name, base_stats, base_relations FROM countries WHERE id = $1`,
      [countryId]
    );
    if (countryRes.rowCount === 0) {
      return reply.code(404).send({ error: `Country '${countryId}' not found` });
    }
    const country = countryRes.rows[0];

    const userRes = await db.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (userRes.rowCount === 0) {
      return reply.code(404).send({ error: `User '${userId}' not found` });
    }

    const overviewSeed = loadOverviewSeed(countryId) || { headline: "Партия началась.", hotspots: [] };

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const gameRes = await client.query(
        `INSERT INTO games (owner_user_id, country_id, status, current_turn)
         VALUES ($1, $2, 'active', 0) RETURNING id`,
        [userId, countryId]
      );
      const gameId = gameRes.rows[0].id;

      await client.query(
        `INSERT INTO game_state (game_id, stats, relations, policies, delayed_effects, overview)
         VALUES ($1, $2, $3, '[]', '[]', $4)`,
        [
          gameId,
          JSON.stringify(country.base_stats),
          JSON.stringify(country.base_relations),
          JSON.stringify(overviewSeed),
        ]
      );

      await client.query("COMMIT");
      return reply.code(201).send({ gameId, countryId, status: "active", currentTurn: 0 });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Failed to create game" });
    } finally {
      client.release();
    }
  });

  // ---------- GET /games/:gameId ----------
  // Возвращает полное состояние партии в формате, совместимом с App.jsx:
  //   { date, turn, stats, relations, policies, overview, newsfeed, log }
  fastify.get("/games/:gameId", async (request, reply) => {
    const { gameId } = request.params;

    const gameRes = await db.query(
      `SELECT g.id, g.current_turn, g.status, g.created_at,
              gs.stats, gs.relations, gs.policies, gs.overview,
              c.name AS country_name, c.context_summary
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

    const newsfeedRes = await db.query(
      `SELECT turn_n, item_type, source, text, reactions
       FROM newsfeed_items WHERE game_id = $1 ORDER BY turn_n ASC`,
      [gameId]
    );

    const turnsRes = await db.query(
      `SELECT turn_n, player_input, narrative_text, stat_deltas, created_at
       FROM turns WHERE game_id = $1 ORDER BY turn_n ASC`,
      [gameId]
    );

    const newsfeed = newsfeedRes.rows.map((r) => ({
      turn: r.turn_n,
      type: r.item_type,
      source: r.source,
      text: r.text,
      reactions: r.reactions || [],
    }));

    const log = [
      {
        turn: 0,
        title: `Старт партии — ${game.country_name}`,
        body: game.overview?.headline || "Вы приступаете к управлению страной.",
      },
      ...turnsRes.rows.map((r) => ({
        turn: r.turn_n,
        title: `Ход ${r.turn_n}`,
        body: r.narrative_text,
      })),
    ];

    // Дата: начало + current_turn недель (упрощённая модель)
    const startDate = new Date(game.created_at);
    startDate.setDate(startDate.getDate() + game.current_turn * 7);
    const date = startDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

    return reply.send({
      id: game.id,
      status: game.status,
      countryName: game.country_name,
      turn: game.current_turn,
      date,
      stats: game.stats,
      relations: game.relations,
      policies: game.policies || [],
      overview: game.overview || {},
      contextSummary: game.context_summary || null,
      newsfeed,
      log,
    });
  });

  // ---------- GET /games/:gameId/newsfeed ----------
  fastify.get("/games/:gameId/newsfeed", async (request, reply) => {
    const { gameId } = request.params;
    const res = await db.query(
      `SELECT id, turn_n, item_type, source, text, reactions, created_at
       FROM newsfeed_items WHERE game_id = $1 ORDER BY turn_n DESC`,
      [gameId]
    );
    return reply.send({ items: res.rows });
  });

  // ---------- GET /games/:gameId/log ----------
  fastify.get("/games/:gameId/log", async (request, reply) => {
    const { gameId } = request.params;
    const res = await db.query(
      `SELECT id, turn_n, player_input, narrative_text, stat_deltas, relation_deltas, advisor_objection, created_at
       FROM turns WHERE game_id = $1 ORDER BY turn_n DESC`,
      [gameId]
    );
    return reply.send({ turns: res.rows });
  });

  // ---------- GET /leaderboard ----------
  fastify.get("/leaderboard", async (request, reply) => {
    const { countryId, limit = 20 } = request.query;

    let queryText = `
      SELECT ls.game_id, ls.turn_n, ls.score, ls.score_breakdown, ls.created_at,
             c.name AS country_name, c.id AS country_id,
             u.display_name AS player_name
      FROM leaderboard_snap ls
      JOIN games g ON g.id = ls.game_id
      JOIN countries c ON c.id = g.country_id
      JOIN users u ON u.id = g.owner_user_id
    `;
    const params = [];
    if (countryId) {
      queryText += ` WHERE c.id = $1`;
      params.push(countryId);
    }
    queryText += ` ORDER BY ls.score DESC LIMIT ${parseInt(limit, 10) || 20}`;

    const res = await db.query(queryText, params);
    return reply.send({ entries: res.rows });
  });
}

module.exports = { registerGameRoutes };
