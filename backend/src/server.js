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
const { createPendingTurnStore } = require("./db/pending-turns");
const { callClaudeApi } = require("./ai/claude-client");

async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
      : true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  fastify.get("/health", async () => ({ status: "ok" }));

  // --- Postgres ---
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL env var is required");
  }
  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  // Проверяем соединение при старте
  await db.query("SELECT 1");
  fastify.log.info("Postgres connected");

  // --- Redis ---
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL env var is required");
  }
  const redis = new Redis(process.env.REDIS_URL);
  redis.on("error", (err) => fastify.log.error({ err }, "Redis error"));
  fastify.log.info("Redis client created");

  const pendingTurnStore = createPendingTurnStore(redis);

  // --- Роуты ---
  await registerUserRoutes(fastify, { db });
  await registerGameRoutes(fastify, { db });
  await registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore });
  await registerAdvisorRoutes(fastify, { db, callClaudeApi });
  await registerSuggestionRoutes(fastify, { db, callClaudeApi });
  await registerArgueRoute(fastify, { db, callClaudeApi, pendingTurnStore });

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
