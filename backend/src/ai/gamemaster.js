/**
 * gamemaster.js
 *
 * Вызов Claude API для классификации хода игрока.
 * ИИ возвращает классификацию + нарратив, но НЕ числа — числа считает
 * rules-engine.js. Этот модуль отвечает за: построение промпта,
 * парсинг ответа, валидацию, retry при невалидном JSON.
 */

const { ALLOWED_CATEGORIES, validateGmResponse } = require("./validateGmResponse");
const { languageInstruction } = require("./language-instruction");

const FULL_PROMPT = require("fs").readFileSync(
  require("path").join(__dirname, "system-prompt.txt"),
  "utf-8"
);

// Разделяем на статичную (кешируемую) и динамическую части.
// Статичная — всё до блока ТЕКУЩЕЕ СОСТОЯНИЕ.
// Динамическая — game state, player input, action mode.
const SPLIT_MARKER = "ТЕКУЩЕЕ СОСТОЯНИЕ:";
const splitIdx = FULL_PROMPT.indexOf(SPLIT_MARKER);
// Статичные правила (до game state) — кешируются в system
const STATIC_RULES = splitIdx > 0
  ? FULL_PROMPT.slice(0, splitIdx).trim()
  : FULL_PROMPT;
// Суффикс после блока данных (action mode rules + JSON format) — добавим в system тоже
const ACTION_RULES_MARKER = "decree_fast:";
const actionRulesIdx = FULL_PROMPT.indexOf(ACTION_RULES_MARKER);
const ACTION_RULES = actionRulesIdx > 0
  ? FULL_PROMPT.slice(actionRulesIdx).trim()
  : "";

// Статичный system: общие правила + формат вывода (кешируется ~5min)
const CACHED_SYSTEM = `${STATIC_RULES}\n\n${ACTION_RULES}`.trim();

const MAX_RETRIES = 2;

// Ключевые статы для AI — только то что влияет на классификацию
// Субметрики (army_morale, readiness и т.д.) убираем чтобы сократить токены
const KEY_STATS = ["economy", "military", "stability", "diplomacy", "approval", "peace_progress", "initiative",
  "army_morale", "readiness", "donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"];

// Гостевой режим (2026-07-10, Петя — перед публичным постом): аккаунты, зарегистрированные по
// одному из 10 разовых гостевых кодов (account_tier='guest' на users, см. миграцию 0004), не
// имеют личной истории доверия с игроком (в отличие от существующих аккаунтов/друзей по
// админскому коду) — на абсурдные/провокационные указы для них советник ОТКАЗЫВАЕТ вместо
// полного разыгрывания последствий (см. fix "Фикс: абсурдные/шуточные указы падали в fallback" —
// та правка даёт ПОЛНОЕ вовлечение всем аккаунтам; здесь для гостей сознательно другое поведение).
// Это НЕ статичное правило в CACHED_SYSTEM — тир зависит от конкретного игрока, значит уходит
// в динамическую (некэшируемую) часть промпта, добавляется только гостям, не раздувает промпт
// всем остальным.
const GUEST_TIER_INSTRUCTION = `

РЕЖИМ АККАУНТА: гостевой доступ. Если ход абсурдный/шуточный/провокационный (не серьёзное
политическое решение) — НЕ разыгрывай его как реальное действие с последствиями. Верни
action_type: "null_action", severity: 1, а в narrative дай живую (не канцелярскую) реакцию
советника: он искренне удивлён таким предложением от президента и по-человечески объясняет,
почему это невозможно и почему так поступать не стоит. НЕ проси "уточнить формулировку решения" —
это не непонятный ход, а понятный, которого мы не разыгрываем для этого типа доступа.`;

