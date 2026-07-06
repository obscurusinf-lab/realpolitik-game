/**
 * ukraine-rules-engine.js
 *
 * "Полная симметрия" для Украины (Петя, 2026-07-06): раньше (см. UA_ACTIONS в turns.js,
 * построено сегодня же как generateUkraineAction) Украина выбирала ОДНО из 17 жёстко
 * прописанных канонических событий с фиксированными дельтами — ИИ только подбирал заголовок/
 * текст и лёгкое масштабирование (magnitude). Реальный выбор КАКАЯ категория происходит и
 * НАСКОЛЬКО сильно — не был решением ИИ, а взвешенным Math.random().
 *
 * Этот модуль даёт Украине ту же структуру, что у игрока в rules-engine.js: таблицу диапазонов
 * дельт по категориям (UA_RULES_TABLE) + детерминированный расчёт (computeUaStatDelta,
 * переиспользует ТУ ЖЕ формулу seededFraction/computeStatDeltaFromTable, что и Россия) +
 * территориальный пуш (computeUaTerritoryPull, ОТДЕЛЬНАЯ функция от computeTerritoryDelta —
 * та обкатана на живых партиях, трогать её нельзя).
 *
 * НЕ переносится из мира игрока (осознанно, это механики управления указами/политиками
 * ИГРОКА, к ИИ-актору без своей "администрации" не относятся): тир-множитель decree_fast/
 * reform/program, коррупционная утечка, военный стрик/усталость, policy_update, affected_relations
 * с третьими странами.
 *
 * Флаг отката — UKRAINE_FULL_SYMMETRY в rules-engine.js. При false этот модуль не используется
 * вообще, вызывающий код (turns.js) идёт по старому пути (UA_ACTIONS/generateUkraineAction).
 *
 * 7 категорий — группировка 17 существующих UA_ACTIONS по теме (совпадает с уже существующей
 * таксономией UA_TYPE_THEME на фронтенде: strike/sabotage/front/diplomatic/legal/info/sanctions),
 * диапазоны — производные от уже сбалансированных базовых дельт UA_ACTIONS (±40% спред,
 * тот же принцип, что уже применён в scaleUaDeltas для v1).
 *
 * Каждая категория бьёт по ДВУМ направлениям:
 *  - ru: эффект на статы РОССИИ (как и раньше — Украина действует ПРОТИВ игрока)
 *  - ua: НОВОЕ — небольшой эффект на СОБСТВЕННЫЕ статы Украины (ua_economy/ua_army/
 *    ua_diplomacy/ua_stability/ua_morale) — раньше эти 3(->5) стата двигались ТОЛЬКО отдельной
 *    формулой сравнения с Россией, никогда от конкретного выбранного события. Символическая,
 *    но настоящая "цена/выгода" решения для самой Украины — то, чего не было в реактивной модели.
 */

const {
  seededFraction,
  computeStatDeltaFromTable,
  TERRITORY_KEYS,
  TERRITORY_HARDNESS,
} = require("./rules-engine");

// Домены здесь — те же имена статов, что использует Россия (economy/military/diplomacy/
// stability/approval/army_morale/readiness/peace_progress) — это ВСЕГДА эффект НА РОССИЮ
// (ru-блок), плюс ua_-домены для эффекта на саму Украину (ua-блок). Общая обёртка
// computeStatDeltaFromTable не отличает "чьи" статы — просто диапазон+severity+seed.
const UA_RULES_TABLE = {
  ua_strike_infra: {
    ru: { economy: [-4, -1], stability: [-2, 0], military: [-3, -1], army_morale: [-3, -1], readiness: [-4, -1] },
    ua: { ua_morale: [0, 2] },
  },
  ua_sabotage: {
    ru: { military: [-3, -1], readiness: [-4, -1], stability: [-3, 0] },
    ua: { ua_morale: [0, 1] },
  },
  ua_counteroffensive: {
    ru: { army_morale: [-5, -1], readiness: [-3, -1] },
    ua: { ua_army: [0, 2], ua_morale: [1, 3] },
  },
  ua_diplomatic: {
    ru: { diplomacy: [-4, -1], army_morale: [-2, 0], peace_progress: [-14, -6] },
    ua: { ua_diplomacy: [1, 3] },
  },
  ua_legal: {
    ru: { diplomacy: [-5, -2], approval: [-3, 0] },
    ua: { ua_diplomacy: [0, 2] },
  },
  ua_info: {
    ru: { approval: [-4, -1], stability: [-4, -1] },
    ua: { ua_stability: [0, 1] },
  },
  ua_sanctions: {
    ru: { economy: [-4, -1], diplomacy: [-3, 0] },
    ua: { ua_economy: [0, 2] },
  },
};

