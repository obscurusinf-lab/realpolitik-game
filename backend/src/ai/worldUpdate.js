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

function buildNuclearAftermathPrompt({ countryName, turnNumber, playerInput, narrative }) {
  return `Ты — система мирового моделирования. Только что произошло невообразимое: президент ${countryName} нанёс ядерный удар.

ХОД ${turnNumber}. Приказ игрока: "${playerInput}"
Нарратив: "${narrative}"

Это ПЕРВОЕ применение ядерного оружия с 1945 года. Мир в шоке. Ты должен описать немедленную реакцию планеты — максимально реалистично, детально, апокалиптически.

Сгенерируй:
1. overview — описание нового мира, где сломана ядерная норма. Мрачно, исторически.
2. world_reactions — МИНИМУМ 10 реакций от разных держав и организаций: США, НАТО, ООН, Китай, Великобритания, Франция, Германия, Израиль, Индия, Пакистан, страна-цель удара, папа римский / религиозные лидеры, финансовые рынки. Реакции должны нарастать: сначала шок и осуждение, потом ультиматумы, потом угрозы ядерного ответного удара. Тон — реалистичный, не пафосный, как реальные пресс-релизы и экстренные заявления.
3. world_moves — 4-6 конкретных действий стран: экстренные военные меры, приведение ядерных сил в готовность, разрыв дипломатических отношений, экстренные заседания.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "overview": {
    "headline": "заголовок — ёмко и страшно, 1-2 предложения",
    "hotspots": [
      {"region": "Эпицентр удара", "text": "подробно об ударе, жертвах, разрушениях", "lat": 0.0, "lon": 0.0},
      {"region": "Мировая реакция", "text": "как реагирует мировое сообщество", "lat": 0.0, "lon": 0.0},
      {"region": "Ядерная угроза", "text": "страны приводят свои арсеналы в готовность", "lat": 0.0, "lon": 0.0}
    ]
  },
  "world_reactions": [
    {"source": "страна или организация", "text": "реакция 1-3 предложения", "tone": "neg", "escalation": 1}
  ],
  "world_moves": [
    {"country": "...", "action": "...", "impact": "...", "direction": "hostile"}
  ]
}
Поле escalation в реакциях: 1=шок/осуждение, 2=ультиматум/санкции, 3=прямая угроза ядерного ответа.`;
}

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
  const isNuclear = params.actionType === "nuclear_strike";
  const prompt = isNuclear
    ? buildNuclearAftermathPrompt(params)
    : buildWorldUpdatePrompt(params);

  let response;
  try {
    response = await callClaudeApi({
      model: "claude-sonnet-4-6",
      max_tokens: isNuclear ? 4096 : 1200,
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

  const cleaned = rawText.replace(/```json\s*|\s*```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Попытка вытащить частичный JSON если ответ обрезан
    try {
      const start = cleaned.indexOf("{");
      if (start === -1) throw new Error("no json");
      let depth = 0, end = -1;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
    console.error("worldUpdate JSON parse failed, raw:", cleaned.slice(0, 200));
    return null;
  }
}

module.exports = { generateWorldUpdate };
