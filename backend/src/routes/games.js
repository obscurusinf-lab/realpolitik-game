/**
 * routes/games.js
 *
 * CRUD эндпоинты для партий:
 *   POST   /games                  — создать партию
 *   GET    /games/:gameId          — состояние партии (для App.jsx)
 *   GET    /games/:gameId/newsfeed — лента новостей
 *   GET    /games/:gameId/log      — журнал ходов
 */

const fs = require("fs");
const path = require("path");
const { recordEvent } = require("../db/player-events");
const { languageInstruction } = require("../ai/language-instruction");
const { checkNameBlocklist } = require("../lib/name-blocklist");
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
  victory:          "Триумф: мир достигнут",
  victory_military: "Военная победа: цели операции достигнуты",
  victory_combined: "Принуждение к миру: победа с позиции силы",
  partial_peace:    "Договор подписан, но страна истощена",
  partial_military: "Военное доминирование без полной победы",
  partial:          "Достойное правление без мирного соглашения",
  defeat_time:      "Срок истёк — цели не достигнуты",
  defeat_coup:      "Государственный переворот",
  defeat_collapse:  "Экономический коллапс",
  defeat_unrest:    "Народные волнения сметают власть",
  defeat_isolation: "Полная международная изоляция",
  defeat_war:       "Неконтролируемая эскалация войны",
  defeat_military_collapse: "Армия небоеспособна — фронт рухнул",
  defeat_donbass_lost:      "ВСУ отбили Донбасс",
};

const GAME_SLOT_LIMIT = 5;

