/**
 * routes/feedback.js
 *
 * POST /feedback — баг-репорт / обратная связь от игрока.
 * Авторизация не обязательна (можно слать с экрана входа), но если есть токен — привязываем к юзеру.
 */

async function registerFeedbackRoutes(fastify, { db, verifyToken }) {
  // Лимит на base64-аудио (2026-07-19, "дать возможность наговорить баг-репорт") — сообщения
  // короткие (фронт ограничивает запись по времени), но защищаемся от намеренно раздутого
  // payload'а: ~4MB base64 ≈ 3MB сырых данных, с запасом хватает на голосовую заметку минуты
  // на 2-3 в webm/opus (низкий битрейт), без отдельного object storage это разумный потолок для
  // TEXT-колонки и JSON-тела запроса.
  const MAX_AUDIO_BASE64_LEN = 4 * 1024 * 1024;

  fastify.post("/feedback", async (request, reply) => {
    const { message, contact, gameId, page, audioBase64, audioMime } = request.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return reply.code(400).send({ error: "message required" });
    }
    if (message.length > 4000) {
      return reply.code(400).send({ error: "Сообщение слишком длинное (максимум 4000 символов)" });
    }
    if (audioBase64 !== undefined && audioBase64 !== null) {
      if (typeof audioBase64 !== "string" || typeof audioMime !== "string" || !audioMime.startsWith("audio/")) {
        return reply.code(400).send({ error: "Некорректное аудио" });
      }
      if (audioBase64.length > MAX_AUDIO_BASE64_LEN) {
        return reply.code(400).send({ error: "Аудиосообщение слишком большое" });
      }
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
      `INSERT INTO feedback_items (user_id, game_id, message, contact, page, audio_data, audio_mime) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        userId, gameId || null, message.trim(), (contact || "").trim().slice(0, 200) || null, (page || "").slice(0, 100) || null,
        audioBase64 || null, audioBase64 ? audioMime : null,
      ]
    );

    return reply.code(201).send({ ok: true });
  });
}

module.exports = { registerFeedbackRoutes };
