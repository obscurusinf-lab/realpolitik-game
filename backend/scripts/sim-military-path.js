/**
 * sim-military-path.js
 *
 * Чистая логическая симуляция (без HTTP/DB/AI) реального конца-месяца из
 * backend/src/routes/turns.js — формулы скопированы дословно (не переизобретены),
 * чтобы честно ответить: возможно ли сейчас пройти военным путём к победе, учитывая
 * накопленные экономические утечки (санкции, военное бремя, коррупция, инфляция).
 *
 * Использует реальные ofzTotalMonthlyCost/TREASURY_MIN из продового кода.
 * Всё остальное (войны бремя, санкции, кризисы, потолок эрозии, мирный дивиденд) —
 * буквальная копия формул из turns.js на 2026-07-04.
 *
 * Запуск: node backend/scripts/sim-military-path.js
 */

const { ofzTotalMonthlyCost } = require("../src/routes/treasury");
const { TREASURY_MIN } = require("../src/rules/rules-engine");

function makeSeededRng(gameId, month) {
  let seed = 0;
  const str = `${gameId}:${month}:auto`;
  for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

// Портирована из turns.js generateAutonomousEvents — сохранена только та часть,
// что реально бьёт по economy (санкционная ветка "Минфин"), остальное отбрасываем
// как нерелевантное для чисто экономического вопроса.
function autonomousEconomyDelta(stats, month, gameId) {
  const rng = makeSeededRng(gameId || "sim", month);
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const corr = stats.corruption ?? 55;
  const tension = stats.social_tension ?? 38;
  const streak = stats.military_streak ?? 0;
  const iso = stats.isolation ?? 68;
  const don = stats.donetsk_control ?? 78;

  const pool = [];
  if (mil < 55) pool.push({ priority: 3, economy: 0 });
  if (streak === 0 && mil < 70) pool.push({ priority: 2, economy: 0 });
  if (iso > 65 && eco < 55) {
    const variants = [-2, -1, -3];
    pool.push({ priority: 2, economy: variants[Math.floor(rng() * variants.length)] });
  }
  if (corr > 65) pool.push({ priority: 2, economy: 0 });
  if (tension > 55) pool.push({ priority: 2, economy: 0 });
  if (iso < 60) {
    const variants = [0, 0, 1];
    pool.push({ priority: 1, economy: variants[Math.floor(rng() * variants.length)] });
  }
  if (mil > 70 && don < 95) pool.push({ priority: 1, economy: 0 });
  pool.push({ priority: 0, economy: 0 }); // нейтральный фон, всегда есть

  const grouped = {};
  for (const ev of pool) (grouped[ev.priority] = grouped[ev.priority] || []).push(ev);
  const shuffled = [];
  for (const pr of Object.keys(grouped).map(Number).sort((a, b) => b - a)) {
    const group = grouped[pr];
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    shuffled.push(...group);
  }
  const picked = shuffled.slice(0, 2);
  return picked.reduce((s, e) => s + (e.economy || 0), 0);
}

const DOMESTIC_CRISIS_DELTAS = [-4, -5, -7, 0, -5, 0, -3, -6]; // economyDelta по каждому из 8 кризисов turns.js (0 = не бьёт по экономике)

/**
 * Один месяц end-month ровно по формулам turns.js. `decreeEconomy`/`decreeTreasury` —
 * эффект указа этого месяца (то, что игрок подписал ДО завершения месяца).
 */
function simulateMonth(stats, month, gameId, { decreeEconomy = 0, decreeTreasury = 0, hadDiplomacyMove = false, rngCrisis = Math.random, rngMutiny = Math.random } = {}) {
  const s = { ...stats };
  const economyAutoEffects = [];

  s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + decreeEconomy));
  s.treasury = (s.treasury ?? 52) + decreeTreasury;

  // --- КАЗНА: доход/расход ---
  const rawTaxIncome = 0; // партия без активных фискальных политик в этом тесте
  const programUpkeep = 0;
  const ofzDebtService = ofzTotalMonthlyCost(s.ofz_count ?? 0, s.key_rate);
  const eco = s.economy ?? 50;
  const rawEconomyIncome = eco >= 50
    ? Math.round(20 + (eco - 50) * 0.6)
    : eco >= 35
      ? Math.round(eco * 0.4)
      : Math.round(Math.max(5, eco * 0.2));
  const employmentNow = s.employment ?? 74;
  const employmentFactor = Math.max(0.6, Math.min(1.3, 1 + (employmentNow - 74) * 0.004));
  const economyIncome = Math.round(rawEconomyIncome * employmentFactor);
  const taxIncome = Math.round(rawTaxIncome * employmentFactor);

  const oilIncome = Math.round(((s.oil_price ?? 85) - 65) * 0.7); // цена отсечения бюджета $65 (см. HANDOFF)
  const fxIncome = Math.round(((s.usd_rub ?? 80) - 80) * 0.4);

  const corrLevel = s.corruption ?? 55;
  const corruptionDrain = corrLevel > 50 ? Math.round(Math.pow((corrLevel - 50) / 50, 1.3) * 12) : 0;

  const TERRITORY_BASELINE = { donetsk_control: 78, luhansk_control: 96, zaporizhzhia_control: 68, kherson_control: 58, kharkiv_control: 12 };
  const territoryGainPts = Object.entries(TERRITORY_BASELINE).reduce(
    (sum, [k, base]) => sum + Math.max(0, (s[k] ?? base) - base), 0
  );
  const territoryUpkeep = Math.round(territoryGainPts / 15);

  const monthlyNet = economyIncome + taxIncome - programUpkeep - ofzDebtService + oilIncome + fxIncome - corruptionDrain - territoryUpkeep;
  const treasuryBefore = typeof s.treasury === "number" ? s.treasury : 52;
  s.treasury = Math.max(TREASURY_MIN, treasuryBefore + monthlyNet);

  // --- Рост ВВП → экономика ---
  const gdpGrowthNow = s.gdp_growth ?? 36;
  const gdpEconomyEffect = Math.round((gdpGrowthNow - 36) / 25);
  if (gdpEconomyEffect) {
    s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + gdpEconomyEffect));
    economyAutoEffects.push({ label: "Рост ВВП", delta: gdpEconomyEffect });
  }

  // --- Ключевая ставка ЦБ ---
  {
    const cbHead = s.cb_head_type ?? "neutral";
    const inflForRate = s.inflation ?? 64;
    const baseTarget = inflForRate > 70 ? 21 : inflForRate > 60 ? 18 : inflForRate < 50 ? 13 : 16;
    const cbTarget = cbHead === "soft" ? baseTarget - 3 : cbHead === "hawkish" ? baseTarget + 2 : baseTarget;
    const clampedTarget = Math.max(5, Math.min(25, cbTarget));
    const currentRate = s.key_rate ?? 18.5;
    const rateSpeed = cbHead === "hawkish" ? 0.20 : cbHead === "soft" ? 0.10 : 0.15;
    const newRate = currentRate + (clampedTarget - currentRate) * rateSpeed;
    s.key_rate = Math.round(newRate * 2) / 2;

    if (s.key_rate > 17) {
      s.inflation = Math.max(0, (s.inflation ?? 64) - 1);
      s.economy = Math.max(0, (s.economy ?? 50) - 1);
      economyAutoEffects.push({ label: "Ставка ЦБ (высокая)", delta: -1 });
    } else if (s.key_rate < 11) {
      s.inflation = Math.min(100, (s.inflation ?? 64) + 1);
      s.economy = Math.min(100, (s.economy ?? 50) + 1);
      economyAutoEffects.push({ label: "Ставка ЦБ (низкая)", delta: 1 });
    }
    if (cbHead === "soft" && s.key_rate > 10) {
      s.inflation = Math.min(100, (s.inflation ?? 64) + 1);
    }
  }

  // --- Оборонзаказ (ВПК) ---
  {
    const milForDefense = s.military ?? 50;
    if (milForDefense >= 50 && milForDefense <= 80) {
      const defenseBoost = Math.floor((milForDefense - 50) / 15);
      if (defenseBoost > 0) {
        s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + defenseBoost));
        economyAutoEffects.push({ label: "Оборонзаказ (ВПК)", delta: defenseBoost });
      }
    }
  }

  // --- Военное бремя ---
  {
    const milNow = s.military ?? 50;
    const warStreak = s.military_streak ?? 0;
    let burdenEconomy = 0, burdenApproval = 0, burdenStability = 0;
    if (milNow > 80) {
      const sizeTax = Math.floor((milNow - 80) / 10) + 1;
      burdenEconomy += sizeTax;
      burdenApproval += 1;
    }
    if (warStreak >= 4) {
      const wearinessHit = Math.min(5, Math.floor((warStreak - 3) * 1.5));
      burdenApproval += wearinessHit;
      burdenStability += Math.ceil(wearinessHit / 2);
    }
    if (burdenEconomy) {
      s.economy = Math.max(0, (s.economy ?? 50) - burdenEconomy);
      economyAutoEffects.push({ label: "Военное бремя", delta: -burdenEconomy });
    }
    if (burdenApproval) s.approval = Math.max(0, (s.approval ?? 50) - burdenApproval);
    if (burdenStability) s.stability = Math.max(0, (s.stability ?? 50) - burdenStability);
  }

  // --- Внутренние кризисы (7% шанс) ---
  if (rngCrisis() < 0.07) {
    const idx = Math.floor(rngCrisis() * DOMESTIC_CRISIS_DELTAS.length);
    const rawDelta = DOMESTIC_CRISIS_DELTAS[idx];
    const stabForMitigation = s.stability ?? 50;
    const crisisMitigation = stabForMitigation > 60 ? Math.min(0.5, (stabForMitigation - 60) / 80) : 0;
    const economyDelta = rawDelta ? Math.round(rawDelta * (1 - crisisMitigation)) : 0;
    if (economyDelta) {
      s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + economyDelta));
      economyAutoEffects.push({ label: "Кризис (случайный)", delta: economyDelta });
    }
  }

  // --- Мятеж элит ---
  const eliteSatNow = s.elite_satisfaction ?? 62;
  if (eliteSatNow < 35 && rngMutiny() < 0.15) {
    const escalates = rngMutiny() < 0.55;
    if (escalates) {
      s.stability = Math.max(0, (s.stability ?? 50) - 9);
      s.approval = Math.max(0, (s.approval ?? 50) - 4);
      s.military = Math.max(0, (s.military ?? 50) - 3);
    } else {
      s.stability = Math.max(0, (s.stability ?? 50) - 4);
    }
    s.elite_satisfaction = Math.min(100, Math.max(0, eliteSatNow - (escalates ? 12 : 8) + 8));
  }

  // --- Инфляционный шок ---
  const inflationNow = s.inflation ?? 64;
  if (inflationNow > 73) {
    const inflationEconomyPenalty = Math.min(3, Math.floor((inflationNow - 73) / 10) + 1);
    s.economy = Math.max(0, (s.economy ?? 50) - inflationEconomyPenalty);
    economyAutoEffects.push({ label: "Инфляционный шок", delta: -inflationEconomyPenalty });
  }

  // --- Спираль казна → экономика ---
  {
    let economyEffect = 0;
    if (s.treasury < 0) economyEffect = -2;
    else if (s.treasury < 15) economyEffect = -1;
    else if (s.treasury > 65 && (s.economy ?? 50) < 82) economyEffect = 1;
    if (economyEffect) {
      s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + economyEffect));
      economyAutoEffects.push({ label: economyEffect < 0 ? "Дефицит/низкая казна" : "Профицит казны", delta: economyEffect });
    }
  }

  // --- Автономные события (санкционная ветка) ---
  const autoEcoDelta = autonomousEconomyDelta(s, month, gameId);
  if (autoEcoDelta) {
    s.economy = Math.max(0, Math.min(100, (s.economy ?? 50) + autoEcoDelta));
    economyAutoEffects.push({ label: "Мир живёт без вас (Минфин)", delta: autoEcoDelta });
  }

  // --- Дипломатическая изоляция ---
  if (!hadDiplomacyMove && (s.diplomacy ?? 50) < 25) {
    s.diplomacy = Math.max(0, (s.diplomacy ?? 50) - 2);
    s.economy = Math.max(0, (s.economy ?? 50) - 1);
    economyAutoEffects.push({ label: "Дипломатическая изоляция", delta: -1 });
  }

  // --- Организационный рост ---
  {
    const noAutoCrisis = economyAutoEffects.every(e => e.delta >= 0);
    const coreEco = s.economy ?? 50, coreStab = s.stability ?? 50, coreDip = s.diplomacy ?? 50, coreAppr = s.approval ?? 50;
    const allHealthy = coreEco >= 55 && coreStab >= 55 && coreDip >= 55 && coreAppr >= 55;
    const allStrong = coreEco >= 70 && coreStab >= 70 && coreDip >= 70 && coreAppr >= 70;
    if (noAutoCrisis && allHealthy) {
      const dividend = allStrong ? 2 : 1;
      s.economy = Math.min(100, coreEco + dividend);
      economyAutoEffects.push({ label: "Организационный рост", delta: dividend });
    }
  }

  // --- Потолок месячной эрозии ---
  const EROSION_CAP = 6;
  const autoErosion = economyAutoEffects.reduce((sum, e) => sum + Math.min(0, e.delta), 0);
  let erosionCapped = false;
  if (autoErosion < -EROSION_CAP) {
    const giveBack = -EROSION_CAP - autoErosion;
    s.economy = Math.min(100, (s.economy ?? 50) + giveBack);
    erosionCapped = true;
  }

  const defeat = s.economy < 30 ? "defeat_collapse"
    : s.approval < 30 ? "defeat_coup"
    : s.stability < 25 ? "defeat_unrest"
    : (s.diplomacy ?? 50) < 15 ? "defeat_isolation"
    : (s.military ?? 50) < 30 ? "defeat_military_collapse"
    : null;

  return { stats: s, economyAutoEffects, erosionCapped, defeat, monthlyNet };
}

