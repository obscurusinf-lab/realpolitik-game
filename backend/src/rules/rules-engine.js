/**
 * rules-engine.js
 *
 * Детерминированное применение таблицы правил (docs/01-rules-table.md)
 * к классификации хода, полученной от ИИ-геймместера.
 *
 * ВАЖНО: это единственное место, где рождаются числа. ИИ классифицирует,
 * этот модуль считает. Один и тот же (action_type, severity, turn_seed)
 * ВСЕГДА даёт один и тот же результат — это необходимо для честного
 * сравнения партий разных игроков.
 */

const MAX_DELTA_PER_TURN = {
  peace_progress: 20,
  economy: 6,
  military: 6,
  stability: 5,
  diplomacy: 4,
  approval: 5,
  // Субметрики общества (approval)
  elite_satisfaction: 5,
  corruption: 4,
  middle_class: 4,
  lower_class_mood: 5,
  // Субметрики экономики
  gdp_growth: 5,
  inflation: 4,
  employment: 3,
  reserves: 4,
  // Субметрики армии
  army_morale: 5,
  equipment: 4,
  readiness: 4,
  veterans: 3,
  // Субметрики дипломатии
  ally_trust: 4,
  isolation: 4,
  soft_power: 3,
  reputation: 4,
  // Субметрики стабильности
  law_order: 4,
  social_tension: 5,
  media_control: 3,
  regional_unity: 4,
};

// Начальные значения субметрик — Россия 2026 (применяются если отсутствуют в stats)
const SUBSTAT_DEFAULTS = {
  // approval
  elite_satisfaction: 62,
  corruption: 55,
  middle_class: 44,
  lower_class_mood: 41,
  // economy
  gdp_growth: 36,
  inflation: 64,
  employment: 74,
  reserves: 48,
  // military
  army_morale: 62,
  equipment: 65,
  readiness: 70,
  veterans: 72,
  // diplomacy
  ally_trust: 42,
  isolation: 68,
  soft_power: 32,
  reputation: 28,
  // stability
  law_order: 72,
  social_tension: 38,
  media_control: 76,
  regional_unity: 64,
  // peace
  peace_progress: 12,
};

// Стоимость инициативы по типу действия
// decree_fast: быстрый указ (1–2 мес.), decree_reform: реформа (3–6 мес.), decree_program: крупная программа (7–12 мес.)
// intel: разведка — дёшево, military: прямое применение силы — дорого
// crisis_*: кризисные версии — быстрее и дешевле по инициативе, но меньший эффект
const INITIATIVE_COST = {
  decree_fast:    20,
  decree_reform:  35,
  decree_program: 55,
  decree:         35, // совместимость со старым кодом
  intel:          20,
  military:       55,
  crisis:         15,
  diplomacy_op:   35, // дипломатическая операция
  regroup:         0, // перегруппировка: инициатива не тратится, а восстанавливается
};

// Сроки (в ходах = месяцах) по типу указа
const DECREE_DURATION = {
  decree_fast:    2,
  decree_reform:  5,
  decree_program: 10,
  decree:         5,
};

// Сила эффекта по тиру указа: быстрый — слабее, программа — мощнее (но дороже/дольше).
// Делает выбор типа осмысленным: «дёшево-слабо-сразу» vs «дорого-сильно-надолго».
const TIER_MULTIPLIER = {
  decree_fast:    0.7,
  decree_reform:  1.0,
  decree_program: 1.45,
};

// Бонус «разведка готовит почву»: успешная intel-операция усиливает следующее действие.
const INTEL_BOOST_FACTOR = 1.3;

// В кризисном режиме 1 ход = 2 недели (коэффициент 0.5 от обычного)
const CRISIS_TURN_WEEKS = 2;
const NORMAL_TURN_WEEKS = 4; // 1 месяц

const INITIATIVE_REGEN_PER_TURN = 25;
const INITIATIVE_REGEN_CRISIS   = 35; // быстрее восстанавливается в кризисе
const INITIATIVE_SKIP_REGEN = 30;
const INITIATIVE_REGROUP_REGEN = 50; // перегруппировка: восстанавливает 50 поверх пассивного
const INITIATIVE_MAX = 100;

const MAX_RELATION_DELTA_DIRECT = 8;
const MAX_RELATION_DELTA_SPILLOVER = 3;

