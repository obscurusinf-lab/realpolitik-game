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
  economy: 6,
  military: 6,
  stability: 5,
  diplomacy: 4,
  approval: 5,
  // Субметрики общества
  elite_satisfaction: 5,
  corruption: 4,
  middle_class: 4,
  lower_class_mood: 5,
};

// Начальные значения субметрик для новых игр (применяются если отсутствуют в stats)
const SUBSTAT_DEFAULTS = {
  elite_satisfaction: 55,
  corruption: 40,
  middle_class: 50,
  lower_class_mood: 45,
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
  crisis:         15, // антикризисный указ
};

// Сроки (в ходах = месяцах) по типу указа
const DECREE_DURATION = {
  decree_fast:    2,
  decree_reform:  5,
  decree_program: 10,
  decree:         5,
};

// В кризисном режиме 1 ход = 2 недели (коэффициент 0.5 от обычного)
const CRISIS_TURN_WEEKS = 2;
const NORMAL_TURN_WEEKS = 4; // 1 месяц

const INITIATIVE_REGEN_PER_TURN = 25;
const INITIATIVE_REGEN_CRISIS   = 35; // быстрее восстанавливается в кризисе
const INITIATIVE_SKIP_REGEN = 30;
const INITIATIVE_MAX = 100;

const MAX_RELATION_DELTA_DIRECT = 8;
const MAX_RELATION_DELTA_SPILLOVER = 3;

