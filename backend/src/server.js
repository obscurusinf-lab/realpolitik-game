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
const { registerAdminRoutes } = require("./routes/admin");
const { createPendingTurnStore } = require("./db/pending-turns");
const { createAdminEventStore } = require("./db/admin-events");
const { callClaudeApi } = require("./ai/claude-client");

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
    methods: ["GET", "POST", "OPTIONS"],
  });

  fastify.get("/health", async () => ({ status: "ok", version: "auth-v3" }));

  // --- Postgres ---
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL env var is required");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query("SELECT 1");
  fastify.log.info("Postgres connected");

  // Миграции
  await db.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS action_mode TEXT NOT NULL DEFAULT 'decree'`);
  await db.query(`ALTER TABLE game_state ADD COLUMN IF NOT EXISTS initiative INT NOT NULL DEFAULT 100`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username) WHERE username IS NOT NULL`);

  // --- Redis ---
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL env var is required");
  const redis = new Redis(process.env.REDIS_URL);
  redis.on("error", (err) => fastify.log.error({ err }, "Redis error"));
  fastify.log.info("Redis client created");

  const pendingTurnStore = createPendingTurnStore(redis);
  const adminEventStore = createAdminEventStore(redis);

  // --- Auth роуты (инлайн) ---
  fastify.post("/auth/register", async (request, reply) => {
    const { username, password, displayName } = request.body || {};
    if (!username || username.trim().length < 3) return reply.code(400).send({ error: "Имя пользователя — минимум 3 символа" });
    if (!password || password.length < 6) return reply.code(400).send({ error: "Пароль — минимум 6 символов" });
    const name = (displayName || username).trim();
    const uname = username.trim().toLowerCase();
    const exists = await db.query(`SELECT id FROM users WHERE username = $1`, [uname]);
    if (exists.rowCount > 0) return reply.code(409).send({ error: "Такое имя пользователя уже занято" });
    const passwordHash = await bcrypt.hash(password, 12);
    const res = await db.query(
      `INSERT INTO users (display_name, username, password_hash, is_anonymous) VALUES ($1, $2, $3, false) RETURNING id, display_name, username`,
      [name, uname, passwordHash]
    );
    const user = res.rows[0];
    const token = signToken({ userId: user.id, username: user.username });
    return reply.code(201).send({ token, userId: user.id, username: user.username, displayName: user.display_name });
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

  fastify.get("/auth/me", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const res = await db.query(`SELECT id, display_name, username, created_at FROM users WHERE id = $1`, [payload.userId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "User not found" });
    return reply.send(res.rows[0]);
  });

  // --- Остальные роуты ---
  await registerUserRoutes(fastify, { db });
  await registerGameRoutes(fastify, { db, callClaudeApi, verifyToken });
  await registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore, verifyToken });
  await registerAdvisorRoutes(fastify, { db, callClaudeApi });
  await registerSuggestionRoutes(fastify, { db, callClaudeApi });
  await registerArgueRoute(fastify, { db, callClaudeApi, pendingTurnStore });
  await registerAdminRoutes(fastify, { db, callClaudeApi, adminEventStore });

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
