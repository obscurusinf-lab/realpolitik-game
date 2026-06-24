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

  // --- Admin stats (защищён паролем через заголовок) ---
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "realpolitik-admin";
  fastify.get("/admin/stats", async (request, reply) => {
    if (request.headers["x-admin-password"] !== ADMIN_PASSWORD) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const [usersRes, gamesRes, turnsRes, topPlayersRes] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN created_at > now() - interval '24 hours' THEN 1 END) AS today FROM users`),
      db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'active' THEN 1 END) AS active FROM games`),
      db.query(`SELECT COUNT(*) AS total FROM turns`),
      db.query(`
        SELECT u.display_name, g.country_id, g.current_turn, g.created_at,
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
      players: topPlayersRes.rows,
    });
  });

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
