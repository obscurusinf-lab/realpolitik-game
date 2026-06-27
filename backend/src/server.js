/**
 * server.js
 *
 * Точка входа. Поднимает Fastify, подключает Postgres и Redis,
 * регистрирует все роуты и запускает сервер.
 *
 * Переменные окружения (см. .env.example):
 *   PORT              — порт (default: 3000)
 *   DATABASE_URL      — postgres connection string
 *   REDIS_URL         — redis connection string (ioredis формат)
 *   ANTHROPIC_API_KEY — ключ Claude API
 *   CORS_ORIGIN       — разрешённый origin фронта (default: http://localhost:5173)
 */

require("dotenv").config();

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const { Pool } = require("pg");
const Redis = require("ioredis");

const { registerTurnRoutes } = require("./routes/turns");
const { registerGameRoutes } = require("./routes/games");
const { registerUserRoutes } = require("./routes/users");
const { registerAdvisorRoutes } = require("./routes/advisors");
const { registerSuggestionRoutes } = require("./routes/suggestions");
const { registerArgueRoute } = require("./routes/argue");
const { registerAdminRoutes } = require("./routes/admin");
const { registerAuthRoutes } = require("./routes/auth");
const { createPendingTurnStore } = require("./db/pending-turns");
const { createAdminEventStore } = require("./db/admin-events");
const { callClaudeApi } = require("./ai/claude-client");

async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
      : true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  fastify.get("/health", async (req, reply) => {
    const fs = require("fs");
    const hasAuth = fs.existsSync("/app/src/routes/auth.js");
    const hasMiddleware = fs.existsSync("/app/src/middleware/auth.js");
    return { status: "ok", version: "auth-v2", hasAuth, hasMiddleware };
  });

  // --- Postgres ---
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL env var is required");
  }
  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  // Проверяем соединение при старте
  await db.query("SELECT 1");
  fastify.log.info("Postgres connected");

  // Миграции (идемпотентные)
  await db.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS action_mode TEXT NOT NULL DEFAULT 'decree'`);
  await db.query(`ALTER TABLE game_state ADD COLUMN IF NOT EXISTS initiative INT NOT NULL DEFAULT 100`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username) WHERE username IS NOT NULL`);

  // --- Redis ---
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL env var is required");
  }
  const redis = new Redis(process.env.REDIS_URL);
  redis.on("error", (err) => fastify.log.error({ err }, "Redis error"));
  fastify.log.info("Redis client created");

  const pendingTurnStore = createPendingTurnStore(redis);
  const adminEventStore = createAdminEventStore(redis);

  // --- Роуты ---
  await registerAuthRoutes(fastify, { db });
  await registerUserRoutes(fastify, { db });
  await registerGameRoutes(fastify, { db, callClaudeApi });
  await registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore });
  await registerAdvisorRoutes(fastify, { db, callClaudeApi });
  await registerSuggestionRoutes(fastify, { db, callClaudeApi });
  await registerArgueRoute(fastify, { db, callClaudeApi, pendingTurnStore });
  await registerAdminRoutes(fastify, { db, callClaudeApi, adminEventStore });

  // Грейсфул-шатдаун
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
