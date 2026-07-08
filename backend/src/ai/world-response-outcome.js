/**
 * world-response-outcome.js — контекстный нарратив итога дипломатического ответа игрока
 * на реакцию другой страны (DiplomaticResponseScreen на фронте).
 * БАЛАНС (2026-07-08): раньше /games/:gameId/world-response вообще не возвращал текст итога —
 * только generic-лейбл ("Дипломатический успех"/"Смешанный результат"/...) без единого слова о
 * том, что конкретно произошло. По фидбеку игрока ("ответы выглядят как отписка") — то же лечение,
 * что и для resolveUkraineResponse: дельты остаются детерминированными (см. games.js), а сам текст
 * итога теперь пишет ИИ по контексту конкретной реакции страны и выбранного ответа.
 */

const { languageInstruction } = require("./language-instruction");

const RESPONSE_LABELS = {
  cooperate: "Сотрудничество / поддержка инициативы",
  deescalate: "Дипломатическая деэскалация",
  confront: "Жёсткая конфронтация",
  ignore: "Игнорирование / отказ от реакции",
};

const OUTCOME_LABELS = {
  positive: "успех",
  mixed: "смешанный результат",
  negative: "осложнение",
  neutral: "без изменений",
};

function buildWorldResponseOutcomePrompt({ source, reactionText, responseType, outcome, statDelta, language }) {
  const deltaLine = Object.entries(statDelta || {})
    .map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v}`)
    .join(", ") || "без изменений статов";
  return `Ты — дипломатический аналитик в геополитической стратегии про президента России. Кратко комментируешь итог ответа игрока на реакцию другой страны.

Реакция страны "${source}" (уже произошла): "${reactionText}"
Ответ президента: ${RESPONSE_LABELS[responseType] || responseType}
Итог уже решён игровой механикой: ${OUTCOME_LABELS[outcome] || outcome} (изменения статов: ${deltaLine})

Напиши РОВНО 1-2 предложения — конкретный репортаж об итоге ИМЕННО этого ответа стране "${source}" по ИМЕННО этой реакции (не общие фразы вроде "переговоры прошли успешно", а привязка к сути реакции и стране). Без кавычек, без markdown, без пояснений — только текст репортажа.${languageInstruction(language)}`;
}

async function generateWorldResponseOutcome({ params, callClaudeApi, meta }) {
  const prompt = buildWorldResponseOutcomePrompt(params);
  let response;
  try {
    response = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }, { ...meta, purpose: meta?.purpose || "world_response_outcome" });
  } catch (err) {
    console.error("world-response-outcome Claude call failed:", err.message);
    return null;
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
    .replace(/^["'«]+|["'»]+$/g, "");

  return text || null;
}

module.exports = { generateWorldResponseOutcome };