// Короткие названия категорий — для промпта ИИ (generateUkraineActionV2) и как fallback-título,
// если ИИ почему-то не вернёт title (не должно случаться при валидации, но на всякий случай).
const UA_CATEGORY_LABELS = {
  ua_strike_infra:     "Удар по инфраструктуре (дроны/ракеты/поставки)",
  ua_sabotage:         "Диверсия в тылу/на логистике",
  ua_counteroffensive: "Контрнаступление на фронте",
  ua_diplomatic:       "Дипломатическое давление на Западе",
  ua_legal:            "Давление через международные суды/трибуналы",
  ua_info:             "Информационная война",
  ua_sanctions:        "Санкционное/экономическое давление",
};

// Варианты ответа игрока (defend/retaliate/accept) — шаблонные по категории, не по конкретному
// событию (ИИ в v2 пишет только title/text, не сами кнопки — они должны остаться в понятном
// игроку, проверенном формате define/retaliate/accept, от которого зависит механика
// UA_RESPONSE_TIERS на бэкенде и UA_RESPONSE_PREVIEW на фронте, никак не завязанная на текст кнопки).
const UA_CATEGORY_RESPONSES = {
  ua_strike_infra: [
    { label: "Усилить ПВО и защиту инфраструктуры", type: "defend" },
    { label: "Нанести ответный удар по украинским целям", type: "retaliate" },
    { label: "Признать потери и продолжить в штатном режиме", type: "accept" },
  ],
  ua_sabotage: [
    { label: "Усилить контрдиверсионные меры в тылу", type: "defend" },
    { label: "Ответить ударами по украинской логистике", type: "retaliate" },
    { label: "Устранить последствия без лишней огласки", type: "accept" },
  ],
  ua_counteroffensive: [
    { label: "Экстренно перебросить резервы, стабилизировать фронт", type: "defend" },
    { label: "Нанести контрудар для восстановления позиций", type: "retaliate" },
    { label: "Организовать плановый отход на новые рубежи", type: "accept" },
  ],
  ua_diplomatic: [
    { label: "Запустить контрдипломатическую кампанию", type: "defend" },
    { label: "Жёстко заявить о нелегитимности киевского режима", type: "retaliate" },
    { label: "Проигнорировать — время работает на нас", type: "accept" },
  ],
  ua_legal: [
    { label: "Организовать встречную информационную кампанию", type: "defend" },
    { label: "Отозвать признание юрисдикции международных судов", type: "retaliate" },
    { label: "Принять к сведению без реакции", type: "accept" },
  ],
  ua_info: [
    { label: "Задействовать РКН/ФСБ для блокировки и зачистки", type: "defend" },
    { label: "Ответить мощной контрпропагандистской волной", type: "retaliate" },
    { label: "Подавить распространение без огласки", type: "accept" },
  ],
  ua_sanctions: [
    { label: "Укрепить отношения с ключевыми посредниками", type: "defend" },
    { label: "Предупредить партнёров о неизбежном выборе", type: "retaliate" },
    { label: "Диверсифицировать цепочки поставок", type: "accept" },
  ],
};

// Категории, где раскрытие (аналог covert exposure_risk у игрока) механически осмысленно —
// скрытные операции, которые МОГУТ спалиться. Остальные категории — открытые действия
// (контрнаступление, дипломатия), раскрывать нечего.
const UA_EXPOSURE_ELIGIBLE = new Set(["ua_sabotage", "ua_info"]);

