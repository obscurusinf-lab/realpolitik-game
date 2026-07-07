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
    const { actionMode = "decree" } = request.body || {};

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

    const prompt = buildSuggestionsPrompt(game, recentTurns, actionMode);

    const response = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }, { gameId, purpose: "suggestions" });

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

const MODE_CONTEXT = {
  decree: {
    label: "президентских указов",
    focus: "быстрые оперативные решения: законы, постановления, разовые меры поддержки, публичные объявления — эффект в течение 1-2 месяцев. НЕ предлагай структурных многолетних реформ.",
    examples: "«Ввести налоговые льготы для ОПК», «Подписать соглашение о торговле с Ираном», «Объявить амнистию политзаключённым»",
  },
  decree_reform: {
    label: "системных реформ",
    focus: "структурные преобразования на 3-6 месяцев, затрагивающие целую отрасль или институт. Реформа должна менять систему, а не быть разовым указом. Формат: «Провести реформу X», «Перестроить систему Y», «Создать новый институт Z». Каждый вариант — самостоятельная системная инициатива.",
    examples: "«Провести пенсионную реформу с накопительным компонентом», «Реформировать налоговую систему — переход на прогрессивную шкалу», «Создать государственный инвестиционный фонд технологического суверенитета», «Реструктурировать ВПК под условия длительной войны»",
  },
  decree_program: {
    label: "крупных государственных программ",
    focus: "масштабные многолетние программы на 7-12 месяцев с бюджетом, этапами и KPI. Это национальные проекты, государственные программы, стратегии развития целых секторов. Формат: «Запустить национальный проект X», «Принять государственную программу Y на N лет».",
    examples: "«Запустить национальный проект технологического суверенитета в микроэлектронике», «Принять государственную программу переселения с малонаселённых территорий», «Создать корпорацию развития Арктики с капиталом 2 трлн рублей»",
  },
  intel: {
    label: "разведывательных операций",
    focus: "тайные операции спецслужб: вербовка агентов, кибератаки, дезинформация, компромат, провокации, слежка, саботаж — всё засекреченно и не публично.",
    examples: "«Завербовать источник в окружении лидера оппозиции», «Запустить дезинформационную кампанию против Украины в соцсетях», «Организовать утечку компрометирующих материалов на западного чиновника»",
  },
  military: {
    label: "военных операций",
    focus: "прямые военные приказы и операции: переброска войск, ракетные удары, учения с реальными целями, блокады, захват позиций, военная поддержка союзников.",
    examples: "«Нанести удар крылатыми ракетами по военной инфраструктуре противника», «Перебросить дополнительные силы на северный фланг», «Ввести морскую блокаду порта Одесса»",
  },
};

function buildSuggestionsPrompt(game, recentTurns, actionMode = "decree") {
  const stats = game.stats;
  const weakStats = Object.entries(stats)
    .filter(([, v]) => v < 45)
    .map(([k]) => k)
    .join(", ") || "всё в норме";

  const historyText = recentTurns.length
    ? recentTurns.map(t => `Ход ${t.turn_n}: "${t.player_input}"`).join("; ")
    : "партия только началась";

  const mode = MODE_CONTEXT[actionMode] || MODE_CONTEXT.decree;

  return `Ты — помощник в геополитической стратегии. Игрок управляет ${game.country_name}, ход ${game.current_turn + 1}.

Текущие показатели: ${JSON.stringify(stats)}
Слабые места: ${weakStats}
Последние решения: ${historyText}

Режим действия: ${mode.label.toUpperCase()}
Фокус: ${mode.focus}
Примеры стиля: ${mode.examples}

Сгенерируй ровно 6 конкретных вариантов ${mode.label} — коротких (1 предложение), реалистичных, на русском языке. Учти слабые показатели. ВСЕ варианты должны соответствовать режиму «${actionMode}» — не смешивай типы.

Верни ТОЛЬКО JSON без markdown:
{"suggestions": ["вариант 1", "вариант 2", "вариант 3", "вариант 4", "вариант 5", "вариант 6"]}`;
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