// Диапазоны [min, max] для каждой категории x показателя.
// Субметрики: elite_satisfaction (0=элиты против, 100=за), corruption (0=чисто, 100=коррупция),
//             middle_class (0=нет среднего класса, 100=большой и довольный),
//             lower_class_mood (0=народ взбунтовался, 100=доволен)
const RULES_TABLE = {
  //                        economy   military  stability diplomacy approval  elite_sat corruptn  mid_cls  low_mood | gdp_grw infltn  employ reserves | arm_mor  equip  ready veteran | ally_tr isolatn soft_pw reput | law_ord soc_ten media  region
  military_offensive:      { economy:[-2,0],  military:[1,5],  stability:[-2,0], diplomacy:[-3,0], approval:[-1,2],  elite_satisfaction:[1,3],  corruption:[0,1],  middle_class:[-2,0], lower_class_mood:[-2,1],  gdp_growth:[-2,0], inflation:[1,3],  employment:[-1,0], reserves:[-2,0], army_morale:[1,4],  equipment:[-1,1], readiness:[2,4],  veterans:[1,3],  ally_trust:[-1,0], isolation:[1,3],  soft_power:[-2,0], reputation:[-3,-1], law_order:[0,2],  social_tension:[1,3],  media_control:[0,1],  regional_unity:[-1,0] },
  military_defensive:      { economy:[-1,0],  military:[0,3],  stability:[1,3],  diplomacy:[0,1],  approval:[1,3],   elite_satisfaction:[0,2],  corruption:[0,0],  middle_class:[0,1],  lower_class_mood:[1,3],   gdp_growth:[-1,0], inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[2,4],  equipment:[0,2],  readiness:[2,4],  veterans:[0,2],  ally_trust:[0,2],  isolation:[-1,0], soft_power:[0,1],  reputation:[0,2],   law_order:[1,3],  social_tension:[-1,1], media_control:[0,1],  regional_unity:[0,2]  },
  diplomacy_outreach:      { economy:[0,2],   military:[0,0],  stability:[0,1],  diplomacy:[2,5],  approval:[0,1],   elite_satisfaction:[1,3],  corruption:[-1,0], middle_class:[1,2],  lower_class_mood:[0,1],   gdp_growth:[0,2],  inflation:[-1,0], employment:[0,1],  reserves:[0,1],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[2,4],  isolation:[-2,-1],soft_power:[1,3],  reputation:[2,4],   law_order:[0,1],  social_tension:[-1,0], media_control:[0,0],  regional_unity:[0,1]  },
  diplomacy_confrontation: { economy:[-2,0],  military:[0,0],  stability:[-1,0], diplomacy:[-4,-1],approval:[-1,2],  elite_satisfaction:[-2,1], corruption:[0,1],  middle_class:[-1,0], lower_class_mood:[-1,1],  gdp_growth:[-2,0], inflation:[1,2],  employment:[-1,0], reserves:[-1,0], army_morale:[0,2],  equipment:[0,0],  readiness:[1,2],  veterans:[0,0],  ally_trust:[-2,0], isolation:[2,3],  soft_power:[-2,-1],reputation:[-3,-1], law_order:[0,1],  social_tension:[1,2],  media_control:[1,2],  regional_unity:[-1,0] },
  economic_stimulus:       { economy:[1,4],   military:[0,0],  stability:[1,2],  diplomacy:[0,0],  approval:[1,3],   elite_satisfaction:[-1,2], corruption:[-2,0], middle_class:[2,4],  lower_class_mood:[2,4],   gdp_growth:[2,5],  inflation:[1,3],  employment:[1,3],  reserves:[-2,-1],army_morale:[0,1],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,1],  isolation:[-1,0], soft_power:[0,1],  reputation:[0,1],   law_order:[0,1],  social_tension:[-2,-1],media_control:[0,0],  regional_unity:[1,2]  },
  economic_austerity:      { economy:[2,5],   military:[0,0],  stability:[-3,-1],diplomacy:[0,0],  approval:[-3,-1], elite_satisfaction:[2,4],  corruption:[-3,-1],middle_class:[-3,-1],lower_class_mood:[-4,-2], gdp_growth:[0,2],  inflation:[-3,-1],employment:[-2,-1],reserves:[2,4],  army_morale:[-1,0], equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,1],  isolation:[0,1],  soft_power:[-1,0], reputation:[0,1],   law_order:[0,1],  social_tension:[2,4],  media_control:[0,0],  regional_unity:[-1,0] },
  domestic_repression:     { economy:[0,0],   military:[0,1],  stability:[1,3],  diplomacy:[-2,0], approval:[-3,-1], elite_satisfaction:[2,4],  corruption:[1,3],  middle_class:[-2,0], lower_class_mood:[-3,-1], gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[1,2],  equipment:[0,0],  readiness:[1,2],  veterans:[0,0],  ally_trust:[-2,-1],isolation:[2,3],  soft_power:[-2,-1],reputation:[-3,-2], law_order:[2,4],  social_tension:[1,3],  media_control:[2,4],  regional_unity:[0,2]  },
  domestic_liberalization: { economy:[0,1],   military:[0,0],  stability:[-1,2], diplomacy:[1,2],  approval:[-1,3],  elite_satisfaction:[-3,0], corruption:[-2,0], middle_class:[2,4],  lower_class_mood:[2,4],   gdp_growth:[0,2],  inflation:[-1,0], employment:[1,2],  reserves:[0,0],  army_morale:[-1,0], equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[1,3],  isolation:[-2,-1],soft_power:[2,3],  reputation:[2,4],   law_order:[-1,1], social_tension:[-3,-1],media_control:[-3,-1],regional_unity:[0,2]  },
  info_narrative:          { economy:[0,0],   military:[0,0],  stability:[0,2],  diplomacy:[-1,2], approval:[1,3],   elite_satisfaction:[0,1],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[1,3],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,2],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[-1,1], isolation:[0,1],  soft_power:[1,3],  reputation:[-1,2],  law_order:[0,1],  social_tension:[-2,-1],media_control:[1,3],  regional_unity:[0,1]  },
  intelligence_covert:     { economy:[0,0],   military:[1,3],  stability:[0,0],  diplomacy:[-2,0], approval:[0,0],   elite_satisfaction:[0,1],  corruption:[1,2],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[1,2],  equipment:[0,1],  readiness:[1,2],  veterans:[0,1],  ally_trust:[-1,0], isolation:[0,1],  soft_power:[0,1],  reputation:[-1,0],  law_order:[0,1],  social_tension:[0,1],  media_control:[0,1],  regional_unity:[0,0]  },
  intel_success:           { economy:[0,2],   military:[2,5],  stability:[0,1],  diplomacy:[-1,1], approval:[1,3],   elite_satisfaction:[1,3],  corruption:[0,1],  middle_class:[0,1],  lower_class_mood:[0,2],   gdp_growth:[0,1],  inflation:[0,0],  employment:[0,1],  reserves:[0,1],  army_morale:[2,4],  equipment:[0,2],  readiness:[2,3],  veterans:[1,2],  ally_trust:[-1,1], isolation:[0,1],  soft_power:[0,2],  reputation:[0,1],   law_order:[0,2],  social_tension:[-1,0], media_control:[0,1],  regional_unity:[0,1]  },
  intel_critical_success:  { economy:[1,3],   military:[4,6],  stability:[1,2],  diplomacy:[0,2],  approval:[2,4],   elite_satisfaction:[2,4],  corruption:[-1,0], middle_class:[1,2],  lower_class_mood:[1,3],   gdp_growth:[1,2],  inflation:[-1,0], employment:[0,1],  reserves:[0,2],  army_morale:[3,5],  equipment:[1,3],  readiness:[3,5],  veterans:[2,3],  ally_trust:[0,2],  isolation:[-1,0], soft_power:[1,3],  reputation:[1,3],   law_order:[1,3],  social_tension:[-2,-1],media_control:[1,2],  regional_unity:[1,2]  },
  intel_failure:           { economy:[-1,0],  military:[-1,0], stability:[-2,0], diplomacy:[-4,-2],approval:[-2,0],  elite_satisfaction:[-2,0], corruption:[1,2],  middle_class:[-1,0], lower_class_mood:[-2,0],  gdp_growth:[-1,0], inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[-2,-1],equipment:[0,0],  readiness:[-1,0], veterans:[0,0],  ally_trust:[-2,-1],isolation:[1,2],  soft_power:[-2,-1],reputation:[-2,-1], law_order:[-1,0], social_tension:[1,2],  media_control:[0,0],  regional_unity:[-1,0] },
  intel_critical_failure:  { economy:[-2,0],  military:[-2,0], stability:[-3,-1],diplomacy:[-5,-3],approval:[-3,-1], elite_satisfaction:[-4,-2],corruption:[2,4],  middle_class:[-2,-1],lower_class_mood:[-3,-1], gdp_growth:[-2,-1],inflation:[1,2],  employment:[-1,0], reserves:[-2,-1],army_morale:[-3,-2],equipment:[-1,0], readiness:[-2,-1],veterans:[0,0],  ally_trust:[-3,-2],isolation:[2,4],  soft_power:[-3,-2],reputation:[-4,-3], law_order:[-2,-1],social_tension:[2,3],  media_control:[-1,0], regional_unity:[-2,-1]},
  peace_initiative:        { economy:[1,2],   military:[-1,0], stability:[1,2],  diplomacy:[2,4],  approval:[1,3],   elite_satisfaction:[-1,1], corruption:[-1,0], middle_class:[1,3],  lower_class_mood:[2,4],   gdp_growth:[1,3],  inflation:[-1,0], employment:[0,2],  reserves:[0,2],  army_morale:[-2,0], equipment:[-1,0], readiness:[-1,1], veterans:[0,1],  ally_trust:[2,4],  isolation:[-3,-1],soft_power:[2,4],  reputation:[3,5],   law_order:[0,1],  social_tension:[-3,-1],media_control:[0,0],  regional_unity:[1,3]  },
  military_regroup:        { economy:[0,1],   military:[0,1],  stability:[1,2],  diplomacy:[0,0],  approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[0,0],  lower_class_mood:[0,1],   gdp_growth:[0,1],  inflation:[-1,0], employment:[0,0],  reserves:[0,1],  army_morale:[3,5],  equipment:[1,3],  readiness:[2,4],  veterans:[1,2],  ally_trust:[0,0],  isolation:[0,0],  soft_power:[0,0],  reputation:[0,0],   law_order:[0,1],  social_tension:[-1,0], media_control:[0,0],  regional_unity:[0,1]  },
  null_action:             { economy:[-3,-1], military:[-2,-1],stability:[-2,-1],diplomacy:[-1,0], approval:[-3,-1], elite_satisfaction:[-2,-1],corruption:[0,2],  middle_class:[-2,-1],lower_class_mood:[-2,-1], gdp_growth:[-2,-1],inflation:[0,2],  employment:[-2,-1],reserves:[-2,-1],army_morale:[-2,-1],equipment:[-2,-1],readiness:[-2,-1],veterans:[0,0],  ally_trust:[-2,-1],isolation:[0,2],  soft_power:[-2,-1],reputation:[-2,-1], law_order:[-2,-1],social_tension:[0,2],  media_control:[-2,-1],regional_unity:[-2,-1]},
  nuclear_strike:          { economy:[-25,-20],military:[3,8],stability:[-30,-25],diplomacy:[-40,-35],approval:[-20,-15],elite_satisfaction:[-15,-10],corruption:[5,10],middle_class:[-20,-15],lower_class_mood:[-25,-20], gdp_growth:[-25,-20],inflation:[15,25],employment:[-20,-15],reserves:[-20,-15],army_morale:[5,10],equipment:[-5,-2],readiness:[5,10],veterans:[-5,-2],ally_trust:[-30,-25],isolation:[25,35],soft_power:[-30,-25],reputation:[-40,-35],law_order:[-10,-5],social_tension:[20,30],media_control:[5,10],regional_unity:[-15,-10]},
};

