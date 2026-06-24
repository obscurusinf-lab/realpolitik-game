/**
 * gamemaster.js
 *
 * Вызов Claude API для классификации хода игрока.
 * ИИ возвращает классификацию + нарратив, но НЕ числа — числа считает
 * rules-engine.js. Этот модуль отвечает за: построение промпта,
 * парсинг ответа, валидацию, retry при невалидном JSON.
 */

const { ALLOWED_CATEGORIES, validateGmResponse } = require("./validateGmResponse");

const SYSTEM_PROMPT_TEMPLATE = require("fs").readFileSync(
  require("path").join(__dirname, "system-prompt.txt"),
  "utf-8"
);

const MAX_RETRIES = 2;

function buildPrompt({ countryName, gameDate, turnNumber, currentState, activePolicies, delayedEffects, playerInput, actionMode = "decree" }) {
  return SYSTEM_PROMPT_TEMPLATE
    .replace("{{country_name}}", countryName)
    .replace("{{game_date}}", gameDate)
    .replace("{{turn_number}}", turnNumber)
    .replace("{{current_state_json}}", JSON.stringify(currentState, null, 2))
    .replace("{{active_policies_json}}", JSON.stringify(activePolicies, null, 2))
    .replace("{{delayed_effects_json}}", JSON.stringify(delayedEffects, null, 2))
    .replace("{{player_input}}", playerInput)
    .replace("{{action_mode}}", actionMode);
}

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

/**
 * Основная функция. callClaudeApi — инжектируемая зависимость
 * (в проде — fetch на api.anthropic.com, в тестах — мок).
 */
async function classifyTurn({ params, callClaudeApi, retryCount = 0 }) {
  const prompt = buildPrompt(params);

  const response = await callClaudeApi({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      return classifyTurn({
        params: { ...params, playerInput: params.playerInput + `\n\n[Системное: предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект.]` },
        callClaudeApi,
        retryCount: retryCount + 1,
      });
    }
    return fallbackResponse("JSON parse failed after retries");
  }

  try {
    validateGmResponse(parsed);
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      return classifyTurn({
        params: { ...params, playerInput: params.playerInput + `\n\n[Системное: ошибка валидации "${err.message}". Исправь и верни корректный JSON.]` },
        callClaudeApi,
        retryCount: retryCount + 1,
      });
    }
    return fallbackResponse(`Validation failed after retries: ${err.message}`);
  }

  return parsed;
}

function fallbackResponse(reason) {
  console.error("Gamemaster fallback triggered:", reason);
  return {
    action_type: "null_action",
    secondary_category: null,
    severity: 1,
    affected_relations: [],
    narrative: "Штаб запросил уточнение формулировки решения — формальное распоряжение не зафиксировано на этом ходу.",
    advisor_objection: null,
    newsfeed_reactions: [],
    delayed_effects: [],
    policy_update: { is_new_policy: false, title: null, items: [] },
    _fallback_reason: reason,
  };
}

module.exports = { classifyTurn, buildPrompt, ALLOWED_CATEGORIES };