async function registerGameRoutes(fastify, { db, callClaudeApi, verifyToken }) {
  // ---------- POST /games ----------
  fastify.post("/games", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const { countryId, assistMode, presidentName, showInLeaderboard, language } = request.body || {};
    const userId = payload.userId;
    // Режим закрепляется на старте: 'advisor' (по умолчанию) | 'hardcore'
    const mode = assistMode === "hardcore" ? "hardcore" : "advisor";
    // Имя президента — своё на каждую партию, не путать с логином/аккаунтом.
    const president = (typeof presidentName === "string" ? presidentName.trim() : "").slice(0, 40) || null;
    if (president) {
      const blocked = checkNameBlocklist(president);
      if (blocked) return reply.code(409).send({ error: blocked.tier === "hard" ? "no way" : "Это имя уже занято" });
    }
    // Зал Славы: игрок явно выбирает публикацию (false по умолчанию).
    const leaderboardOpt = showInLeaderboard === true;
    // Язык партии — закреплён при создании, как assist_mode (i18n, Фаза 1, Петя, 2026-07-07).
    // Сейчас влияет только на будущие фазы (промпты ИИ/seed-данные) — сохраняем уже сейчас,
    // чтобы не терять выбор игрока, сделанный на стартовом экране.
    const gameLanguage = language === "en" ? "en" : "ru";

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
        `INSERT INTO games (owner_user_id, country_id, status, current_turn, assist_mode, president_name, show_in_leaderboard, language)
         VALUES ($1, $2, 'active', 0, $3, $4, $5, $6) RETURNING id`,
        [userId, countryId, mode, president, leaderboardOpt, gameLanguage]
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
      recordEvent(db, { playerId: userId, eventType: "game_started", payload: { gameId, countryId, assistMode: mode, language: gameLanguage } });
      return reply.code(201).send({ gameId, countryId, status: "active", currentTurn: 0, assistMode: mode, language: gameLanguage });
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
      `SELECT g.id, g.current_turn, g.status, g.created_at, g.assist_mode, g.president_name, c.name AS country_name, c.id AS country_id
       FROM games g JOIN countries c ON c.id = g.country_id
       WHERE g.owner_user_id = $1 ORDER BY g.updated_at DESC LIMIT 20`,
      [payload.userId]
    );
    return reply.send({ games: res.rows });
  });

  // ---------- POST /games/:gameId/ping — heartbeat, пока вкладка открыта и видима ----------
  // Индикатор "онлайн" в админке: last_ping_at свежий (< ~45с) значит игрок реально сейчас
  // смотрит на партию, а не просто когда-то последний раз ходил (это уже есть — updated_at).
  fastify.post("/games/:gameId/ping", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { gameId } = request.params;
    await db.query(
      `UPDATE games SET last_ping_at = now() WHERE id = $1 AND owner_user_id = $2`,
      [gameId, payload.userId]
    );
    return reply.send({ ok: true });
  });

  // ---------- PATCH /games/:gameId/language ----------
  // Переключатель RU/EN в шапке игры (i18n.js, setLang) — чисто клиентский, меняет только
  // статичные UI-строки и НЕ трогал games.language (баг, 2026-07-08, Петя: "переключился на
  // английский, но все новости на русском остались"). games.language читается заново на каждый
  // запрос генерации нарратива (turns.js/games.js, ~10 мест) — обновления здесь достаточно,
  // чтобы НОВЫЙ ИИ-контент пошёл на новом языке. Уже сгенерированные новости/ходы остаются на
  // языке, на котором были написаны — это исторический текст, задним числом не переводим.
  fastify.patch("/games/:gameId/language", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { gameId } = request.params;
    const { language } = request.body || {};
    if (language !== "ru" && language !== "en") {
      return reply.code(400).send({ error: "language must be 'ru' or 'en'" });
    }
    const res = await db.query(
      `UPDATE games SET language = $1 WHERE id = $2 AND owner_user_id = $3 RETURNING id`,
      [language, gameId, payload.userId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "Партия не найдена" });
    return reply.send({ ok: true, language });
  });

  // ---------- DELETE /games/:gameId ----------
  fastify.delete("/games/:gameId", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { gameId } = request.params;
    const check = await db.query(
      `SELECT id, current_turn, status FROM games WHERE id = $1 AND owner_user_id = $2`,
      [gameId, payload.userId]
    );
    if (check.rowCount === 0) return reply.code(404).send({ error: "Партия не найдена" });
    // game_abandoned — игрок явно удалил партию (в отличие от admin-деактивации, см. DELETE
    // /admin/games/:gameId в routes/admin.js). Снимок current_turn/status в payload — после
    // DELETE сама партия исчезнет (CASCADE), JOIN на games для аналитики станет невозможен.
    recordEvent(db, {
      playerId: payload.userId, eventType: "game_abandoned",
      payload: { gameId, currentTurn: check.rows[0].current_turn, statusAtDeletion: check.rows[0].status },
    });
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
      `SELECT g.id, g.current_turn, g.status, g.created_at, g.owner_user_id, g.assist_mode, g.language,
              gs.stats, gs.relations, gs.policies, gs.overview,
              c.name AS country_name, c.context_summary, c.country_profile
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
      `SELECT turn_n, player_input, action_mode, narrative_text, stat_deltas, created_at
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
      // player_input/action_mode/stat_deltas — уже были в turnsRes (запрос выше), просто не
      // попадали в log; игрок не мог посмотреть свои прошлые решения и их эффект, только
      // пересказ-нарратив (Петя, 2026-07-07: "чтоб можно было посмотреть все свои действия").
      ...turnsRes.rows.map((r) => ({
        turn: r.turn_n,
        title: `Ход ${r.turn_n}`,
        body: r.narrative_text,
        decree: r.player_input || null,
        actionMode: r.action_mode || null,
        statDeltas: r.stat_deltas || null,
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

    // Inject territory defaults for games created before the territory mechanic
    const TERRITORY_DEFAULTS = {
      donetsk_control: 78, luhansk_control: 96,
      zaporizhzhia_control: 68, kherson_control: 58, kharkiv_control: 12,
    };
    const statsWithTerritories = { ...game.stats };
    for (const [key, val] of Object.entries(TERRITORY_DEFAULTS)) {
      if (statsWithTerritories[key] === undefined) statsWithTerritories[key] = val;
    }
    // Казна — дефолт для партий, созданных до бюджетной механики
    if (statsWithTerritories.treasury === undefined) statsWithTerritories.treasury = 52;
    // Нефть и валюта — дефолт для партий, созданных до этой механики
    if (statsWithTerritories.oil_price === undefined) statsWithTerritories.oil_price = 68;
    if (statsWithTerritories.usd_rub === undefined) statsWithTerritories.usd_rub = 80;
    // Башни Кремля — дефолт для партий, созданных до этой механики
    const FACTION_DEFAULTS_FOR_OLD_GAMES = { faction_siloviki: 65, faction_tehnokraty: 65, faction_oligarhi: 65, faction_konservatory: 65, coalition_stability: 0 };
    for (const [key, val] of Object.entries(FACTION_DEFAULTS_FOR_OLD_GAMES)) {
      if (statsWithTerritories[key] === undefined) statsWithTerritories[key] = val;
    }

    // Карточка-дилемма Башен Кремля — детерминированная проверка (см. checkFactionDilemmaTrigger),
    // не чаще одной за ход и не повторно в уже разрешённый ход.
    let pendingFactionDilemma = null;
    if (statsWithTerritories.faction_dilemma_resolved_turn !== game.current_turn) {
      const { checkFactionDilemmaTrigger, FACTION_DILEMMAS } = require("../rules/rules-engine");
      const dilemmaId = checkFactionDilemmaTrigger(statsWithTerritories, gameId, game.current_turn);
      if (dilemmaId) {
        pendingFactionDilemma = { id: dilemmaId, factions: FACTION_DILEMMAS[dilemmaId].factions };
      }
    }

    // Merge full relations list for games created before extra countries were added
    const FULL_RELATIONS = [
      { name: "США",            value: 38, trend: "flat" },
      { name: "Украина",        value: 8,  trend: "down" },
      { name: "Китай",          value: 84, trend: "up"   },
      { name: "ЕС",             value: 14, trend: "down" },
      { name: "Турция",         value: 58, trend: "flat" },
      { name: "Индия",          value: 72, trend: "up"   },
      { name: "Германия",       value: 12, trend: "down" },
      { name: "Франция",        value: 16, trend: "flat" },
      { name: "Израиль",        value: 44, trend: "down" },
      { name: "Иран",           value: 62, trend: "up"   },
      { name: "Саудовская Аравия", value: 38, trend: "flat" },
      { name: "Беларусь",       value: 88, trend: "flat" },
      { name: "Польша",         value: 6,  trend: "down" },
      { name: "Великобритания", value: 8,  trend: "down" },
      { name: "Япония",         value: 18, trend: "down" },
      { name: "КНДР",           value: 52, trend: "up"   },
      { name: "Венгрия",        value: 64, trend: "flat" },
      { name: "ОАЭ",            value: 46, trend: "flat" },
    ];
    const existingRelations = Array.isArray(game.relations) ? game.relations : [];
    const existingNames = new Set(existingRelations.map(r => r.name));
    const mergedRelations = [
      ...existingRelations,
      ...FULL_RELATIONS.filter(r => !existingNames.has(r.name)),
    ];

    return reply.send({
      id: game.id,
      status: game.status,
      assistMode: game.assist_mode || "advisor",
      language: game.language || "ru",
      multiActionTurns: require("../rules/rules-engine").MULTI_ACTION_TURNS,
      countryName: game.country_name,
      turn: game.current_turn,
      date,
      stats: statsWithTerritories,
      relations: mergedRelations,
      policies: game.policies || [],
      overview: game.overview || {},
      contextSummary: game.context_summary || null,
      countryProfile: game.country_profile || null,
      newsfeed,
      log,
      pendingFactionDilemma,
    });
  });

  // ---------- POST /games/:gameId/faction-dilemma/resolve — Башни Кремля ----------
  fastify.post("/games/:gameId/faction-dilemma/resolve", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { gameId } = request.params;
    const { dilemmaId, choice } = request.body || {};
    const { FACTION_DILEMMAS, checkFactionDilemmaTrigger, resolveFactionDilemma } = require("../rules/rules-engine");

    if (!FACTION_DILEMMAS[dilemmaId]) return reply.code(400).send({ error: "Неизвестная дилемма" });
    if (!["optionA", "optionB", "compromise"].includes(choice)) return reply.code(400).send({ error: "Некорректный выбор" });

    const gameRes = await db.query(
      `SELECT g.id, g.current_turn, g.owner_user_id, gs.stats
       FROM games g JOIN game_state gs ON gs.game_id = g.id WHERE g.id = $1`,
      [gameId]
    );
    if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    const game = gameRes.rows[0];
    if (game.owner_user_id !== payload.userId) return reply.code(403).send({ error: "Нет доступа к этой партии" });

    // Пере-проверяем, что дилемма реально ожидает решения именно сейчас — не доверяем клиенту
    // на слово (защита от повторной отправки/устаревшего состояния на фронте).
    if (game.stats.faction_dilemma_resolved_turn === game.current_turn) {
      return reply.code(409).send({ error: "Дилемма этого хода уже разрешена" });
    }
    const actualDilemmaId = checkFactionDilemmaTrigger(game.stats, gameId, game.current_turn);
    if (actualDilemmaId !== dilemmaId) {
      return reply.code(409).send({ error: "Эта дилемма больше не актуальна" });
    }

    const seed = `${gameId}:${game.current_turn}:${dilemmaId}`;
    const result = resolveFactionDilemma(game.stats, dilemmaId, choice, seed);
    result.newStats.faction_dilemma_resolved_turn = game.current_turn;

    await db.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(result.newStats), gameId]);

    return reply.send({ statDeltas: result.statDeltas, outcome: result.outcome });
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
      `SELECT g.current_turn, g.status, g.language, gs.stats, gs.relations, c.name AS country_name, COALESCE(g.president_name, u.display_name) AS player_name
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
- Только JSON, без markdown-обёрток${languageInstruction(game.language)}`;

    try {
      const response = await callClaudeApi({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }, { gameId, purpose: "legacy" });
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

  // ---------- POST /games/:gameId/world-response ----------
  // Применяет небольшой стат-эффект от выбранной дипломатической реакции игрока
  // БАЛАНС (2026-07-08): раньше roll был Math.random() (единственное такое место в проекте —
  // нарушало собственный принцип детерминизма, см. комментарий у resolveUkraineResponse в
  // rules-engine.js) и не возвращал НИКАКОГО текста итога — только generic-лейбл ("Дипломатический
  // успех"/"Осложнение отношений"). По фидбеку игрока ("ответы выглядят как отписка") — тот же
  // рецепт, что уже применён к ответам на действия Украины: seededFraction вместо Math.random(),
  // + контекстный ИИ-нарратив итога (см. ai/world-response-outcome.js), + идемпотентность по
  // (turnN, source), которой раньше не было вовсе.
  const WORLD_RESPONSE_TYPES = new Set(["cooperate", "deescalate", "confront", "ignore"]);
  fastify.post("/games/:gameId/world-response", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { responseType, source, turnN, reactionText } = request.body || {};
    // responseType: "cooperate" | "deescalate" | "confront" | "ignore"
    // БЕЗОПАСНОСТЬ (2026-07-08): turnN/source раньше были опциональны — без них respondedKey
    // становился null, проверка "уже отвечено" и запись в stats.world_responses ПОЛНОСТЬЮ
    // пропускались (см. код ниже, было `if (respondedKey) ...`). Игрок, знающий API, мог слать
    // один и тот же запрос без turnN/source сколько угодно раз и бесплатно копить дипломатию/
    // экономику/одобрение без ограничений — эксплойт, ломающий честность лидерборда. Теперь оба
    // поля обязательны, а responseType валидируется явным списком (было — что угодно шло прямо
    // в resolveUkraineResponse-подобную логику ниже, никакого allowlist).
    if (turnN == null || !source) {
      return reply.code(400).send({ error: "turnN and source are required" });
    }
    if (!WORLD_RESPONSE_TYPES.has(responseType)) {
      return reply.code(400).send({ error: "Invalid responseType" });
    }

    const gsRes = await db.query(
      `SELECT gs.stats, g.language FROM game_state gs JOIN games g ON g.id = gs.game_id WHERE gs.game_id = $1`,
      [gameId]
    );
    if (gsRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });

    const stats = { ...gsRes.rows[0].stats };
    const responded = stats.world_responses || {};
    const respondedKey = `${turnN}:${source}`;
    if (responded[respondedKey]) {
      return reply.code(409).send({ error: "На эту реакцию уже был дан ответ" });
    }

    const { seededFraction } = require("../rules/rules-engine");
    const seed = `${gameId}:${respondedKey}:${responseType}`;
    const roll = seededFraction(`${seed}:worldResponse`);
    let delta = {};
    let outcome = "neutral";

    if (responseType === "cooperate") {
      // Сотрудничество — дипломатия растёт, вероятность бонуса к экономике
      delta.diplomacy = 2 + (roll < 0.4 ? 1 : 0);
      if (roll < 0.5) delta.economy = 1;
      if (roll < 0.15) { delta.approval = -1; outcome = "negative"; } else outcome = "positive";
    } else if (responseType === "deescalate") {
      // Деэскалация — дипломатия растёт, одобрение может упасть
      delta.diplomacy = 1 + (roll < 0.5 ? 1 : 0);
      if (roll < 0.35) { delta.approval = -1; outcome = "mixed"; }
      else if (roll < 0.7) { outcome = "positive"; }
      else { delta.stability = 1; outcome = "positive"; }
    } else if (responseType === "confront") {
      // Конфронтация — одобрение растёт, дипломатия страдает
      delta.approval = 1 + (roll < 0.45 ? 1 : 0);
      delta.diplomacy = roll < 0.6 ? -2 : -1;
      if (roll < 0.25) { delta.stability = -1; outcome = "mixed"; }
      else if (roll < 0.7) { outcome = "mixed"; }
      else { delta.military = 1; outcome = "positive"; }
    } else {
      // ignore — нет эффекта, случайный мелкий штраф или ничего
      if (roll < 0.3) delta.diplomacy = -1;
      outcome = roll < 0.3 ? "negative" : "neutral";
    }

    // Применяем дельту
    for (const [k, v] of Object.entries(delta)) {
      if (typeof stats[k] === "number") {
        stats[k] = Math.max(0, Math.min(100, stats[k] + v));
      }
    }

    stats.world_responses = { ...responded, [respondedKey]: responseType };

    let outcomeText = null;
    if (source && reactionText) {
      try {
        const { generateWorldResponseOutcome } = require("../ai/world-response-outcome");
        outcomeText = await generateWorldResponseOutcome({
          params: { source, reactionText, responseType, outcome, statDelta: delta, language: gsRes.rows[0].language },
          callClaudeApi,
          meta: { gameId, playerId: payload.userId, purpose: "world_response_outcome" },
        });
      } catch (e) {
        fastify.log.error({ err: e }, "world response outcome AI generation failed");
      }
    }

    await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(stats), gameId]);

    if (outcomeText) {
      const currentTurnRes = await db.query(`SELECT current_turn FROM games WHERE id = $1`, [gameId]);
      const currentTurn = currentTurnRes.rows[0]?.current_turn ?? turnN ?? 0;
      await db.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, currentTurn, "МИД", `Ответ на позицию ${source} (ход ${turnN ?? currentTurn}): ${outcomeText}`]
      );
    }

    return reply.send({ ok: true, delta, outcome, outcomeText });
  });

  // ---------- POST /games/:gameId/ukraine-response ----------
  // Игрок отвечает на действие Украины — применяет вероятностный эффект.
  // БАЛАНС (2026-07-04): раньше эта таблица дублировала (с расхождениями) отдельную таблицу в
  // backend/src/routes/turns.js (POST /turns/ukraine/respond) — теперь оба пути используют
  // resolveUkraineResponse() из rules-engine.js, единственный источник истины. Заодно добавлены
  // цена инициативы и риск war_escalation_counter при "retaliate".
  // БЕЗОПАСНОСТЬ (2026-07-08): turnN раньше был опционален ("старые фронтенды без turnN просто
  // теряют защиту, но не ломаются") — это был эксплойт: без turnN проверка "уже отвечено" и
  // запись в stats.ukraine_responses полностью пропускались (см. `if (turnN != null)` ниже по
  // коду), а initiativeCost floor'ится на 0 — то есть после траты инициативы в 0 ответ становится
  // ещё и бесплатным. Игрок, знающий API, мог слать один и тот же запрос без turnN сколько угодно
  // раз и копить статы бесплатно и бесконечно. Текущий фронтенд ВСЕГДА передаёт turnN (см.
  // sendUkraineResponse в api.js) — старых фронтендов без него в проде не осталось, требуем поле.
  const UKRAINE_RESPONSE_TYPES = new Set(["defend", "retaliate", "accept"]);
  fastify.post("/games/:gameId/ukraine-response", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { responseType, turnN } = request.body || {};
    if (turnN == null) return reply.code(400).send({ error: "turnN is required" });
    if (!UKRAINE_RESPONSE_TYPES.has(responseType)) {
      return reply.code(400).send({ error: "Invalid responseType" });
    }
    const { resolveUkraineResponse } = require("../rules/rules-engine");
    const { detectGameOutcome } = require("./turns");

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const gsRes = await client.query(
        `SELECT gs.stats, g.current_turn, g.language FROM game_state gs JOIN games g ON g.id = gs.game_id WHERE gs.game_id = $1 FOR UPDATE`,
        [gameId]
      );
      if (gsRes.rowCount === 0) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const stats = { ...gsRes.rows[0].stats };
      const responded = stats.ukraine_responses || {};
      if (responded[turnN]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "На это событие уже был дан ответ" });
      }

      const uaSeed = `${gameId}:${turnN}:${responseType}`;
      const { delta, outcome, outcomeText: fallbackOutcomeText, initiativeCost, warEscalationDelta } = resolveUkraineResponse(responseType, uaSeed);

      // БАЛАНС (2026-07-08): тот же контекстный ИИ-нарратив итога, что и в дублирующем пути
      // backend/src/routes/turns.js (POST /turns/ukraine/respond) — см. комментарий там же.
      let outcomeText = fallbackOutcomeText;
      try {
        const actionRes = await client.query(
          `SELECT source, text, reactions FROM newsfeed_items WHERE game_id = $1 AND turn_n = $2 AND item_type = 'ukraine_action' ORDER BY id DESC LIMIT 1`,
          [gameId, turnN]
        );
        if (actionRes.rowCount) {
          const { generateUkraineResponseOutcome } = require("../ai/ukraine-response-outcome");
          const { UA_CATEGORY_LABELS } = require("../rules/ukraine-rules-engine");
          const actionRow = actionRes.rows[0];
          const category = actionRow.reactions?.type;
          const aiText = await generateUkraineResponseOutcome({
            params: {
              actionTitle: (actionRow.source || "").replace(/^Украина\s*·\s*/, ""),
              actionText: actionRow.text,
              categoryLabel: UA_CATEGORY_LABELS[category] || null,
              responseType, outcome, statDelta: delta,
              language: gsRes.rows[0].language,
            },
            callClaudeApi,
            meta: { gameId, playerId: payload.userId, purpose: "ukraine_response_outcome" },
          });
          if (aiText) outcomeText = aiText;
        }
      } catch (e) {
        fastify.log.error({ err: e }, "ukraine response outcome AI generation failed, using fallback text");
      }

      for (const [k, v] of Object.entries(delta)) {
        if (k === "peace_progress") {
          stats.peace_progress = Math.max(0, Math.min(100, (stats.peace_progress ?? 0) + v));
        } else if (typeof stats[k] === "number") {
          stats[k] = Math.max(0, Math.min(100, stats[k] + v));
        }
      }
      if (initiativeCost) {
        stats.initiative = Math.max(0, (stats.initiative ?? 100) - initiativeCost);
      }
      if (warEscalationDelta) {
        stats.war_escalation_counter = Math.min(5, (stats.war_escalation_counter ?? 0) + warEscalationDelta);
      }
      stats.ukraine_responses = { ...responded, [turnN]: responseType };

      await client.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(stats), gameId]);

      // Ретейлиейт двигает war_escalation_counter немедленно (не только на confirm/end-month) —
      // без этой проверки поражение (defeat_war) обнаруживалось бы с опозданием на целый ход.
      const currentTurn = gsRes.rows[0].current_turn ?? turnN;
      const gameOutcome = detectGameOutcome(stats, currentTurn, 24);
      if (gameOutcome) {
        await client.query(`UPDATE games SET status = $1, updated_at = now() WHERE id = $2`, [gameOutcome, gameId]);
      }

      await client.query("COMMIT");

      return reply.send({ ok: true, delta, outcome, outcomeText, initiativeCost, warEscalationDelta, gameOutcome: gameOutcome || null });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ukraine response failed" });
    } finally {
      client.release();
    }
  });

  // ---------- GET /leaderboard — Зал Славы (только opt-in партии) ----------
  fastify.get("/leaderboard", async (request, reply) => {
    const { countryId, limit = 20 } = request.query;
    let queryText = `
      SELECT * FROM (
        SELECT DISTINCT ON (ls.game_id)
               ls.game_id, ls.turn_n, ls.score, ls.score_breakdown, ls.created_at,
               c.name AS country_name, c.id AS country_id,
               COALESCE(g.president_name, u.display_name) AS player_name
        FROM leaderboard_snap ls
        JOIN games g ON g.id = ls.game_id
        JOIN countries c ON c.id = g.country_id
        JOIN users u ON u.id = g.owner_user_id
        WHERE g.show_in_leaderboard = true
    `;
    const params = [];
    if (countryId) { queryText += ` AND c.id = $1`; params.push(countryId); }
    queryText += ` ORDER BY ls.game_id, ls.score DESC
      ) best_per_game
      ORDER BY score DESC LIMIT ${parseInt(limit, 10) || 20}`;
    const res = await db.query(queryText, params);
    return reply.send({ entries: res.rows });
  });

}

module.exports = { registerGameRoutes };
