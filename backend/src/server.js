require("dotenv").config();

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const { Pool } = require("pg");
const Redis = require("ioredis");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { registerTurnRoutes } = require("./routes/turns");
const { registerGameRoutes } = require("./routes/games");
const { registerUserRoutes } = require("./routes/users");
const { registerAdvisorRoutes } = require("./routes/advisors");
const { registerSuggestionRoutes } = require("./routes/suggestions");
const { registerArgueRoute } = require("./routes/argue");
const { registerTreasuryRoutes } = require("./routes/treasury");
const { registerAdminRoutes } = require("./routes/admin");
const { registerFeedbackRoutes } = require("./routes/feedback");
const { createPendingTurnStore } = require("./db/pending-turns");
const { createAdminEventStore } = require("./db/admin-events");
const { callClaudeApi: rawCallClaudeApi } = require("./ai/claude-client");
const { wrapCallClaudeApi } = require("./ai/usage-tracker");
const { recordEvent } = require("./db/player-events");
const { checkNameBlocklist } = require("./lib/name-blocklist");

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var is required");
  return s;
}
function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "30d" });
}
function verifyToken(request, reply) {
  const header = request.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { reply.code(401).send({ error: "Авторизация требуется" }); return null; }
  try { return jwt.verify(token, getJwtSecret()); }
  catch { reply.code(401).send({ error: "Токен недействителен или истёк" }); return null; }
}

