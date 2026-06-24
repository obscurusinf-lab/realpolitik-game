/**
 * worldUpdate.js
 *
 * После каждого подтверждённого хода генерирует:
 *   1. Новый overview (headline + hotspots) — что изменилось в мире
 *   2. Реакции других стран/блоков — идут в newsfeed как item_type='reaction'
 *
 * Вызывается ПОСЛЕ транзакции confirm, не блокирует ответ игроку —
 * результат сохраняется в БД и виден при следующем GET /games/:id.
 */

function buildWorldUpdatePrompt({ countryName, turnNumber, playerInput, narrative, statDeltas, relationDeltas, currentStats, currentRelations, prevOverview }) {
  const deltaLines = Object.entries(statDeltas)
    .filter(([, d]) => d !== 0)
    .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`)
    .join(", ") || "без изменений";

  const relLines = (relationDeltas || [])
    .map(r => `${r.country}: ${r.delta > 0 ? "+" : ""}${r.delta}`)
    .join(", ") || "без изменений";

  return `Ты — система мирового моделирования в геополитической стратегии. Игрок управляет ${countryName}.

ХОД ${turnNumber}. Игрок только что принял решение:
"${playerInput}"

Нарратив геймместера: "${narrative}"
Изменения показателей: ${deltaLines}
Изменения отношений: ${relLines}

Текущее состояние страны:
${JSON.stringify(currentStats)}

Текущие отношения:
${JSON.stringify(currentRelations.slice(0, 10))}

Предыдущая обстановка:
${JSON.stringify(prevOverview)}

Твоя задача:
1. Обнови "обстановку" — что изменилось в мире после этого решения. Пиши живо, как сводка разведки. Очаги напряжённости должны быть достаточно подробными чтобы быть интересными.
2. Сгенерируй 2-4 реакции от других стран/блоков. Каждая — 1-2 предложения, от конкретного актора (США, ЕС, Китай, Украина, НАТО и т.д.). Реакции должны соответствовать направлению решения и реальной геополитике.
3. Сгенерируй 2-3 "хода мира" — что в этот же период предприняли другие крупные игроки независимо от действий игрока. Это должны быть реалистичные геополитические события (военные манёвры, дипломатические встречи, экономические решения других стран). Они не обязаны быть связаны с действием игрока напрямую.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "overview": {
    "headline": "1-2 предложения: главное что изменилось в мире после этого хода",
    "hotspots": [
      {"region": "название региона/темы", "text": "2-3 предложения об очаге напряжённости, достаточно подробно чтобы было интересно читать", "lat": 51.5, "lon": 37.2},
      {"region": "...", "text": "...", "lat": 0.0, "lon": 0.0}
    ]
  },
  "world_reactions": [
    {"source": "название страны или блока", "text": "реакция 1-2 предложения", "tone": "pos|neg|neutral"},
    {"source": "...", "text": "...", "tone": "..."}
  ],
  "world_moves": [
    {
      "country": "название страны",
      "action": "что страна предприняла на этом ходу (1-2 предложения, конкретно)",
      "impact": "как это влияет на ситуацию (1 предложение)",
      "direction": "hostile|neutral|cooperative"
    }
  ]
}`;
}

async function generateWorldUpdate({ params, callClaudeApi }) {
  const prompt = buildWorldUpdatePrompt(params);

  let response;
  try {
    response = await callClaudeApi({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.error("worldUpdate Claude call failed:", err.message);
    return null;
  }

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  try {
    return JSON.parse(rawText.replace(/```json\s*|\s*```/g, "").trim());
  } catch {
    console.error("worldUpdate JSON parse failed");
    return null;
  }
}

module.exports = { generateWorldUpdate };
