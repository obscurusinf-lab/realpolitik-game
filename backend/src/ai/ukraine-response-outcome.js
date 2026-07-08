/**
 * ukraine-response-outcome.js — контекстный нарратив итога ответа игрока на действие Украины.
 * БАЛАНС (2026-07-08): раньше outcomeText был одной из 3 захардкоженных строк на весь responseType
 * ("Оборонные меры сработали...") — одинаковый текст независимо от того, что за действие Украины
 * его вызвало. Вероятность/дельты (resolveUkraineResponse) остаются детерминированными — это баланс,
 * трогать нельзя; меняется только ТЕКСТ итога, который теперь пишет ИИ по конкретному контексту.
 */

const { languageInstruction } = require("./language-instruction");

const RESPONSE_LABELS = {
  defend: "Оборонительные меры",
  retaliate: "Ответный удар",
  accept: "Бездействие / дипломатический путь",
};

const OUTCOME_LABELS = {
  positive: "успех",
  mixed: "смешанный результат",
  negative: "провал",
  neutral: "нейтральный итог",
};

function buildUkraineResponseOutcomePrompt({ actionTitle, actionText, categoryLabel, responseType, outcome, statDelta, language }) {
  const deltaLine = Object.entries(statDelta || {})
    .map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v}`)
    .join(", ") || "без изменений статов";
  return `Ты — военный аналитик в геополитической стратегии про президента России. Кратко комментируешь итог решения игрока.

Действие Украины (уже произошло): "${actionTitle}" — ${actionText}
${categoryLabel ? `Категория действия: ${categoryLabel}\n` : ""}Ответ президента: ${RESPONSE_LABELS[responseType] || responseType}
Итог уже решён игровой механикой: ${OUTCOME_LABELS[outcome] || outcome} (изменения статов: ${deltaLine})

Напиши РОВНО 1-2 предложения — конкретный репортаж об итоге ИМЕННО этого ответа на ИМЕННО это действие Украины (не общие фразы вроде "меры сработали/не сработали", а привязка к сути события). Без кавычек, без markdown, без пояснений — только текст репортажа.${languageInstruction(language)}`;
}

async function generateUkraineResponseOutcome({ params, callClaudeApi, meta }) {
  const prompt = buildUkraineResponseOutcomePrompt(params);
  let response;
  try {
    response = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }, { ...meta, purpose: meta?.purpose || "ukraine_response_outcome" });
  } catch (err) {
    console.error("ukraine-response-outcome Claude call failed:", err.message);
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

module.exports = { generateUkraineResponseOutcome };
