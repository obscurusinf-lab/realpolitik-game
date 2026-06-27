/**
 * routes/auth.js
 *
 * POST /auth/register
 * POST /auth/login
 * GET  /auth/me
 */

const bcrypt = require("bcryptjs");
const { verifyToken, signToken } = require("../middleware/auth");

const SALT_ROUNDS = 12;

function validatePassword(pw) {
  if (!pw || pw.length < 6) return "Пароль — минимум 6 символов";
  return null;
}
function validateUsername(u) {
  if (!u || u.trim().length < 3) return "Имя пользователя — минимум 3 символа";
  if (!/^[a-zA-Z0-9_а-яёА-ЯЁ]+$/u.test(u.trim())) return "Только буквы, цифры и _";
  return null;
}

async function registerAuthRoutes(fastify, { db }) {

  fastify.post("/auth/register", async (request, reply) => {
    const { username, password, displayName } = request.body || {};

    const uErr = validateUsername(username);
    if (uErr) return reply.code(400).send({ error: uErr });
    const pErr = validatePassword(password);
    if (pErr) return reply.code(400).send({ error: pErr });

    const name = (displayName || username).trim();

    const exists = await db.query(
      `SELECT id FROM users WHERE username = $1`,
      [username.trim().toLowerCase()]
    );
    if (exists.rowCount > 0) {
      return reply.code(409).send({ error: "Такое имя пользователя уже занято" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const res = await db.query(
      `INSERT INTO users (display_name, username, password_hash, is_anonymous)
       VALUES ($1, $2, $3, false) RETURNING id, display_name, username`,
      [name, username.trim().toLowerCase(), passwordHash]
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
    if (res.rowCount === 0) {
      return reply.code(401).send({ error: "Неверный логин или пароль" });
    }
    const user = res.rows[0];
    if (!user.password_hash) {
      return reply.code(401).send({ error: "Этот аккаунт создан без пароля — зарегистрируйтесь заново" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.code(401).send({ error: "Неверный логин или пароль" });

    const token = signToken({ userId: user.id, username: user.username });
    return reply.send({ token, userId: user.id, username: user.username, displayName: user.display_name });
  });

  fastify.get("/auth/me", async (request, reply) => {
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const res = await db.query(
      `SELECT id, display_name, username, created_at FROM users WHERE id = $1`,
      [payload.userId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "User not found" });
    return reply.send(res.rows[0]);
  });
}

module.exports = { registerAuthRoutes };
