/**
 * routes/suggestions.js
 *
 * POST /games/:gameId/suggestions
 * Возвращает 5-6 конкретных вариантов указов под текущую ситуацию.
 * Лёгкий вызов (~400 токенов ответа) — нет валидации, нет retry.
 */

async function registerSuggestionRoutes(fastify, { db, callClaudeApi }) {
  fastify.post("/games/:gameId/suggestions", async (request, reply) => {
    const { gameId } = request.params;

    const gameRes = await db.query(
      `SELECT g.current_turn, gs.stats, gs.relations, gs.overview, gs.policies, c.name AS country_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       WHERE g.id = $1`,
      [gameId]
    );
    if (gameRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });
    const game = gameRes.rows[0];

    const historyRes = await db.query(
      `SELECT turn_n, player_input FROM turns WHERE game_id = $1 ORDER BY turn_n DESC LIMIT 3`,
      [gameId]
    );
    const recentTurns = historyRes.rows.reverse();

    const prompt = buildSuggestionsPrompt(game, recentTurns);

    const response = await callClaudeApi({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json\s*|\s*```/g, "").trim());
    } catch {
      return reply.send({ suggestions: fallbackSuggestions() });
    }

    return reply.send({ suggestions: parsed.suggestions || fallbackSuggestions() });
  });
}

function buildSuggestionsPrompt(game, recentTurns) {
  const stats = game.stats;
  const weakStats = Object.entries(stats)
    .filter(([, v]) => v < 45)
    .map(([k]) => k)
    .join(", ") || "всё в норме";

  const historyText = recentTurns.length
    ? recentTurns.map(t => `Ход ${t.turn_n}: "${t.player_input}"`).join("; ")
    : "партия только началась";

  return `Ты — помощник в геополитической стратегии. Игрок управляет ${game.country_name}, ход ${game.current_turn + 1}.

Текущие показатели: ${JSON.stringify(stats)}
Слабые места: ${weakStats}
Последние решения: ${historyText}

Сгенерируй ровно 6 конкретных, разнообразных вариантов президентского указа — коротких (1 предложение), реалистичных, на русском языке. Охвати разные сферы (военную, дипломатическую, экономическую, внутреннюю). Учти слабые места в показателях.

Верни ТОЛЬКО JSON без markdown:
{"suggestions": ["текст указа 1", "текст указа 2", "текст указа 3", "текст указа 4", "текст указа 5", "текст указа 6"]}`;
}

function fallbackSuggestions() {
  return [
    "Объявить частичную мобилизацию резервистов для усиления обороны границ",
    "Инициировать переговоры с ключевыми союзниками об углублении сотрудничества",
    "Запустить программу импортозамещения в стратегических отраслях промышленности",
    "Провести показательные учения вооружённых сил у западных границ",
    "Ввести новые меры социальной поддержки для снижения внутренней напряжённости",
    "Направить дипломатическую миссию в нейтральные страны для зондирования позиций",
  ];
}

module.exports = { registerSuggestionRoutes };
