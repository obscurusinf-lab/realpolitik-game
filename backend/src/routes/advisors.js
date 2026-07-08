/**
 * routes/advisors.js
 *
 * POST /games/:gameId/advisors/consult
 *   Body: { advisorId: string, playerDraft?: string, actionMode?: string }
 *   Returns: { advisor: {...}, optimalMove }
 *
 * Расход ИИ (Петя, 2026-07-08): раньше один вызов возвращал мнения ВСЕХ пяти советников —
 * фронт дёргал его автоматически при загрузке/смене режима/переключении вкладки, большая часть
 * из пяти мнений часто даже не читалась. Теперь запрос — на ОДНОГО советника по явному клику
 * (см. AdvisorsTab на фронте — портреты с приветствием без ИИ + кнопка "Жду ваш совет" на
 * каждого), advisorId обязателен.
 */

const { consultAdvisor, ADVISORS } = require("../ai/advisors");
const ADVISOR_IDS = new Set(ADVISORS.map(a => a.id));

async function registerAdvisorRoutes(fastify, { db, callClaudeApi }) {
  fastify.post("/games/:gameId/advisors/consult", async (request, reply) => {
    const { gameId } = request.params;
    const { advisorId, playerDraft, actionMode = "decree_reform" } = request.body || {};

    if (!advisorId || !ADVISOR_IDS.has(advisorId)) {
      return reply.code(400).send({ error: "advisorId is required and must be one of: " + [...ADVISOR_IDS].join(", ") });
    }

    const gameRes = await db.query(
      `SELECT g.current_turn, g.language, gs.stats, gs.relations, gs.policies, gs.overview, g.admin_advisor_notes,
              g.owner_user_id, c.name AS country_name, COALESCE(g.president_name, u.display_name) AS player_name
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
      `SELECT turn_n, player_input, narrative_text, stats_snapshot, gm_classification->>'action_type' AS action_type
       FROM turns WHERE game_id = $1 ORDER BY turn_n DESC LIMIT 5`,
      [gameId]
    );
    const recentHistory = historyRes.rows.reverse();
    // Snapshot'ы статов по ходам — источник для расчёта темпа изменения (см. computeVelocity
    // в advisors.js). Нужны только строки, где snapshot реально записан (может отсутствовать
    // у самых старых ходов до введения колонки).
    const statHistory = recentHistory
      .filter(h => h.stats_snapshot)
      .map(h => ({ turn_n: h.turn_n, stats: h.stats_snapshot }));
    // Категории недавних решений (econ_stimulus, mil_operational_offensive, ...) — источник
    // для антидубликатной проверки в computeOptimalMove (см. её комментарий): без этого
    // "оптимальный ход" рекомендовал одну и ту же реформу каждый ход, игрок подписывал её
    // повторно поверх ещё не отработавшей — см. реальную партию, где 5 реформ за 3 хода
    // угробили экономику быстрее, чем успели дать эффект.
    const recentCategories = recentHistory.map(h => h.action_type).filter(Boolean);

    const result = await consultAdvisor({
      params: {
        countryName: game.country_name,
        playerName: game.player_name || null,
        gameDate: game.overview?.date || "—",
        turnNumber: game.current_turn + 1,
        stats: game.stats,
        relations: game.relations,
        policies: game.policies || [],
        recentHistory,
        statHistory,
        recentCategories,
        playerDraft: playerDraft?.trim() || null,
        actionMode: actionMode || "decree_reform",
        language: game.language,
      },
      advisorId,
      callClaudeApi,
      meta: { gameId, playerId: game.owner_user_id, purpose: "advisors_consult" },
    });

    // Ручная правка админа (2026-07-06, POST /admin/games/:gameId/advisor-note) — подменяет
    // текст рекомендации конкретного министра ПОСЛЕ генерации ИИ, персистентно (пока админ не
    // сменит/не очистит заметку) — не одноразово, в отличие от очереди действия Украины.
    const notes = game.admin_advisor_notes || {};
    if (notes[advisorId]) {
      result.advisor = { ...result.advisor, recommendation: notes[advisorId], admin_note: true };
    }

    return reply.send(result);
  });
}

module.exports = { registerAdvisorRoutes };
