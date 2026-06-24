/**
 * routes/users.js
 *
 * POST /users — создать анонимного пользователя (или с email).
 * GET  /users/:userId — получить профиль.
 */

async function registerUserRoutes(fastify, { db }) {
  fastify.post("/users", async (request, reply) => {
    const { displayName = "Игрок", email = null } = request.body || {};
    const res = await db.query(
      `INSERT INTO users (display_name, email, is_anonymous)
       VALUES ($1, $2, $3) RETURNING id, display_name, email, is_anonymous, created_at`,
      [displayName, email, email === null]
    );
    return reply.code(201).send(res.rows[0]);
  });

  fastify.get("/users/:userId", async (request, reply) => {
    const res = await db.query(
      `SELECT id, display_name, email, is_anonymous, created_at FROM users WHERE id = $1`,
      [request.params.userId]
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "User not found" });
    return reply.send(res.rows[0]);
  });
}

module.exports = { registerUserRoutes };