async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
      : true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  fastify.get("/health", async () => ({ status: "ok", version: "auth-v3" }));
  fastify.get("/debug-routes", async () => ({ authRegistered: true, ts: Date.now() }));

  // --- Postgres ---
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL env var is required");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query("SELECT 1");
  fastify.log.info("Postgres connected");

  // Миграции
  await db.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS action_mode TEXT NOT NULL DEFAULT 'decree'`);
  // stats_snapshot отсутствовал в исходном schema.sql (был добавлен на проде вручную,
  // без миграции) — turns.js уже полагается на него (INSERT + stat-history SELECT).
  // Найдено при локальном end-to-end тестировании новых категорий действий.
  await db.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS stats_snapshot JSONB`);
  await db.query(`ALTER TABLE game_state ADD COLUMN IF NOT EXISTS initiative INT NOT NULL DEFAULT 100`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  // Режим помощи партии: 'advisor' (с советниками) | 'hardcore' (без подсказок). Закреплён за партией.
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS assist_mode TEXT NOT NULL DEFAULT 'advisor'`);
  // Мульти-режим: несколько действий за месяц делят один turn_n — снимаем уникальность.
  await db.query(`ALTER TABLE turns DROP CONSTRAINT IF EXISTS turns_game_id_turn_n_key`).catch(() => {});
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username) WHERE username IS NOT NULL`);
  // Профиль страны для брифинга: общее описание + сильные/слабые стороны (статично, не "текущие события").
  await db.query(`ALTER TABLE countries ADD COLUMN IF NOT EXISTS country_profile JSONB`);
  // Имя президента — закреплено за конкретной партией, отдельно от логина/аккаунта.
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS president_name TEXT`);
  // Зал Славы: игрок явно соглашается на публикацию результата.
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS show_in_leaderboard BOOLEAN NOT NULL DEFAULT false`);
  // Обратная связь / баг-репорты от игроков.
  await db.query(`
    CREATE TABLE IF NOT EXISTS feedback_items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID REFERENCES users(id),
      game_id     UUID REFERENCES games(id),
      message     TEXT NOT NULL,
      contact     TEXT,
      page        TEXT,
      status      TEXT NOT NULL DEFAULT 'new',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Заполнить country_profile для существующих стран (идемпотентно — только если NULL).
  const russiaProfile = require("./db/seed/countries/russia-2026-06.json");
  await db.query(
    `UPDATE countries SET country_profile = $1 WHERE id = $2 AND country_profile IS NULL`,
    [JSON.stringify(russiaProfile.country_profile), russiaProfile.id]
  );

  // --- Redis ---
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL env var is required");
  const redis = new Redis(process.env.REDIS_URL);
  redis.on("error", (err) => fastify.log.error({ err }, "Redis error"));
  fastify.log.info("Redis client created");

  const pendingTurnStore = createPendingTurnStore(redis);
  const adminEventStore = createAdminEventStore(redis);

  // --- Auth роуты (инлайн) ---
  // Гостевые инвайт-коды (2026-07-10, Петя — перед публичным постом): без кода регистрация
  // недоступна, чтобы неограниченный поток анонимных регистраций не сжёг бюджет на Claude API.
  // 10 одноразовых гостевых кодов (tier=guest → account_tier='guest', особое, более сдержанное
  // поведение геймместера на шуточные указы — см. gamemaster.js) + 1 админский код без лимита
  // использований (tier=admin → account_tier='unrestricted', для друзей). См. миграцию 0004 и
  // backend/scripts/seed-invite-codes.js.
  fastify.post("/auth/register", async (request, reply) => {
    const { username, password, displayName, inviteCode } = request.body || {};
    if (!username || username.trim().length < 3) return reply.code(400).send({ error: "Имя пользователя — минимум 3 символа" });
    if (!password || password.length < 6) return reply.code(400).send({ error: "Пароль — минимум 6 символов" });
    if (!inviteCode || !inviteCode.trim()) return reply.code(400).send({ error: "Нужен код приглашения" });
    const name = (displayName || username).trim();
    const blocked = checkNameBlocklist(name);
    if (blocked) return reply.code(409).send({ error: blocked.tier === "hard" ? "no way" : "Это имя уже занято" });
    const uname = username.trim().toLowerCase();
    const exists = await db.query(`SELECT id FROM users WHERE username = $1`, [uname]);
    if (exists.rowCount > 0) return reply.code(409).send({ error: "Такое имя пользователя уже занято" });

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Атомарно "сжигаем" один слот использования — WHERE-условие в UPDATE не даёт двум
      // параллельным регистрациям по одному и тому же коду обеим пройти мимо лимита (одна
      // из них получит rowCount=0 и отвалится с понятной ошибкой).
      const codeRes = await client.query(
        `UPDATE invite_codes SET times_used = times_used + 1
         WHERE code = $1 AND (max_uses IS NULL OR times_used < max_uses)
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING tier`,
        [inviteCode.trim()]
      );
      if (codeRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Код приглашения недействителен, истёк или уже использован" });
      }
      const accountTier = codeRes.rows[0].tier === "admin" ? "unrestricted" : "guest";

      const res = await client.query(
        `INSERT INTO users (display_name, username, password_hash, is_anonymous, account_tier)
         VALUES ($1, $2, $3, false, $4) RETURNING id, display_name, username`,
        [name, uname, passwordHash, accountTier]
      );
      await client.query("COMMIT");

      const user = res.rows[0];
      const token = signToken({ userId: user.id, username: user.username });
      recordEvent(db, { playerId: user.id, eventType: "registered", payload: { username: user.username, accountTier } });
      return reply.code(201).send({ token, userId: user.id, username: user.username, displayName: user.display_name });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Не удалось зарегистрироваться" });
    } finally {
      client.release();
    }
  });

  fastify.post("/auth/login", async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) return reply.code(400).send({ error: "Укажите логин и пароль" });
    const res = await db.query(
      `SELECT id, display_name, username, password_hash FROM users WHERE username = $1`,
      [username.trim().toLowerCase()]
    );
    if (res.rowCount === 0) return reply.code(401).send({ error: "Неверный логин или пароль" });
    const user = res.rows[0];
    if (!user.password_hash) return reply.code(401).send({ error: "Этот аккаунт создан без пароля — зарегистрируйтесь заново" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.code(401).send({ error: "Неверный логин или пароль" });
    const token = signToken({ userId: user.id, username: user.username });
    return reply.send({ token, userId: user.id, username: user.username, displayName: user.display_name });
  });

  fastify.post("/auth/update-name", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { displayName } = request.body || {};
    const name = (displayName || "").trim();
    if (name.length < 2) return reply.code(400).send({ error: "Имя — минимум 2 символа" });
    if (name.length > 40) return reply.code(400).send({ error: "Имя — максимум 40 символов" });
    const blocked = checkNameBlocklist(name);
    if (blocked) return reply.code(409).send({ error: blocked.tier === "hard" ? "no way" : "Это имя уже занято" });
    const res = await db.query(
      `UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, display_name, username`,
      [name, payload.userId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "User not found" });
    const user = res.rows[0];
    return reply.send({ userId: user.id, username: user.username, displayName: user.display_name });
  });

  fastify.get("/auth/me", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const res = await db.query(`SELECT id, display_name, username, created_at FROM users WHERE id = $1`, [payload.userId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "User not found" });
    return reply.send(res.rows[0]);
  });

  fastify.log.info("AUTH ROUTES REGISTERED OK");

  // callClaudeApi обёрнут ОДИН раз здесь (usage-tracker.js) — каждый вызов из любого ai/*-модуля
  // (gamemaster/advisors/ukraine-action*/worldUpdate/suggestions/argue/admin) автоматически
  // пишется в ai_usage, без правки самого claude-client.js.
  const callClaudeApi = wrapCallClaudeApi({ db, callClaudeApi: rawCallClaudeApi, logger: fastify.log });

  // --- Остальные роуты ---
  await registerUserRoutes(fastify, { db });
  await registerGameRoutes(fastify, { db, callClaudeApi, verifyToken });
  await registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore, verifyToken });
  await registerAdvisorRoutes(fastify, { db, callClaudeApi });
  await registerSuggestionRoutes(fastify, { db, callClaudeApi });
  await registerArgueRoute(fastify, { db, callClaudeApi, pendingTurnStore });
  await registerTreasuryRoutes(fastify, { db, verifyToken });
  await registerAdminRoutes(fastify, { db, callClaudeApi, adminEventStore });
  await registerFeedbackRoutes(fastify, { db, verifyToken });

  const shutdown = async () => {
    fastify.log.info("Shutting down…");
    await fastify.close();
    await db.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return fastify;
}

async function main() {
  const fastify = await buildServer();
  const port = parseInt(process.env.PORT || "3000", 10);
  await fastify.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