function buildUserMessage({ countryName, playerName, gameDate, turnNumber, currentState, activePolicies, delayedEffects, playerInput, actionMode = "decree", language, accountTier }) {
  // Trim stats — только ключевые, без субметрик
  const trimmedStats = {};
  for (const k of KEY_STATS) {
    if (currentState.stats?.[k] !== undefined) trimmedStats[k] = currentState.stats[k];
  }
  const trimmedState = { stats: trimmedStats, relations: (currentState.relations || []).slice(0, 10) };

  // Активные политики — только названия и статус (не полные объекты)
  const trimmedPolicies = (activePolicies || [])
    .filter(p => p.status === "active")
    .map(p => ({ title: p.title, target_turn: p.target_turn }));

  return `Игра: ${countryName}, президент ${playerName || "Господин Президент"}, дата ${gameDate}, ход ${turnNumber}.

ТЕКУЩЕЕ СОСТОЯНИЕ:
${JSON.stringify(trimmedState, null, 2)}

АКТИВНЫЕ ПОЛИТИКИ:
${JSON.stringify(trimmedPolicies, null, 2)}

ОТЛОЖЕННЫЕ ЭФФЕКТЫ:
${JSON.stringify((delayedEffects || []).slice(0, 3), null, 2)}

ХОД ИГРОКА: "${playerInput}"
ТИП ДЕЙСТВИЯ: ${actionMode}${accountTier === "guest" ? GUEST_TIER_INSTRUCTION : ""}${languageInstruction(language)}`;
}

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

// БАЛАНС СТОИМОСТИ (2026-07-08, Петя — расход Anthropic API растёт, дашборд показывает Sonnet
// как основной источник токенов): предыдущий шаг (2026-07-06) перевёл на Haiku только decree_fast,
// оставив 6 из 7 режимов на Sonnet — этого оказалось мало, classifyTurn всё ещё доминирует по
// расходу, так как срабатывает на КАЖДЫЙ ход игрока. Перевели на Haiku всё, кроме military и
// crisis (ради качества нарратива).
// 2026-07-10 (Петя, дашборд снова показал Sonnet основным источником): military — тоже самая
// частая категория хода в игре про войну, каждое наступление/оборона гоняли Sonnet. Переводим
// и его на Haiku — остаётся только crisis (редкие переломные события, где нарративная ставка
// выше, а частота вызовов низкая, так что цена почти не влияет на общий расход).
const HAIKU_ACTION_MODES = new Set(["decree", "decree_fast", "decree_reform", "decree_program", "intel", "diplomacy_op", "military"]);
function selectModel(actionMode) {
  return HAIKU_ACTION_MODES.has(actionMode) ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";
}

/**
 * Основная функция. callClaudeApi — инжектируемая зависимость
 * (в проде — fetch на api.anthropic.com, в тестах — мок).
 */
async function classifyTurn({ params, callClaudeApi, retryCount = 0, meta }) {
  const response = await callClaudeApi({
    model: selectModel(params.actionMode),
    max_tokens: 4000,
    system: [{ type: "text", text: CACHED_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(params) }],
  }, meta);

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch (err) {
    console.error(`[GM] JSON parse error (retry ${retryCount}):`, err.message);
    console.error(`[GM] Raw response (first 500 chars):`, rawText.slice(0, 500));
    if (retryCount < MAX_RETRIES) {
      return classifyTurn({
        params: { ...params, playerInput: (params.playerInput || "") + `\n\n[Системное: предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект.]` },
        callClaudeApi,
        retryCount: retryCount + 1,
        meta,
      });
    }
    return fallbackResponse("JSON parse failed after retries");
  }

  try {
    validateGmResponse(parsed);
  } catch (err) {
    console.error(`[GM] Validation error (retry ${retryCount}):`, err.message);
    console.error(`[GM] Parsed action_type:`, parsed.action_type, "severity:", parsed.severity);
    if (retryCount < MAX_RETRIES) {
      return classifyTurn({
        params: { ...params, playerInput: params.playerInput + `\n\n[Системное: ошибка валидации "${err.message}". Исправь и верни корректный JSON.]` },
        callClaudeApi,
        retryCount: retryCount + 1,
        meta,
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

module.exports = { classifyTurn, ALLOWED_CATEGORIES };
