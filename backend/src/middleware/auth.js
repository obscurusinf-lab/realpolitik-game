/**
 * middleware/auth.js
 *
 * verifyToken(request) — извлекает JWT из заголовка Authorization,
 * проверяет подпись, возвращает { userId, username }.
 * Бросает 401 если токен отсутствует или невалиден.
 */

const jwt = require("jsonwebtoken");

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var is required");
  return s;
}

function verifyToken(request, reply) {
  const header = request.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    reply.code(401).send({ error: "Авторизация требуется" });
    return null;
  }
  try {
    return jwt.verify(token, getSecret());
  } catch {
    reply.code(401).send({ error: "Токен недействителен или истёк" });
    return null;
  }
}

function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: "30d" });
}

module.exports = { verifyToken, signToken };