// Лимиты за один ход — переиспользуем масштаб Р РРоссии для общих имён статов (та же шкала
// 0-100, тот же смысл величины), добавляем свои для ua_-полей и peace_progress (у игрока
// peace_progress считается отдельной функцией computePeaceProgressDelta, не через эту таблицу —
// здесь проще: обычный табличный диапазон с собственным capping).
const UA_MAX_DELTA_PER_TURN = {
  economy: 5, military: 4, diplomacy: 5, stability: 4, approval: 4,
  army_morale: 5, readiness: 5, peace_progress: 15,
  ua_economy: 3, ua_army: 3, ua_diplomacy: 3, ua_stability: 2, ua_morale: 3,
};

function computeUaStatDelta({ category, stat, severity, seed, side }) {
  const table = UA_RULES_TABLE[category]?.[side];
  if (!table) return 0;
  // Оборачиваем в форму, которую ожидает computeStatDeltaFromTable: {category: {stat: [min,max]}}
  return computeStatDeltaFromTable({ [category]: table }, { category, stat, severity, seed }, UA_MAX_DELTA_PER_TURN);
}

/**
 * Территориальный пуш от действий Украины — ОТДЕЛЬНАЯ функция от computeTerritoryDelta
 * (та считает захват/потерю для действий РОССИИ, обкатана на живых партиях, не трогаем).
 * Здесь то же самое, но с точки зрения Украины: "качество войск" = функция от ua_army/
 * ua_morale, сопротивление = обороноспособность России (army_morale/readiness/equipment/
 * veterans) — чем она выше, тем меньше Украина отвоёвывает за ход.
 *
 * Основной "тяжёлый" толкатель территории — ua_counteroffensive (мирит с donbass_breakthrough/
 * counterattack из старой системы). ua_strike_infra/ua_sabotage дают небольшой побочный пуш
 * (как и раньше отдельные UA_ACTIONS вроде dnipro_push/partisan_resistance трогали территории
 * не будучи "главным" наступлением) — остальные категории территорию не двигают.
 */
function computeUaTerritoryPull({ uaStats, ruStats, category, severity, gameId, turnNumber }) {
  const deltas = {};
  const isMainPush = category === "ua_counteroffensive";
  const isMinorPush = category === "ua_strike_infra" || category === "ua_sabotage";
  if (!isMainPush && !isMinorPush) return { deltas };

  const seed = `${gameId}:${turnNumber}:${category}:ua_territory`;
  const sev = severity || 2;
  const uaQuality = ((uaStats.ua_army ?? 65) + (uaStats.ua_morale ?? 65)) / 2;
  const ruDefenseQuality = ((ruStats.army_morale ?? 50) + (ruStats.readiness ?? 50) + (ruStats.equipment ?? 50) + (ruStats.veterans ?? 50)) / 4;

  const basePull = isMainPush
    ? sev * 3 + Math.max(0, (uaQuality - 60) / 5)   // 3-12ish, зеркалит baseGain у России
    : sev * 1 + Math.max(0, (uaQuality - 60) / 10); // побочный пуш заметно слабее

  // Чем сильнее обороноспособность России, тем меньше отвоёвывает Украина за ход —
  // зеркалит логику убывающей эффективности при высоком current control у России.
  const resistanceFactor = Math.max(0.3, 1 - Math.max(0, (ruDefenseQuality - 50) / 100));

  for (const key of TERRITORY_KEYS) {
    const regionName = key.replace("_control", "");
    const hardness = TERRITORY_HARDNESS[regionName] || 1.0;
    const current = ruStats[key] ?? 50;
    if (current <= 0) continue;
    const jitter = 1 + (seededFraction(seed + ":" + key) - 0.5) * 0.4; // ±20%
    const pull = Math.round((basePull / hardness) * resistanceFactor * jitter);
    if (pull > 0) deltas[key] = -Math.min(current, pull);
  }
  return { deltas };
}

module.exports = {
  UA_RULES_TABLE,
  UA_MAX_DELTA_PER_TURN,
  UA_EXPOSURE_ELIGIBLE,
  UA_CATEGORY_LABELS,
  UA_CATEGORY_RESPONSES,
  computeUaStatDelta,
  computeUaTerritoryPull,
};
