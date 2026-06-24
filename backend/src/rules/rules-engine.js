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
};

// Стоимость инициативы по режиму действия
// Военные операции дорогие — нельзя воевать каждый ход
// Разведка дёшевая — можно вести постоянно
// Указ средний — публичная власть, расходует политический капитал
const INITIATIVE_COST = {
  decree:   40,
  intel:    20,
  military: 55,
};
const INITIATIVE_REGEN_PER_TURN = 25; // обычная регенерация
const INITIATIVE_SKIP_REGEN = 45;     // бонус за пропуск хода
const INITIATIVE_MAX = 100;

const MAX_RELATION_DELTA_DIRECT = 8;
const MAX_RELATION_DELTA_SPILLOVER = 3;

// Диапазоны [min, max] для каждой категории x показателя.
// Отрицательный max при min=0 трактуется как "только вниз".
const RULES_TABLE = {
  military_offensive:        { economy: [-2, 0], military: [1, 5],  stability: [-2, 0], diplomacy: [-3, 0], approval: [-1, 2] },
  military_defensive:        { economy: [-1, 0], military: [0, 3],  stability: [1, 3],  diplomacy: [0, 1],  approval: [1, 3] },
  diplomacy_outreach:        { economy: [0, 2],  military: [0, 0],  stability: [0, 1],  diplomacy: [2, 5],  approval: [0, 1] },
  diplomacy_confrontation:   { economy: [-2, 0], military: [0, 0],  stability: [-1, 0], diplomacy: [-4, -1],approval: [-1, 2] },
  economic_stimulus:         { economy: [1, 4],  military: [0, 0],  stability: [1, 2],  diplomacy: [0, 0],  approval: [1, 3] },
  economic_austerity:        { economy: [2, 5],  military: [0, 0],  stability: [-3, -1],diplomacy: [0, 0],  approval: [-3, -1] },
  domestic_repression:       { economy: [0, 0],  military: [0, 1],  stability: [1, 3],  diplomacy: [-2, 0], approval: [-3, -1] },
  domestic_liberalization:   { economy: [0, 1],  military: [0, 0],  stability: [-1, 2], diplomacy: [1, 2],  approval: [-1, 3] },
  info_narrative:            { economy: [0, 0],  military: [0, 0],  stability: [0, 2],  diplomacy: [-1, 2], approval: [1, 3] },
  intelligence_covert:       { economy: [0, 0],  military: [1, 3],  stability: [0, 0],  diplomacy: [-2, 0], approval: [0, 0] },
  peace_initiative:          { economy: [1, 2],  military: [-1, 0], stability: [1, 2],  diplomacy: [2, 4],  approval: [1, 3] },
  null_action:               { economy: [-1, 0], military: [-1, 0], stability: [0, 0],  diplomacy: [0, 0],  approval: [-1, 0] },
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
function applyTurn({ state, gmClassification, gameId, turnNumber, actionMode = "decree" }) {
  const { action_type, severity } = gmClassification;
  const seed = `${gameId}:${turnNumber}:${action_type}`;

  const statDeltas = {};
  const newStats = { ...state.stats };

  // Инициатива: регенерация → трата
  const currentInitiative = typeof newStats.initiative === "number" ? newStats.initiative : INITIATIVE_MAX;
  const regenedInitiative = Math.min(INITIATIVE_MAX, currentInitiative + INITIATIVE_REGEN_PER_TURN);
  const cost = INITIATIVE_COST[actionMode] ?? INITIATIVE_COST.decree;
  newStats.initiative = Math.max(0, regenedInitiative - cost);
  statDeltas.initiative = newStats.initiative - currentInitiative;

  for (const stat of Object.keys(MAX_DELTA_PER_TURN)) {
    const delta = computeStatDelta({ category: action_type, stat, severity, seed });
    statDeltas[stat] = delta;
    newStats[stat] = applyClamped(state.stats[stat], delta);
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
  INITIATIVE_COST,
  INITIATIVE_REGEN_PER_TURN,
  INITIATIVE_MAX,
  MAX_RELATION_DELTA_DIRECT,
  MAX_RELATION_DELTA_SPILLOVER,
  computeStatDelta,
  computeDelayedEffectDelta,
  applyClamped,
  applyTurn,
  seededFraction,
};
