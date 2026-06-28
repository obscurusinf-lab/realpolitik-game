/**
 * validateGmResponse.js
 *
 * Валидация ответа ИИ-геймместера ДО того, как его классификация
 * попадёт в rules-engine. Backend не доверяет ИИ — проверяет структуру
 * и отсутствие "самодеятельности" с числами.
 */

const ALLOWED_CATEGORIES = [
  "military_offensive",
  "military_defensive",
  "military_regroup",
  "diplomacy_outreach",
  "diplomacy_confrontation",
  "economic_stimulus",
  "economic_austerity",
  "domestic_repression",
  "domestic_liberalization",
  "info_narrative",
  "intelligence_covert",
  "peace_initiative",
  "nuclear_strike",
  "null_action",
];

const ALLOWED_DIRECTIONS = ["improve", "worsen", "neutral"];
const ALLOWED_TONES = ["pos", "neutral", "neg"];

function validateGmResponse(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Response is not an object");
  }

  if (!ALLOWED_CATEGORIES.includes(raw.action_type)) {
    throw new Error(`Unknown action_type: ${raw.action_type}`);
  }

  if (raw.secondary_category && !ALLOWED_CATEGORIES.includes(raw.secondary_category)) {
    throw new Error(`Unknown secondary_category: ${raw.secondary_category}`);
  }

  if (![1, 2, 3].includes(raw.severity)) {
    throw new Error(`Invalid severity: ${raw.severity} (must be 1, 2, or 3)`);
  }

  if (!Array.isArray(raw.affected_relations)) {
    throw new Error("affected_relations must be an array");
  }
  for (const r of raw.affected_relations) {
    if (!r.country || typeof r.country !== "string") {
      throw new Error("affected_relations entry missing country");
    }
    if (!ALLOWED_DIRECTIONS.includes(r.direction)) {
      throw new Error(`Invalid relation direction: ${r.direction}`);
    }
  }

  if (!raw.narrative || typeof raw.narrative !== "string" || raw.narrative.length < 10) {
    throw new Error("narrative missing or too short");
  }

  // Признак того, что ИИ попытался сам "посчитать" дельты в тексте —
  // это не блокирует ответ (не всегда ошибка — может быть дата, % инфляции
  // из контекста), но логируется для ручного аудита промпта.
  if (/[+\-]\s?\d{1,3}\s?(п\.п\.|%|пунктов)/i.test(raw.narrative)) {
    console.warn("GM narrative contains numeric-looking deltas — flag for prompt review:", raw.narrative);
  }

  if (!Array.isArray(raw.newsfeed_reactions)) {
    throw new Error("newsfeed_reactions must be an array");
  }
  for (const reaction of raw.newsfeed_reactions) {
    if (!ALLOWED_TONES.includes(reaction.tone)) {
      throw new Error(`Invalid reaction tone: ${reaction.tone}`);
    }
    if (!reaction.user || !reaction.text) {
      throw new Error("newsfeed_reactions entry missing user or text");
    }
  }

  if (raw.delayed_effects) {
    if (!Array.isArray(raw.delayed_effects)) {
      throw new Error("delayed_effects must be an array");
    }
    for (const eff of raw.delayed_effects) {
      const offset = eff.trigger_turn_offset;
      if (typeof offset !== "number" || offset < 1 || offset > 12) {
        throw new Error(`Invalid trigger_turn_offset: ${offset} (must be 1-12)`);
      }
    }
  }

  if (raw.policy_update) {
    if (typeof raw.policy_update.is_new_policy !== "boolean") {
      throw new Error("policy_update.is_new_policy must be boolean");
    }
  }

  return true;
}

module.exports = { validateGmResponse, ALLOWED_CATEGORIES, ALLOWED_DIRECTIONS, ALLOWED_TONES };
