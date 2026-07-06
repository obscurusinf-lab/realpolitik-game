/**
 * routes/advisors.js
 *
 * POST /games/:gameId/advisors/consult
 *   Body: { playerDraft?: string }  — черновик решения (опционально)
 *   Returns: { advisors: [...] }
 */

const { consultAdvisors } = require("../ai/advisors");

async function registerAdvisorRoutes(fastify, { db, callClaudeApi }) {
  fastify.post("/games/:gameId/advisors/consult", async (request, reply) => {
    const { gameId } = request.params;
    const { playerDraft, actionMode = "decree_reform" } = request.body || {};

    const gameRes = await db.query(
      `SELECT g.current_turn, gs.stats, gs.relations, gs.policies, gs.overview, g.admin_advisor_notes,
              c.name AS country_name, COALESCE(g.president_name, u.display_name) AS player_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       LEFT JOIN users u ON u.id = g.owner_user_id
       WHERE g.id = $1`,
      [gameId]
    );
    if (gameRes.rowCount === 0) {
      return reply.code(404).send({ error: "Game not found" });
    }
    const game = gameRes.rows[0];

    // Последние 5 ходов для памяти советников
    const historyRes = await db.query(
      `SELECT turn_n, player_input, narrative_text
       FROM turns WHERE game_id = $1 ORDER BY turn_n DESC LIMIT 5`,
      [gameId]
    );
    const recentHistory = historyRes.rows.reverse();

    const result = await consultAdvisors({
      params: {
        countryName: game.country_name,
        playerName: game.player_name || null,
        gameDate: game.overview?.date || "—",
        turnNumber: game.current_turn + 1,
        stats: game.stats,
        relations: game.relations,
        policies: game.policies || [],
        recentHistory,
        playerDraft: playerDraft?.trim() || null,
        actionMode: actionMode || "decree_reform",
      },
      callClaudeApi,
    });

    // Ручная правка админа (2026-07-06, POST /admin/games/:gameId/advisor-note) — подменяет
    // текст рекомендации конкретного министра ПОСЛЕ генерации ИИ, персистентно (пока админ не
    // сменит/не очистит заметку) — не одноразово, в отличие от очереди действия Украины.
    const notes = game.admin_advisor_notes || {};
    if (Object.keys(notes).length > 0 && Array.isArray(result.advisors)) {
      result.advisors = result.advisors.map(a =>
        notes[a.id] ? { ...a, recommendation: notes[a.id], admin_note: true } : a
      );
    }

    return reply.send(result);
  });
}

module.exports = { registerAdvisorRoutes };
