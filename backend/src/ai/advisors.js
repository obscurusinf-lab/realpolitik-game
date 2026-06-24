/**
 * advisors.js
 *
 * Пять советников президента. Каждый смотрит на ситуацию через свою призму.
 * Один вызов Claude → все пять мнений, чтобы не множить API-запросы.
 */

const ADVISORS = [
  {
    id: "defense",
    name: "Белоусов А.Р.",
    role: "Министр обороны",
    persona: "Прагматичный силовик. Считает, что любую проблему можно решить демонстрацией силы или реальным применением. Сдержанность воспринимает как слабость. Раздражается, когда дипломаты тормозят военные решения.",
  },
  {
    id: "foreign",
    name: "Лавров С.В.",
    role: "Министр иностранных дел",
    persona: "Циничный дипломат с 30-летним опытом. Ценит репутацию и долгосрочные альянсы выше сиюминутной выгоды. Саркастичен с теми, кто не понимает международный контекст. Любит ссылаться на прецеденты.",
  },
  {
    id: "finance",
    name: "Силуанов А.Г.",
    role: "Министр финансов",
    persona: "Осторожный технократ. Видит в каждом решении строку расходов и риск санкций. Склонен предупреждать о последствиях, даже когда остальные настроены оптимистично. Иногда занудствует.",
  },
  {
    id: "security",
    name: "Патрушев Н.П.",
    role: "Директор ФСБ",
    persona: "Параноичный стратег. Везде ищет иностранное влияние и внутренних врагов. Считает стабильность важнее свободы. Предупреждает о заговорах, но его прогнозы иногда сбываются.",
  },
  {
    id: "press",
    name: "Песков Д.С.",
    role: "Пресс-секретарь",
    persona: "Мастер нарратива. Думает категориями общественного восприятия и информационной повестки. Беспокоится об одобрении населения и международном имидже. Умеет обернуть любое решение в правильную обёртку — или объяснить, почему это невозможно.",
  },
];

const SYSTEM_PROMPT = `Ты — система моделирования кабинета советников российского президента в геополитической стратегической игре.

Твоя задача: от лица каждого из пяти советников дать короткую, живую рекомендацию президенту.

СОВЕТНИКИ:
{{advisors_json}}

ПРАВИЛА:
- Каждый советник говорит в своём стиле и только через свою призму
- Советники ПОМНЯТ историю: ссылаются на прошлые ходы, если это уместно
- Если советник доволен курсом — поддерживает. Если недоволен — говорит прямо
- Рекомендация: 2-4 предложения, живым разговорным языком, без канцелярита
- Каждый предлагает конкретное действие или направление
- Советники могут не соглашаться друг с другом

ТЕКУЩАЯ СИТУАЦИЯ:
Страна: {{country_name}}
Дата: {{game_date}}, Ход №{{turn_number}}

Показатели: {{stats_json}}
Отношения: {{relations_json}}
Активные политики: {{policies_json}}

ПОСЛЕДНИЕ {{history_count}} ХОДОВ (от старых к новым):
{{history_json}}

{{draft_section}}

Верни ТОЛЬКО валидный JSON без markdown-обёрток:
{
  "advisors": [
    {
      "id": "defense",
      "recommendation": "...",
      "suggested_direction": "одно из: military_offensive | military_defensive | diplomacy_outreach | diplomacy_confrontation | economic_stimulus | economic_austerity | domestic_repression | domestic_liberalization | info_narrative | intelligence_covert | peace_initiative | null_action",
      "tone": "одно из: supportive | cautious | critical | alarmed"
    },
    { "id": "foreign", ... },
    { "id": "finance", ... },
    { "id": "security", ... },
    { "id": "press", ... }
  ]
}`;

function buildAdvisorsPrompt({ countryName, gameDate, turnNumber, stats, relations, policies, recentHistory, playerDraft }) {
  const draftSection = playerDraft
    ? `ЧЕРНОВИК РЕШЕНИЯ ПРЕЗИДЕНТА (советники реагируют на него):\n"${playerDraft}"`
    : `ПРЕЗИДЕНТ ЕЩЁ НЕ СФОРМУЛИРОВАЛ РЕШЕНИЕ. Советники дают общие рекомендации исходя из текущей обстановки.`;

  return SYSTEM_PROMPT
    .replace("{{advisors_json}}", JSON.stringify(ADVISORS.map(a => ({ id: a.id, name: a.name, role: a.role, persona: a.persona })), null, 2))
    .replace("{{country_name}}", countryName)
    .replace("{{game_date}}", gameDate)
    .replace("{{turn_number}}", turnNumber)
    .replace("{{stats_json}}", JSON.stringify(stats))
    .replace("{{relations_json}}", JSON.stringify(relations.slice(0, 8)))
    .replace("{{policies_json}}", JSON.stringify(policies))
    .replace("{{history_count}}", recentHistory.length)
    .replace("{{history_json}}", recentHistory.length
      ? recentHistory.map(h => `Ход ${h.turn_n}: "${h.player_input}" → ${h.narrative_text}`).join("\n")
      : "(партия только началась, истории нет)")
    .replace("{{draft_section}}", draftSection);
}

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

async function consultAdvisors({ params, callClaudeApi }) {
  const prompt = buildAdvisorsPrompt(params);

  const response = await callClaudeApi({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch {
    return fallbackConsult();
  }

  // Обогащаем ответ статичными данными советников (имя, роль)
  const enriched = (parsed.advisors || []).map(a => {
    const meta = ADVISORS.find(adv => adv.id === a.id) || {};
    return { ...meta, ...a, persona: undefined };
  });

  return { advisors: enriched };
}

function fallbackConsult() {
  return {
    advisors: ADVISORS.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      recommendation: "Запрос к советнику временно недоступен. Примите решение самостоятельно.",
      suggested_direction: "null_action",
      tone: "cautious",
    })),
  };
}

module.exports = { consultAdvisors, ADVISORS };