function run(label, months, strategyFn) {
  console.log(`\n=== ${label} ===`);
  let stats = {
    economy: 45, military: 86, stability: 60, diplomacy: 43, approval: 65,
    treasury: 20, corruption: 55, inflation: 64, key_rate: 13.5, isolation: 68,
    social_tension: 40, employment: 74, gdp_growth: 36, oil_price: 85, usd_rub: 80,
    donetsk_control: 88, luhansk_control: 100, zaporizhzhia_control: 72, kherson_control: 70, kharkiv_control: 18,
    elite_satisfaction: 62, military_streak: 3, cb_head_type: "soft",
  };
  const gameId = "sim-" + label;
  for (let month = 1; month <= months; month++) {
    const decree = strategyFn(stats, month);
    const rngCrisis = makeSeededRng(gameId + ":crisis", month);
    const rngMutiny = makeSeededRng(gameId + ":mutiny", month * 7 + 3);
    const result = simulateMonth(stats, month, gameId, {
      decreeEconomy: decree.economy || 0,
      decreeTreasury: decree.treasury || 0,
      hadDiplomacyMove: !!decree.diplomacyMove,
      rngCrisis, rngMutiny,
    });
    stats = result.stats;
    if (decree.military) stats.military_streak = (stats.military_streak ?? 0) + 1;
    else stats.military_streak = 0;
    const line = `мес.${String(month).padStart(2)} | эко ${String(Math.round(stats.economy)).padStart(3)} | арм ${String(Math.round(stats.military)).padStart(3)} | каз ${String(Math.round(stats.treasury)).padStart(4)} | стаб ${String(Math.round(stats.stability)).padStart(3)} | диплом ${String(Math.round(stats.diplomacy)).padStart(3)} | одобр ${String(Math.round(stats.approval)).padStart(3)} | эффекты: ${result.economyAutoEffects.map(e => `${e.label}:${e.delta}`).join(", ") || "—"}${result.erosionCapped ? " [ПОТОЛОК]" : ""}`;
    console.log(line);
    if (result.defeat) {
      console.log(`\n💀 ПОРАЖЕНИЕ на месяце ${month}: ${result.defeat}`);
      return { defeat: result.defeat, month };
    }
  }
  console.log(`\n✅ Дожил до конца симуляции (${months} мес.) без поражения. Финал: экономика ${Math.round(stats.economy)}, армия ${Math.round(stats.military)}, казна ${Math.round(stats.treasury)}`);
  return { defeat: null, finalStats: stats };
}

// Сценарий А: непрерывное давление — армия держится ≥85 (наступления каждый месяц),
// экономический указ каждый месяц для компенсации (как я делал в живом плейтесте).
run("A: непрерывные наступления + указ каждый месяц", 16, (stats, month) => {
  return { economy: 3, treasury: -9, military: true }; // средний decree_reform-класс указ
});

// Сценарий Б: "передышка" — каждый 3-й месяц НЕ наступаем (даём military_streak сброситься),
// вместо этого экономический указ посильнее (Программа-класс).
run("Б: наступление 2 месяца из 3, передышка на 3-й", 16, (stats, month) => {
  const resting = month % 3 === 0;
  return resting
    ? { economy: 4, treasury: -17 } // Программа-класс, без наступления
    : { economy: 2, treasury: -9, military: true };
});

// Сценарий В: держим армию НИЖЕ 80 (не добираем до порога военной победы 85, но избегаем
// военного бремени полностью) — проверка, работает ли экономика вообще без бремени армии.
run("В: армия держится на 78 (без военного бремени), чисто эконом. указы", 16, (stats, month) => {
  stats.military = 78; // искусственно фиксируем ниже порога бремени
  return { economy: 3, treasury: -9 };
});