// Множители severity (середина диапазона — детерминированно, без рандома)
const SEVERITY_MULTIPLIER = {
  1: 0.4,   // minor
  2: 0.7,   // standard
  3: 0.95,  // major
};

/**
 * Простой детерминированный hash для seed (вместо Math.random()).
 * Гарантирует: одинаковый вход => одинаковый выход, но разные ходы
 * не вырождаются в одно и то же число за счёт turn_number и game_id.
 */
function seededFraction(seedString) {
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = (hash * 31 + seedString.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000; // [0, 1)
}

/**
 * Считает конкретную дельту для одного показателя по категории и severity.
 * Использует небольшой детерминированный разброс внутри диапазона severity,
 * чтобы избежать ощущения "всегда одно и то же число", но без рандома.
 */
function computeStatDelta({ category, stat, severity, seed }) {
  const range = RULES_TABLE[category]?.[stat];
  if (!range) return 0;
  const [min, max] = range;
  if (min === 0 && max === 0) return 0;

  const baseMultiplier = SEVERITY_MULTIPLIER[severity];
  // Небольшой детерминированный сдвиг ±0.1 вокруг базового множителя
  const jitter = (seededFraction(seed + stat) - 0.5) * 0.2;
  const effectiveMultiplier = Math.min(1, Math.max(0, baseMultiplier + jitter));

  const raw = min + (max - min) * effectiveMultiplier;
  const capped = Math.max(-MAX_DELTA_PER_TURN[stat], Math.min(MAX_DELTA_PER_TURN[stat], raw));
  return Math.round(capped);
}

/**
 * Применяет дельту к одному показателю с зажимом в [0, 100].
 */
function applyClamped(currentValue, delta) {
  return Math.max(0, Math.min(100, currentValue + delta));
}

/**
 * Вычисляет изменение peace_progress на основе типа действия и состояния армии.
 * Военные эскалации могут УСКОРИТЬ мир — если армия сильная (>70).
 */
function computePeaceProgressDelta({ action_type, severity, armyValue, seed }) {
  const armyStrong = armyValue >= 70;
  const sevMultiplier = { 1: 0.5, 2: 0.8, 3: 1.0 }[severity] || 0.8;
  const jitter = (seededFraction(seed + "peace") - 0.5) * 0.3;
  const eff = Math.min(1, Math.max(0, sevMultiplier + jitter));

  switch (action_type) {
    case "peace_initiative":       return Math.round((10 + 10 * eff));  // +10..+20
    case "diplomacy_outreach":     return Math.round(4 + 4 * eff);      // +4..+8
    case "military_offensive":     return armyStrong ? Math.round(4 + 6 * eff) : Math.round(-(5 + 7 * eff)); // +4..+10 / -5..-12
    case "military_defensive":     return Math.round(1 + 2 * eff);      // +1..+3
    case "diplomacy_confrontation":return Math.round(-(3 + 4 * eff));   // -3..-7
    case "domestic_repression":    return Math.round(-(2 + 3 * eff));   // -2..-5
    case "nuclear_strike":         return -40;
    case "null_action":            return -2;
    default:                       return 0;
  }
}

/**
 * Основная функция: берёт текущий state, классификацию от ИИ,
 * возвращает новый state + объект дельт (для отображения игроку).
 */
function applyTurn({ state, gmClassification, gameId, turnNumber, actionMode = "decree", crisisMode = false }) {
  const { action_type, severity } = gmClassification;
  const seed = `${gameId}:${turnNumber}:${action_type}`;

  const statDeltas = {};
  // Инициализируем субметрики дефолтами если отсутствуют
  const newStats = { ...SUBSTAT_DEFAULTS, ...state.stats };

  // Инициатива: регенерация → трата
  const currentInitiative = typeof newStats.initiative === "number" ? newStats.initiative : INITIATIVE_MAX;
  const regen = crisisMode ? INITIATIVE_REGEN_CRISIS : INITIATIVE_REGEN_PER_TURN;
  const regenedInitiative = Math.min(INITIATIVE_MAX, currentInitiative + regen);
  const cost = INITIATIVE_COST[actionMode] ?? INITIATIVE_COST.decree;
  newStats.initiative = Math.max(0, regenedInitiative - cost);
  statDeltas.initiative = newStats.initiative - currentInitiative;

  // Peace progress — отдельная механика мирного трека
  const currentPeaceProgress = typeof state.stats.peace_progress === "number" ? state.stats.peace_progress : 0;
  const peaceArmyValue = newStats.military ?? 50;
  const peaceDelta = computePeaceProgressDelta({ action_type, severity, armyValue: peaceArmyValue, seed });
  const newPeaceProgress = Math.max(0, Math.min(100, currentPeaceProgress + peaceDelta));
  newStats.peace_progress = newPeaceProgress;
  statDeltas.peace_progress = peaceDelta;

  // Множитель силы по тиру указа (fast<reform<program); для прочих режимов = 1.
  const tierMult = TIER_MULTIPLIER[actionMode] ?? 1.0;
  // Разведбонус: если прошлая intel-операция была успешной — усиливаем ПОЛОЖИТЕЛЬНЫЕ
  // эффекты текущего (не-разведывательного) хода. Бонус разовый — расходуется здесь.
  const isIntelAction = typeof action_type === "string" && action_type.startsWith("intel");
  const intelBoostActive = (state.stats.next_action_boost ?? 0) > 0 && !isIntelAction;
  const effMult = (delta) => {
    let d = delta * tierMult;
    if (intelBoostActive && delta > 0) d *= INTEL_BOOST_FACTOR;
    return Math.round(d);
  };

  for (const stat of Object.keys(MAX_DELTA_PER_TURN)) {
    if (stat === "peace_progress") continue; // уже посчитано выше
    if (action_type === "nuclear_strike") {
      // Ядерный удар: берём диапазон напрямую без ограничений MAX_DELTA
      const range = RULES_TABLE.nuclear_strike[stat];
      const jitter = (seededFraction(seed + stat) - 0.5) * 2; // небольшой разброс
      const raw = range[0] + (range[1] - range[0]) * (0.5 + jitter * 0.15);
      const delta = Math.round(Math.max(range[0], Math.min(range[1], raw)));
      statDeltas[stat] = delta;
      newStats[stat] = Math.max(0, Math.min(100, (state.stats[stat] ?? 50) + delta));
    } else {
      const baseDelta = computeStatDelta({ category: action_type, stat, severity, seed });
      const delta = (tierMult !== 1.0 || intelBoostActive) ? effMult(baseDelta) : baseDelta;
      statDeltas[stat] = delta;
      newStats[stat] = applyClamped(state.stats[stat], delta);
    }
  }

  // Учёт разведбонуса: успешная разведка ставит бонус на следующий ход; обычный ход — расходует.
  if (action_type === "intel_success" || action_type === "intel_critical_success") {
    newStats.next_action_boost = action_type === "intel_critical_success" ? 2 : 1;
  } else if (intelBoostActive) {
    newStats.next_action_boost = 0; // бонус израсходован
  }

  // Отношения: прямое влияние + спилловер на связанные страны
  const relationDeltas = [];
  const newRelations = state.relations.map((r) => ({ ...r }));

  for (const affected of gmClassification.affected_relations || []) {
    const directionSign = affected.direction === "improve" ? 1 : affected.direction === "worsen" ? -1 : 0;
    if (directionSign === 0) continue;

    const relSeed = `${seed}:${affected.country}`;
    const magnitude = Math.round(
      MAX_RELATION_DELTA_DIRECT * SEVERITY_MULTIPLIER[severity] * (0.7 + seededFraction(relSeed) * 0.3)
    );
    const delta = directionSign * Math.min(MAX_RELATION_DELTA_DIRECT, magnitude);

    const target = newRelations.find((r) => r.name === affected.country);
    if (target) {
      const before = target.value;
      target.value = Math.max(0, Math.min(100, target.value + delta));
      target.trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      relationDeltas.push({ country: affected.country, delta, before, after: target.value });
    }

    // Спилловер: страны помечены как allies/rivals в countries.json (внешний справочник)
    // applySpillover(...) — вызывается отдельно, см. spillover.js
  }

  return {
    newStats,
    newRelations,
    statDeltas,
    relationDeltas,
  };
}

/**
 * Считает величину/знак отложенного эффекта на основе ТОЙ ЖЕ категории хода,
 * которая его породила — не магическое число, а минорный (severity=1)
 * расчёт по таблице правил для соответствующего stat.
 * ИИ присылает только { stat, reason, trigger_turn_offset } — без знака/числа.
 */
function computeDelayedEffectDelta({ category, stat, gameId, turnNumber, effectIndex }) {
  const seed = `${gameId}:${turnNumber}:delayed:${category}:${stat}:${effectIndex}`;
  // Отложенные эффекты — это "эхо" исходного хода, поэтому считаем как minor (severity=1)
  return computeStatDelta({ category, stat, severity: 1, seed });
}

module.exports = {
  RULES_TABLE,
  computePeaceProgressDelta,
  MAX_DELTA_PER_TURN,
  SUBSTAT_DEFAULTS,
  INITIATIVE_COST,
  DECREE_DURATION,
  CRISIS_TURN_WEEKS,
  NORMAL_TURN_WEEKS,
  INITIATIVE_REGEN_PER_TURN,
  INITIATIVE_REGEN_CRISIS,
  INITIATIVE_REGROUP_REGEN,
  INITIATIVE_MAX,
  MAX_RELATION_DELTA_DIRECT,
  MAX_RELATION_DELTA_SPILLOVER,
  computeStatDelta,
  computeDelayedEffectDelta,
  applyClamped,
  applyTurn,
  seededFraction,
};