// Диапазоны [min, max] для каждой категории x показателя.
// Субметрики: elite_satisfaction (0=элиты против, 100=за), corruption (0=чисто, 100=коррупция),
//             middle_class (0=нет среднего класса, 100=большой и довольный),
//             lower_class_mood (0=народ взбунтовался, 100=доволен)
const RULES_TABLE = {
  //                                economy     military    stability   diplomacy   approval    elite_sat   corruption  mid_class   low_mood
  military_offensive:        { economy: [-2, 0], military: [1, 5],  stability: [-2, 0], diplomacy: [-3, 0], approval: [-1, 2],  elite_satisfaction: [1, 3],   corruption: [0, 1],   middle_class: [-2, 0], lower_class_mood: [-2, 1] },
  military_defensive:        { economy: [-1, 0], military: [0, 3],  stability: [1, 3],  diplomacy: [0, 1],  approval: [1, 3],   elite_satisfaction: [0, 2],   corruption: [0, 0],   middle_class: [0, 1],  lower_class_mood: [1, 3]  },
  diplomacy_outreach:        { economy: [0, 2],  military: [0, 0],  stability: [0, 1],  diplomacy: [2, 5],  approval: [0, 1],   elite_satisfaction: [1, 3],   corruption: [-1, 0],  middle_class: [1, 2],  lower_class_mood: [0, 1]  },
  diplomacy_confrontation:   { economy: [-2, 0], military: [0, 0],  stability: [-1, 0], diplomacy: [-4, -1],approval: [-1, 2],  elite_satisfaction: [-2, 1],  corruption: [0, 1],   middle_class: [-1, 0], lower_class_mood: [-1, 1] },
  economic_stimulus:         { economy: [1, 4],  military: [0, 0],  stability: [1, 2],  diplomacy: [0, 0],  approval: [1, 3],   elite_satisfaction: [-1, 2],  corruption: [-2, 0],  middle_class: [2, 4],  lower_class_mood: [2, 4]  },
  economic_austerity:        { economy: [2, 5],  military: [0, 0],  stability: [-3, -1],diplomacy: [0, 0],  approval: [-3, -1], elite_satisfaction: [2, 4],   corruption: [-3, -1], middle_class: [-3, -1],lower_class_mood: [-4, -2]},
  domestic_repression:       { economy: [0, 0],  military: [0, 1],  stability: [1, 3],  diplomacy: [-2, 0], approval: [-3, -1], elite_satisfaction: [2, 4],   corruption: [1, 3],   middle_class: [-2, 0], lower_class_mood: [-3, -1]},
  domestic_liberalization:   { economy: [0, 1],  military: [0, 0],  stability: [-1, 2], diplomacy: [1, 2],  approval: [-1, 3],  elite_satisfaction: [-3, 0],  corruption: [-2, 0],  middle_class: [2, 4],  lower_class_mood: [2, 4]  },
  info_narrative:            { economy: [0, 0],  military: [0, 0],  stability: [0, 2],  diplomacy: [-1, 2], approval: [1, 3],   elite_satisfaction: [0, 1],   corruption: [0, 1],   middle_class: [0, 0],  lower_class_mood: [1, 3]  },
  intelligence_covert:       { economy: [0, 0],  military: [1, 3],  stability: [0, 0],  diplomacy: [-2, 0], approval: [0, 0],   elite_satisfaction: [0, 1],   corruption: [1, 2],   middle_class: [0, 0],  lower_class_mood: [0, 0]  },
  intel_success:             { economy: [0, 2],  military: [2, 5],  stability: [0, 1],  diplomacy: [-1, 1], approval: [1, 3],   elite_satisfaction: [1, 3],   corruption: [0, 1],   middle_class: [0, 1],  lower_class_mood: [0, 2]  },
  intel_critical_success:    { economy: [1, 3],  military: [4, 6],  stability: [1, 2],  diplomacy: [0, 2],  approval: [2, 4],   elite_satisfaction: [2, 4],   corruption: [-1, 0],  middle_class: [1, 2],  lower_class_mood: [1, 3]  },
  intel_failure:             { economy: [-1, 0], military: [-1, 0], stability: [-2, 0], diplomacy: [-4, -2],approval: [-2, 0],  elite_satisfaction: [-2, 0],  corruption: [1, 2],   middle_class: [-1, 0], lower_class_mood: [-2, 0] },
  intel_critical_failure:    { economy: [-2, 0], military: [-2, 0], stability: [-3, -1],diplomacy: [-5, -3],approval: [-3, -1], elite_satisfaction: [-4, -2], corruption: [2, 4],   middle_class: [-2, -1],lower_class_mood: [-3, -1]},
  peace_initiative:          { economy: [1, 2],  military: [-1, 0], stability: [1, 2],  diplomacy: [2, 4],  approval: [1, 3],   elite_satisfaction: [-1, 1],  corruption: [-1, 0],  middle_class: [1, 3],  lower_class_mood: [2, 4]  },
  null_action:               { economy: [-1, 0], military: [-1, 0], stability: [0, 0],  diplomacy: [0, 0],  approval: [-1, 0],  elite_satisfaction: [-1, 0],  corruption: [0, 1],   middle_class: [-1, 0], lower_class_mood: [-1, 0] },
  nuclear_strike:            { economy: [-25,-20],military: [3, 8], stability: [-30,-25],diplomacy: [-40,-35],approval: [-20,-15],elite_satisfaction: [-15,-10],corruption: [5, 10], middle_class: [-20,-15],lower_class_mood: [-25,-20]},
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

  for (const stat of Object.keys(MAX_DELTA_PER_TURN)) {
    if (action_type === "nuclear_strike") {
      // Ядерный удар: берём диапазон напрямую без ограничений MAX_DELTA
      const range = RULES_TABLE.nuclear_strike[stat];
      const jitter = (seededFraction(seed + stat) - 0.5) * 2; // небольшой разброс
      const raw = range[0] + (range[1] - range[0]) * (0.5 + jitter * 0.15);
      const delta = Math.round(Math.max(range[0], Math.min(range[1], raw)));
      statDeltas[stat] = delta;
      newStats[stat] = Math.max(0, Math.min(100, (state.stats[stat] ?? 50) + delta));
    } else {
      const delta = computeStatDelta({ category: action_type, stat, severity, seed });
      statDeltas[stat] = delta;
      newStats[stat] = applyClamped(state.stats[stat], delta);
    }
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
  MAX_DELTA_PER_TURN,
  SUBSTAT_DEFAULTS,
  INITIATIVE_COST,
  DECREE_DURATION,
  CRISIS_TURN_WEEKS,
  NORMAL_TURN_WEEKS,
  INITIATIVE_REGEN_PER_TURN,
  INITIATIVE_REGEN_CRISIS,
  INITIATIVE_MAX,
  MAX_RELATION_DELTA_DIRECT,
  MAX_RELATION_DELTA_SPILLOVER,
  computeStatDelta,
  computeDelayedEffectDelta,
  applyClamped,
  applyTurn,
  seededFraction,
};
