/**
 * validateGmResponse.js
 *
 * Валидация ответа ИИ-геймместера ДО того, как его классификация
 * попадёт в rules-engine. Backend не доверяет ИИ — проверяет структуру
 * и отсутствие "самодеятельности" с числами.
 */

// Полный список — см. docs/04-cabinet-and-categories.md. Заменяет старый 14-категорийный
// список целиком (не сосуществует со старым — см. §1 плана).
const ALLOWED_CATEGORIES = [
  // Военные операции (§2.1)
  "mil_recon",
  "mil_tactical",
  "mil_operational_offensive",
  "mil_operational_defensive",
  "mil_strategic_offensive",
  "mil_strategic_defensive",
  "mil_hybrid",
  // Шпионаж (§2.2)
  "covert_destabilize",
  "covert_sabotage",
  "covert_disinfo",
  "covert_elimination",
  // Дипломатия (§2.3)
  "diplo_negotiate",
  "diplo_treaty",
  "diplo_pressure",
  "diplo_multilateral",
  "diplo_soft_power",
  "diplo_peace",
  // Указы — экономические (§2.4)
  "econ_stimulus",
  "econ_austerity",
  "econ_sanctions_counter",
  "econ_infrastructure",
  "econ_tech",
  // Указы — военно-административные (§2.4)
  "mil_admin_budget",
  "mil_admin_mobilization",
  "mil_admin_doctrine",
  // Указы — политические (§2.4)
  "pol_repression",
  "pol_liberalization",
  "pol_elite_consolidation",
  "pol_social",
  // Указы — информационные (§2.4)
  "pol_propaganda",
  // Вне доменной сетки — без изменений
  "military_regroup",
  "nuclear_strike",
  "null_action",
];

const ALLOWED_EXPOSURE_RISKS = ["low", "medium", "high"];
// Только эти категории вправе присылать exposure_risk (см. rules-engine.js CATEGORY_GROUP.covert_ops)
const COVERT_CATEGORIES = new Set(["covert_destabilize", "covert_sabotage", "covert_disinfo", "covert_elimination"]);

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

  // Тайные операции (covert_*) обязаны декларировать риск раскрытия — от него зависит
  // seeded-бросок в rules-engine.js (rollExposure). Остальным категориям поле не нужно.
  if (COVERT_CATEGORIES.has(raw.action_type)) {
    if (!ALLOWED_EXPOSURE_RISKS.includes(raw.exposure_risk)) {
      throw new Error(`exposure_risk обязателен для ${raw.action_type} и должен быть одним из: ${ALLOWED_EXPOSURE_RISKS.join("|")} (получено: ${raw.exposure_risk})`);
    }
  } else if (raw.exposure_risk && !ALLOWED_EXPOSURE_RISKS.includes(raw.exposure_risk)) {
    throw new Error(`Invalid exposure_risk: ${raw.exposure_risk}`);
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

  // preview_narrative (2026-07-19) — версия того же события в условном/будущем наклонении,
  // показывается игроку ДО подписи указа (см. /turns/preview). Реальный игрок (Кэп) принял
  // прошедшее-время narrative в превью за уже случившееся и закрыл вкладку, решив, что ход
  // прошёл — хотя подтверждения не было. Валидируем так же строго, как narrative, иначе ИИ
  // будет иногда пропускать поле и preview молча откатится на прошедшее время.
  if (!raw.preview_narrative || typeof raw.preview_narrative !== "string" || raw.preview_narrative.length < 10) {
    throw new Error("preview_narrative missing or too short");
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

module.exports = { validateGmResponse, ALLOWED_CATEGORIES, ALLOWED_DIRECTIONS, ALLOWED_TONES, ALLOWED_EXPOSURE_RISKS, COVERT_CATEGORIES };
