/**
 * routes/feedback.js
 *
 * POST /feedback — баг-репорт / обратная связь от игрока.
 * Авторизация не обязательна (можно слать с экрана входа), но если есть токен — привязываем к юзеру.
 */

async function registerFeedbackRoutes(fastify, { db, verifyToken }) {
  fastify.post("/feedback", async (request, reply) => {
    const { message, contact, gameId, page } = request.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return reply.code(400).send({ error: "message required" });
    }
    if (message.length > 4000) {
      return reply.code(400).send({ error: "Сообщение слишком длинное (максимум 4000 символов)" });
    }

    let userId = null;
    const header = request.headers["authorization"] || "";
    if (header.startsWith("Bearer ")) {
      try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        userId = payload.userId;
      } catch { /* анонимный фидбек тоже ок */ }
    }

    await db.query(
      `INSERT INTO feedback_items (user_id, game_id, message, contact, page) VALUES ($1,$2,$3,$4,$5)`,
      [userId, gameId || null, message.trim(), (contact || "").trim().slice(0, 200) || null, (page || "").slice(0, 100) || null]
    );

    return reply.code(201).send({ ok: true });
  });
}

module.exports = { registerFeedbackRoutes };
