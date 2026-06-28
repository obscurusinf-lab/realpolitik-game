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
// verifyToken injected via options

const COUNTRIES_DIR = path.join(__dirname, "../db/seed/countries");

function loadCountrySeed(countryId) {
  const files = fs.readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, file), "utf-8"));
    if (data.id === countryId) return data;
  }
  return null;
}

const OUTCOME_TITLES = {
  victory:        "Триумф: мир достигнут",
  partial_peace:  "Договор подписан, но страна истощена",
  partial:        "Достойное правление без мирного соглашения",
  defeat_time:    "Срок истёк — цели не достигнуты",
  defeat_coup:    "Государственный переворот",
  defeat_collapse:"Экономический коллапс",
  defeat_unrest:  "Народные волнения сметают власть",
};

const GAME_SLOT_LIMIT = 5;

async function registerGameRoutes(fastify, { db, callClaudeApi, verifyToken }) {
  // ---------- POST /games ----------
  fastify.post("/games", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const { countryId } = request.body || {};
    const userId = payload.userId;

    const countRes = await db.query(
      `SELECT COUNT(*) AS cnt FROM games WHERE owner_user_id = $1 AND status = 'active'`,
      [userId]
    );
    if (parseInt(countRes.rows[0].cnt, 10) >= GAME_SLOT_LIMIT) {
      return reply.code(409).send({ error: `Лимит слотов: у вас уже ${GAME_SLOT_LIMIT} активных партий. Удалите одну, чтобы начать новую.` });
    }

    if (!countryId || typeof countryId !== "string") {
      return reply.code(400).send({ error: "countryId is required" });
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

    const seed = loadCountrySeed(countryId) || {};
    const overviewSeed = seed.overview_seed || { headline: "Партия началась.", hotspots: [] };
    const initialPolicies = seed.initial_policies || [];
    const initialNewsfeed = seed.initial_newsfeed || [];
    // Субметрики из сида перекрывают базовые стат
    const baseStats = { ...(seed.base_stats || country.base_stats) };

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
         VALUES ($1, $2, $3, $4, '[]', $5)`,
        [
          gameId,
          JSON.stringify(baseStats),
          JSON.stringify(country.base_relations),
          JSON.stringify(initialPolicies),
          JSON.stringify(overviewSeed),
        ]
      );

      // Сидируем начальные события в ленту новостей
      for (const item of initialNewsfeed) {
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            gameId,
            item.turn_n ?? 0,
            item.item_type || "news",
            item.source || "Архив",
            item.text,
            JSON.stringify(item.reactions || []),
          ]
        );
      }

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

  // ---------- GET /games/my — все партии текущего пользователя ----------
  fastify.get("/games/my", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const res = await db.query(
      `SELECT g.id, g.current_turn, g.status, g.created_at, c.name AS country_name, c.id AS country_id
       FROM games g JOIN countries c ON c.id = g.country_id
       WHERE g.owner_user_id = $1 ORDER BY g.updated_at DESC LIMIT 20`,
      [payload.userId]
    );
    return reply.send({ games: res.rows });
  });

  // ---------- DELETE /games/:gameId ----------
  fastify.delete("/games/:gameId", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { gameId } = request.params;
    const check = await db.query(
      `SELECT id FROM games WHERE id = $1 AND owner_user_id = $2`,
      [gameId, payload.userId]
    );
    if (check.rowCount === 0) return reply.code(404).send({ error: "Партия не найдена" });
    await db.query(`DELETE FROM games WHERE id = $1`, [gameId]);
    return reply.send({ ok: true });
  });

  // ---------- GET /games/:gameId ----------
  // Возвращает полное состояние партии в формате, совместимом с App.jsx:
  //   { date, turn, stats, relations, policies, overview, newsfeed, log }
  fastify.get("/games/:gameId", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const gameRes = await db.query(
      `SELECT g.id, g.current_turn, g.status, g.created_at, g.owner_user_id,
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
    if (game.owner_user_id !== payload.userId) {
      return reply.code(403).send({ error: "Нет доступа к этой партии" });
    }

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

    // Дата из overview (продвигается в turns.js при каждом ходе)
    let date = game.overview?.date || null;
    if (date) {
      try {
        date = new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      } catch { /* оставить строкой */ }
    } else {
      // Фоллбэк для старых партий без даты в overview
      const startDate = new Date(game.created_at);
      startDate.setMonth(startDate.getMonth() + game.current_turn);
      date = startDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    }

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

  // ---------- POST /games/:gameId/legacy — итоговый текст правления ----------
  fastify.post("/games/:gameId/legacy", async (request, reply) => {
    const { gameId } = request.params;
    const { outcome } = request.body || {};

    const gameRes = await db.query(
      `SELECT g.current_turn, g.status, gs.stats, gs.relations, c.name AS country_name, u.display_name AS player_name
       FROM games g JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       LEFT JOIN users u ON u.id = g.owner_user_id
       WHERE g.id = $1`,
      [gameId]
    );
    if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    const game = gameRes.rows[0];

    const turnsRes = await db.query(
      `SELECT turn_n, player_input, narrative_text, action_mode FROM turns WHERE game_id = $1 ORDER BY turn_n ASC`,
      [gameId]
    );
    const turns = turnsRes.rows;

    const outcomeTitle = OUTCOME_TITLES[outcome] || "Конец правления";
    const stats = game.stats || {};
    const turnCount = game.current_turn;

    const historyLines = turns.map(t =>
      `Ход ${t.turn_n} [${t.action_mode || "decree"}]: "${t.player_input}" → ${t.narrative_text}`
    ).join("\n");

    const prompt = `Ты — исторический хроникёр. Игрок управлял страной "${game.country_name}" как президент "${game.player_name || "безымянный правитель"}" в течение ${turnCount} ходов (1 ход = 1 месяц).

ИТОГ ПРАВЛЕНИЯ: "${outcomeTitle}"

ФИНАЛЬНЫЕ ПОКАЗАТЕЛИ:
- Экономика: ${stats.economy ?? "?"}/100
- Армия: ${stats.military ?? "?"}/100
- Стабильность: ${stats.stability ?? "?"}/100
- Дипломатия: ${stats.diplomacy ?? "?"}/100
- Рейтинг: ${stats.approval ?? "?"}/100
- Мирный трек: ${stats.peace_progress ?? 0}/100

ХРОНИКА РЕШЕНИЙ (${turns.length} ходов):
${historyLines || "(история пуста)"}

Напиши итоговую историческую оценку правления в формате JSON:
{
  "title": "краткий исторический заголовок (8-12 слов)",
  "verdict": "1-2 предложения — общая оценка правления",
  "chapters": [
    { "heading": "краткий заголовок", "text": "2-3 предложения об этом периоде/аспекте правления" }
  ],
  "highlights": [
    { "type": "good|bad", "text": "одна строка — ключевое решение или достижение" }
  ],
  "epitaph": "финальная фраза, которую история запомнит об этом правителе (1 предложение, поэтически)"
}

Требования:
- chapters: 3-4 раздела (экономика, внешняя политика, армия/безопасность, итог)
- highlights: 4-6 пунктов — конкретные решения из хроники, хорошие и плохие
- Тон: документальный, без пафоса, как настоящий учебник истории
- Только JSON, без markdown-обёрток`;

    try {
      const response = await callClaudeApi({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      const cleaned = rawText.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return reply.send({ legacy: parsed, outcome, outcomeTitle });
    } catch (err) {
      fastify.log.error({ err }, "Legacy generation failed");
      return reply.send({
        legacy: {
          title: outcomeTitle,
          verdict: "Правление завершено.",
          chapters: [],
          highlights: [],
          epitaph: "История расставит все точки.",
        },
        outcome,
        outcomeTitle,
      });
    }
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
