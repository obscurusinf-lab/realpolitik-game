/**
 * routes/turns.js
 *
 * Двухфазная обработка хода (см. docs/03-known-tradeoffs.md — Вариант A, выбран).
 *
 * POST /games/:gameId/turns/preview
 *   -> вызывает ИИ-геймместера, валидирует ответ, сохраняет классификацию
 *      в Redis (pending-turns.js) с TTL. НИЧЕГО не пишет в Postgres.
 *   -> возвращает { narrative, advisorObjection, statDeltasPreview } игроку
 *      для подтверждения. statDeltasPreview считается тем же rules-engine,
 *      но не применяется — это просто "что будет, если подтвердишь".
 *
 * POST /games/:gameId/turns/confirm
 *   -> читает pending-классификацию из Redis по gameId.
 *   -> если её нет (истёк TTL / не было preview) — 409, просит сделать preview заново.
 *   -> применяет rules-engine, пишет turn/game_state/newsfeed в Postgres
 *      в одной транзакции, как раньше.
 *   -> очищает pending-запись в Redis.
 *
 * POST /games/:gameId/turns/cancel
 *   -> игрок передумал после возражения советника. Просто чистит Redis.
 */

const { classifyTurn } = require("../ai/gamemaster");
// verifyToken injected via options

// Инфляция хранится как внутренний индекс давления 0–100 (старт 64), не проценты.
// Игроку в текстах ленты нужен правдоподобный г/г % — держим формулу синхронной
// с inflationPercent() в frontend/src/App.jsx: линейно, 1 балл = 1 п.п., сдвиг
// откалиброван так, что старт партии (64) = реальная инфляция РФ на июнь 2026 (~6%).
const INFLATION_PCT_OFFSET = 58;
function inflationPercent(score) {
  const s = Math.max(0, Math.min(100, score ?? 64));
  return Math.max(0, s - INFLATION_PCT_OFFSET);
}

/**
 * Проверяет победные/поражения условия после каждого хода.
 * Возвращает строку-статус или null если игра продолжается.
 *
 * Условия победы (ход 24):
 *   - peace_progress >= 100 + economy >= 55 + approval >= 60 + stability >= 60 → "victory"
 *   - peace_progress < 100 но economy/approval/stability в норме → "partial"
 *   - peace_progress >= 100 но статы не дотянули → "partial_peace"
 *
 * Условия поражения (в любой ход):
 *   - approval < 30 → "defeat_coup"
 *   - economy < 30  → "defeat_collapse"
 *   - stability < 25 → "defeat_unrest"
 *   - diplomacy < 15 → "defeat_isolation"
 *   - war_escalation_counter >= 3 → "defeat_war"
 *   - military < 30 → "defeat_military_collapse"
 *   - donetsk_control < 40 И luhansk_control < 40 → "defeat_donbass_lost"
 */
function detectGameOutcome(stats, turnNumber, maxTurns) {
  // Военная победа проверяется ПЕРВОЙ — если контроль над территориями достигнут,
  // война закончена ДО того как экономика успела рухнуть.
  if (turnNumber >= 8) {
    const militaryDominance = (stats.military ?? 50) >= 85;
    const armyReady = (stats.army_morale ?? 50) >= 70 && (stats.readiness ?? 50) >= 70;
    const homeStable = (stats.stability ?? 50) >= 52 && (stats.approval ?? 50) >= 52;
    const economyHolds = (stats.economy ?? 50) >= 36;
    const donbassSecured = (stats.donetsk_control ?? 0) >= 100 && (stats.luhansk_control ?? 0) >= 100;
    const otherRegions = [
      (stats.zaporizhzhia_control ?? 0) >= 85,
      (stats.kherson_control ?? 0) >= 65,
      (stats.kharkiv_control ?? 0) >= 50,
    ].filter(Boolean).length;
    if (militaryDominance && armyReady && homeStable && economyHolds && donbassSecured && otherRegions >= 2) {
      // Принуждение к миру: территории взяты + построен мирный трек (дипломатия с позиции силы).
      const peace = (stats.peace_progress ?? 0);
      if (peace >= 40) return "victory_combined";   // лучший исход — оба пути сошлись
      if (peace < 35) return "victory_military";     // чистая военная победа
      // Зона 35..40 — игрок явно ведёт переговоры: не завершаем партию автоматически,
      // даём окно дожать мирный трек до 40 и получить принуждение к миру.
    }
  }

  // Поражение — проверяем каждый ход
  if (stats.approval < 30)   return "defeat_coup";       // повысили порог с 25
  if (stats.economy < 30)    return "defeat_collapse";   // вернули к 30 (реальный коллапс)
  if (stats.stability < 25)  return "defeat_unrest";     // повысили с 20
  if ((stats.diplomacy ?? 50) < 15) return "defeat_isolation"; // новый тип: изоляция
  if ((stats.war_escalation_counter ?? 0) >= 3) return "defeat_war"; // спираль войны
  if ((stats.military ?? 50) < 30) return "defeat_military_collapse"; // армия небоеспособна
  if ((stats.donetsk_control ?? 100) < 40 && (stats.luhansk_control ?? 100) < 40) return "defeat_donbass_lost"; // ВСУ отбили Донбасс

  // Досрочная мирная победа: доступна начиная с хода 12
  if (turnNumber >= 12) {
    const peace = (stats.peace_progress ?? 0) >= 100;
    const statsOk = stats.economy >= 65 && stats.approval >= 65 && stats.stability >= 65;
    if (peace && statsOk) return "victory";
  }

  // Победа по истечении срока
  if (turnNumber >= maxTurns) {
    const peace = (stats.peace_progress ?? 0) >= 100;
    const statsOk = stats.economy >= 65 && stats.approval >= 65 && stats.stability >= 65;
    if (peace && statsOk) return "victory";
    if (peace && !statsOk) return "partial_peace";
    if (!peace && statsOk)  return "partial";
    // Военное доминирование без полной победы — частичный результат
    if ((stats.military ?? 50) >= 80) return "partial_military";
    return "defeat_time";
  }

  return null;
}
const { applyTurn, computeDelayedEffectDelta, DECREE_DURATION, CRISIS_TURN_WEEKS, NORMAL_TURN_WEEKS, CATEGORY_GROUP } = require("../rules/rules-engine");
const { generateWorldUpdate } = require("../ai/worldUpdate");

// Вычисляет новую дату игры (+1 месяц в обычном режиме, +2 недели в кризисном)
function advanceGameDate(currentDateStr, crisisMode) {
  try {
    const d = new Date(currentDateStr);
    if (isNaN(d)) throw new Error("invalid");
    if (crisisMode) {
      d.setDate(d.getDate() + CRISIS_TURN_WEEKS * 7);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return currentDateStr;
  }
}

// Детерминированный ГСЧ на основе gameId + month.
// Даёт разные числа для разных партий, но воспроизводимые при одинаковых условиях.
function makeSeededRng(gameId, month) {
  let seed = 0;
  const str = `${gameId}:${month}:auto`;
  for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
  return function() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

// Генерирует 1-2 автономных события в конце месяца (мир живёт без игрока).
// Внутри каждой группы приоритета события выбираются случайно (ГСЧ, сид = gameId+month),
// поэтому в разных партиях и разных месяцах при одинаковых условиях события разнятся.
function generateAutonomousEvents(stats, month, gameId) {
  const rng = makeSeededRng(gameId || "default", month);
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const corr = stats.corruption ?? 55;
  const tension = stats.social_tension ?? 38;
  const streak = stats.military_streak ?? 0;
  const iso = stats.isolation ?? 68;
  const don = stats.donetsk_control ?? 78;

  // Пул событий — несколько вариантов для каждого условия
  const pool = [];

  // Украина: зондирует слабые участки при низкой боеспособности
  if (mil < 55) {
    const variants = [
      { text: "ВСУ активизировались на харьковском направлении — разведывательно-ударные группы тестируют линию обороны. Требуется внимание.", statDelta: { kharkiv_control: -2, army_morale: -1 } },
      { text: "Украинские дроны-камикадзе нанесли серию ударов по логистическим узлам в Белгородской области. Поставки на фронт временно нарушены.", statDelta: { readiness: -2, army_morale: -1 } },
      { text: "Разведка фиксирует накопление ВСУ у линии соприкосновения — готовится зондирующая атака на слабых участках.", statDelta: { kherson_control: -2 } },
    ];
    pool.push({ priority: 3, source: "Генштаб", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Украина: контрнаступление если давно перегруппировка
  if (streak === 0 && mil < 70) {
    const variants = [
      { text: "Противник воспользовался оперативной паузой и усилил давление на запорожском фасе. Подтянуты резервы и западное вооружение.", statDelta: { zaporizhzhia_control: -3, military: -1 } },
      { text: "ВСУ начали локальное наступление в Херсонском направлении, используя отсутствие активного давления с нашей стороны.", statDelta: { kherson_control: -4, army_morale: -1 } },
    ];
    pool.push({ priority: 2, source: "Минобороны", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Экономика: санкционное давление
  if (iso > 65 && eco < 55) {
    const variants = [
      { text: "Новый пакет западных ограничений бьёт по параллельному импорту. Ряд поставщиков приостановил отгрузки — логистика усложнилась.", statDelta: { economy: -2, reserves: -1 } },
      { text: "Американские вторичные санкции вынудили китайские банки ограничить транзакции с Россией. Экспортные расчёты усложнились.", statDelta: { economy: -1, reserves: -2 } },
      { text: "Страховщики отказали в покрытии российских судов — стоимость морского фрахта выросла на 40%. Доходы от экспорта нефти сократились.", statDelta: { economy: -3 } },
    ];
    pool.push({ priority: 2, source: "Минфин", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Коррупция: скандал при высоком уровне
  if (corr > 65) {
    const variants = [
      { text: "Утечка в прессу: журналисты-расследователи опубликовали данные об откатах в оборонных закупках. Соцсети взорвались — рейтинг под давлением.", statDelta: { approval: -2, social_tension: 2 } },
      { text: "Губернатор одного из ключевых регионов задержан по подозрению в хищении бюджетных средств. Скандал бьёт по доверию к власти.", statDelta: { approval: -3, stability: -1 } },
      { text: "Расследование «Медиазоны»: в оборонных контрактах выявлена схема двойного списания. Сумма нанесённого ущерба — более ₽80 млрд.", statDelta: { approval: -2, corruption: 2 } },
    ];
    pool.push({ priority: 2, source: "СМИ", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Внутреннее: соц. напряжение
  if (tension > 55) {
    const variants = [
      { text: "Фиксируем нарастание протестных настроений в ряде регионов — в основном связаны с ростом цен и задержками выплат. Ситуация под наблюдением.", statDelta: { stability: -1, lower_class_mood: -2 } },
      { text: "В нескольких промышленных городах прошли стихийные акции против мобилизации и роста цен. Полиция применила силу при разгоне.", statDelta: { stability: -2, approval: -1 } },
      { text: "Опрос ФСО: 62% граждан считают экономическую ситуацию «плохой» или «очень плохой». Базовый электорат теряет доверие.", statDelta: { approval: -2, lower_class_mood: -3 } },
    ];
    pool.push({ priority: 2, source: "ФСБ", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Дипломатия: нейтральные страны ищут контакт
  if (iso < 60) {
    const variants = [
      { text: "Турция и ОАЭ проявили интерес к расширению торговых договорённостей. Предварительные переговоры запланированы на следующий месяц.", statDelta: { diplomacy: 1 } },
      { text: "Индия предложила расширить расчёты в рупиях. Переговоры о новых торговых схемах вышли на рабочий уровень.", statDelta: { diplomacy: 1, reserves: 1 } },
      { text: "Китай усилил торгово-экономическое взаимодействие — объём товарооборота за месяц вырос на 12% год к году.", statDelta: { economy: 1, diplomacy: 1 } },
    ];
    pool.push({ priority: 1, source: "МИД", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Позитив: военные успехи при высокой армии
  if (mil > 70 && don < 95) {
    const variants = [
      { text: "Войска закрепились на новых рубежах. Противник не предпринимал активных действий — время использовано для инженерного укрепления позиций.", statDelta: { army_morale: 1, readiness: 1 } },
      { text: "Успешная контрбатарейная работа: уничтожено несколько позиций натовской артиллерии. Темп обстрелов снизился.", statDelta: { readiness: 2 } },
      { text: "Армия провела успешную перегруппировку: новые ротации повысили боеспособность на ключевых направлениях.", statDelta: { army_morale: 2 } },
    ];
    pool.push({ priority: 1, source: "Минобороны", ...variants[Math.floor(rng() * variants.length)] });
  }
  // Нейтральный фон (всегда, случайный вариант)
  const neutralVariants = [
    `Месяц ${month} завершён в штатном режиме. Оперативная обстановка стабильна, продолжается текущий режим управления.`,
    `Плановые заседания комитетов Госдумы и Совета Федерации прошли без инцидентов. Повестка — бюджетные поправки и кадровые назначения.`,
    `По данным Росстата, промышленное производство в текущем месяце показало нейтральную динамику. Существенных изменений не зафиксировано.`,
  ];
  pool.push({ priority: 0, source: "Администрация Президента", text: neutralVariants[Math.floor(rng() * neutralVariants.length)], statDelta: {} });

  // Сортируем по приоритету. Внутри одного приоритета — перемешиваем через ГСЧ (Fisher-Yates).
  const grouped = {};
  for (const ev of pool) {
    (grouped[ev.priority] = grouped[ev.priority] || []).push(ev);
  }
  const shuffled = [];
  for (const pr of Object.keys(grouped).map(Number).sort((a, b) => b - a)) {
    const group = grouped[pr];
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    shuffled.push(...group);
  }
  return shuffled.slice(0, 2);
}

// --- ФИНАЛЬНАЯ ГЛАВА: сценарные события на ходах 17–23 ---
// Срабатывает однократно для каждого порогового хода.
// Создаёт нарратив давления времени и эскалации перед концом игры.
function generateFinalChapterEvent(stats, month) {
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const peace = stats.peace_progress ?? 0;

  // Событие привязано к конкретному ходу — не дублируется
  if (month === 17) {
    return [{
      source: "Совет Безопасности",
      text: "Внеочередное заседание Совбеза: аналитики фиксируют, что окно для урегулирования конфликта сужается. Западные союзники Киева намерены принять решение о долгосрочном военном пакете в течение 3–4 месяцев — до этого момента переговорная позиция России остаётся более сильной.",
      statDelta: { social_tension: 1 },
      reactions: [{ text: "Время работает против нас — каждый упущенный месяц укрепляет ВПК НАТО.", stat_delta: {} }],
    }];
  }
  if (month === 18) {
    const isWeak = mil < 55 || eco < 45;
    return [{
      source: "Генштаб",
      text: isWeak
        ? "Стратегический доклад: истощение ресурсов достигает критической отметки. Без стабилизации фронта и экономики в течение 2–3 месяцев риск вынужденного выхода из конфликта резко возрастает."
        : "Стратегический доклад: позиции России усилились. Сохраняющееся военное давление вынуждает Киев искать переговорные каналы. Следующие 2–3 месяца — решающие для закрепления достигнутого.",
      statDelta: isWeak ? { stability: -2, army_morale: -2 } : { army_morale: 2, approval: 1 },
      reactions: [{ text: isWeak ? "Момент истины наступает быстрее, чем ожидалось." : "Инициатива на нашей стороне — важно не упустить темп.", stat_delta: {} }],
    }];
  }
  if (month === 20) {
    return [{
      source: "МИД",
      text: peace >= 40
        ? "Турецкое посредничество: Анкара сообщила о готовности Киева к переговорам при определённых условиях. Дипломатическое окно открыто — вопрос в том, воспользуетесь ли вы им."
        : "Дипломатический тупик: все переговорные каналы заморожены. Международные посредники признают, что урегулирование конфликта без военного решения маловероятно в ближайшие месяцы.",
      statDelta: peace >= 40 ? { diplomacy: 2 } : { isolation: 2, diplomacy: -2 },
      reactions: [{ text: peace >= 40 ? "Шанс на прорыв есть — но его надо использовать немедленно." : "Конфликт рискует стать замороженным на годы.", stat_delta: {} }],
    }];
  }
  if (month === 22) {
    return [{
      source: "Администрация Президента",
      text: "Финальный отсчёт: стратегическое окружение оценивает текущую ситуацию как определяющую для следующего десятилетия. Решения, принятые в ближайшие 1–2 месяца, войдут в историю — вопрос лишь в том, какой именно.",
      statDelta: {},
      reactions: [{ text: "История пишется сейчас.", stat_delta: {} }],
    }];
  }
  return [];
}

// --- НЕФТЬ/ВАЛЮТА: реакция на текст новости ---
function dampenFxShock(fxDeltaRaw, newStats) {
  if (!fxDeltaRaw || fxDeltaRaw <= 0) return fxDeltaRaw || 0;
  const reservesNow = newStats.reserves ?? 48;
  const dampening = reservesNow > 70 ? 0.45 : reservesNow > 45 ? 0.25 : reservesNow > 20 ? 0.1 : 0;
  if (dampening <= 0) return fxDeltaRaw;
  const spent = Math.max(1, Math.round(fxDeltaRaw * dampening * 0.4));
  newStats.reserves = Math.max(0, reservesNow - spent);
  return Math.round(fxDeltaRaw * (1 - dampening) * 10) / 10;
}

function applyOilFxTextImpact(text, newStats) {
  if (!text) return;
  const t = text.toLowerCase();
  const OIL_MIN = 35, OIL_MAX = 120, FX_MIN = 55, FX_MAX = 140;
  let oilDelta = 0, fxDelta = 0;

  if (/ормузск|блокад\w* пролив|перебо[йи]\w* постав|опек\+? .*сокра|удар\w* по .*(нефт|танкер)|атак\w* на танкер/.test(t)) oilDelta += 10;
  if (/нефт\w* (подскочил|вырос|взлетел)|цены? на нефть .*(вырос|подскочил)|нефть .*(максимум|рекорд)/.test(t)) oilDelta += 6;
  if (/нефт\w* (обвал|рухн|просел)|выброс\w* .*резерв\w* нефт|рецесси\w* .*спрос|увеличил\w* добычу нефти|обвалив\w* цены|нефтегазовые доходы .*упал/.test(t)) oilDelta -= 8;

  if (/рубль (упал|обвалился|ослаб|просел|рухнул)|курс .*(ослаб|обвал)/.test(t)) fxDelta += 6;
  if (/swift|заморозил\w* .*счет|корреспондентск\w* счет/.test(t)) fxDelta += 5;
  if (/рубль (укрепился|вырос|окреп)/.test(t)) fxDelta -= 5;

  if (!oilDelta && !fxDelta) return;
  if (oilDelta) {
    newStats.oil_price = Math.round(Math.max(OIL_MIN, Math.min(OIL_MAX, (newStats.oil_price ?? 68) + oilDelta)) * 10) / 10;
  }
  if (fxDelta) {
    const dampened = dampenFxShock(fxDelta, newStats);
    newStats.usd_rub = Math.round(Math.max(FX_MIN, Math.min(FX_MAX, (newStats.usd_rub ?? 80) + dampened)) * 10) / 10;
  }
}

// --- УКРАИНА: стратегия (Claude Haiku) ---
const UA_STRATEGY_MULTIPLIERS = {
  military:    { drone_strike: 2.5, rail_sabotage: 2, counterattack: 2.5, dnipro_push: 2, weapons_delivery: 2, donbass_breakthrough: 2.5,
                 diplomatic_offensive: 0.4, war_crimes_tribunal: 0.4, info_warfare: 0.5, soldier_leaks: 0.5, sanctions_push: 0.4 },
  diplomatic:  { diplomatic_offensive: 3, war_crimes_tribunal: 3, sanctions_push: 1.5, info_warfare: 1.2,
                 drone_strike: 0.4, counterattack: 0.4, rail_sabotage: 0.5, dnipro_push: 0.5, weapons_delivery: 0.7, soldier_leaks: 0.8, donbass_breakthrough: 0.4 },
  economic:    { sanctions_push: 3.5, diplomatic_offensive: 2, war_crimes_tribunal: 1.5, soldier_leaks: 1.5,
                 drone_strike: 0.5, counterattack: 0.4, rail_sabotage: 0.5, dnipro_push: 0.4, weapons_delivery: 0.7, info_warfare: 1, donbass_breakthrough: 0.4 },
  information: { info_warfare: 3.5, soldier_leaks: 3, diplomatic_offensive: 1.5, war_crimes_tribunal: 1.2,
                 drone_strike: 0.5, counterattack: 0.4, rail_sabotage: 0.5, dnipro_push: 0.4, weapons_delivery: 0.6, sanctions_push: 0.8, donbass_breakthrough: 0.4 },
  hybrid:      {},
};

async function selectUkraineStrategy(stats, recentMoves, callClaudeApi) {
  const uaArmy = stats.ua_army ?? 65;
  const uaWest = stats.ua_west_support ?? 75;
  const uaMorale = stats.ua_morale ?? 65;
  const ruArmy = stats.military ?? 50;
  const peace = stats.peace_progress ?? 0;
  const ruDiplomacy = stats.diplomacy ?? 50;

  const movesText = recentMoves.length > 0
    ? recentMoves.map(m => `- [${m.mode}] ${m.input}`).join("\n")
    : "- нет данных";

  const prompt = `Ты — стратег украинского командования. Выбери стратегию следующего хода Украины.

СОСТОЯНИЕ УКРАИНЫ:
- Армия ВСУ: ${uaArmy}/100
- Поддержка Запада: ${uaWest}/100
- Боевой дух: ${uaMorale}/100

СОСТОЯНИЕ ПРОТИВНИКА (Россия):
- Армия: ${ruArmy}/100
- Дипломатия: ${ruDiplomacy}/100
- Мирный трек: ${peace}/100

ПОСЛЕДНИЕ ДЕЙСТВИЯ ПРОТИВНИКА:
${movesText}

Выбери стратегию. Ответь ОДНИМ словом (только одно из пяти):
military — военная эскалация (атаки, контрнаступление)
diplomatic — дипломатическое давление (Запад, переговоры, суды)
economic — санкционное давление
information — информационная война
hybrid — смешанная стратегия`;

  try {
    const resp = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 15,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim().toLowerCase();
    const valid = ["military", "diplomatic", "economic", "information", "hybrid"];
    for (const v of valid) { if (raw.includes(v)) return v; }
    return "hybrid";
  } catch {
    return "hybrid";
  }
}

async function registerTurnRoutes(fastify, { db, callClaudeApi, pendingTurnStore, adminEventStore, verifyToken }) {
  async function loadGameForUpdate(client, gameId) {
    const res = await client.query(
      `SELECT g.*, gs.stats, gs.relations, gs.policies, gs.delayed_effects, gs.overview, c.name AS country_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       WHERE g.id = $1 FOR UPDATE`,
      [gameId]
    );
    return res.rows[0] || null;
  }

  // ---------- PREVIEW ----------
  fastify.post("/games/:gameId/turns/preview", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { playerInput, actionMode = "decree" } = request.body;

    if (!playerInput || typeof playerInput !== "string" || playerInput.trim().length === 0) {
      return reply.code(400).send({ error: "playerInput is required" });
    }
    const VALID_MODES = ["decree", "decree_fast", "decree_reform", "decree_program", "crisis", "intel", "military", "diplomacy_op"];
    if (!VALID_MODES.includes(actionMode)) {
      return reply.code(400).send({ error: `actionMode must be one of: ${VALID_MODES.join("|")}` });
    }

    // Проверяем хватает ли инициативы
    const { INITIATIVE_COST, INITIATIVE_REGEN_PER_TURN, INITIATIVE_MAX } = require("../rules/rules-engine");
    const initiativeCheck = await db.query(`SELECT gs.stats FROM game_state gs WHERE gs.game_id = $1`, [gameId]);
    if (initiativeCheck.rowCount > 0) {
      const currentStats = initiativeCheck.rows[0].stats;
      const currentInit = typeof currentStats.initiative === "number" ? currentStats.initiative : INITIATIVE_MAX;
      // В мульти-режиме инициатива не регенерирует на каждом ходу — используем текущее значение.
      // Carryover может поднять её выше 100, поэтому не срезаем INITIATIVE_MAX при проверке.
      const { MULTI_ACTION_TURNS } = require("../rules/rules-engine");
      const availableInit = MULTI_ACTION_TURNS ? currentInit : Math.min(INITIATIVE_MAX, currentInit + INITIATIVE_REGEN_PER_TURN);
      const cost = INITIATIVE_COST[actionMode];
      if (availableInit < cost) {
        return reply.code(400).send({ error: `Недостаточно инициативы. Нужно ${cost}, доступно ${availableInit}. Завершите месяц чтобы восстановить.` });
      }
      // Военный лимит: 1 операция в месяц без перегруппировки
      if (actionMode === "military") {
        const stats = initiativeCheck.rows[0]?.stats || {};
        if (stats.military_blocked_this_month) {
          return reply.code(400).send({ error: "Войска на отдыхе после двойного наступления — военные операции недоступны до следующего месяца." });
        }
        if (stats.military_used_this_month && !stats.regroup_bonus_attack) {
          return reply.code(400).send({ error: "В этом месяце уже проводилась военная операция. Используйте перегруппировку для второго удара." });
        }
      }
    }

    // Только чтение — без FOR UPDATE, не открываем долгую транзакцию на время вызова ИИ
    const gameRes = await db.query(
      `SELECT g.current_turn, gs.stats, gs.relations, gs.policies, gs.delayed_effects, gs.overview,
              c.name AS country_name, COALESCE(g.president_name, u.display_name) AS player_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       LEFT JOIN users u ON u.id = g.owner_user_id
       WHERE g.id = $1`,
      [gameId]
    );

    if (gameRes.rowCount === 0) {
      return reply.code(404).send({ error: "Game not found" });
    }

    const game = gameRes.rows[0];
    const nextTurnNumber = game.current_turn + 1;

    const dueEffects = (game.delayed_effects || []).filter((e) => e.trigger_turn <= nextTurnNumber);
    const remainingEffects = (game.delayed_effects || []).filter((e) => e.trigger_turn > nextTurnNumber);

    let statsAfterDelayed = { ...game.stats };
    for (const effect of dueEffects) {
      for (const [stat, delta] of Object.entries(effect.effect || {})) {
        statsAfterDelayed[stat] = Math.max(0, Math.min(100, (statsAfterDelayed[stat] || 0) + delta));
      }
    }

    const effectiveActionMode = /ядерн|термоядер|nuclear|атомн.*удар/i.test(playerInput)
      ? "military"
      : actionMode;

    const gmClassification = await classifyTurn({
      params: {
        countryName: game.country_name,
        playerName: game.player_name || null,
        gameDate: game.overview?.date || "—",
        turnNumber: nextTurnNumber,
        currentState: { stats: statsAfterDelayed, relations: game.relations },
        activePolicies: game.policies,
        delayedEffects: remainingEffects,
        playerInput,
        actionMode: effectiveActionMode,
      },
      callClaudeApi,
    });

    // Раскрытие тайных операций (covert_*) считается внутри applyTurn (rules-engine.js) —
    // seeded-бросок по exposure_risk, который декларирует ИИ. Старый Math.random()-бросок
    // с подменой action_type на intel_success/intel_failure/... убран целиком (см.
    // docs/04-cabinet-and-categories.md §4.1) — операция всегда «состоялась» по своей
    // строке RULES_TABLE, раскрытие добавляет отдельный штраф поверх.

    // Защита: если AI вернул null_action при явном упоминании ядерного оружия — форсируем nuclear_strike
    const NUCLEAR_RE = /ядерн|термоядер|nuclear|атомн.*удар/i;
    if (gmClassification.action_type === "null_action" && NUCLEAR_RE.test(playerInput)) {
      gmClassification.action_type = "nuclear_strike";
      gmClassification.severity = 3;
      gmClassification.advisor_objection = gmClassification.advisor_objection ||
        "Начальник Генерального штаба: Господин Президент, это решение необратимо. Применение ядерного оружия повлечёт немедленный международный ответ и, вероятно, ядерный удар по нашей территории.";
      if (!gmClassification.narrative || gmClassification.narrative.includes("уточнение") || gmClassification.narrative.includes("не зафиксировано")) {
        gmClassification.narrative = `Приказ о применении ядерного оружия зафиксирован. Штаб Верховного Главнокомандующего переведён в режим боевого дежурства. Мир стоит на пороге ядерной катастрофы впервые с 1945 года.`;
      }
    }

    // Считаем превью дельт ТЕМ ЖЕ rules-engine — то, что увидит игрок,
    // должно совпадать 1:1 с тем, что применится при confirm (тот же seed) —
    // ЗА ИСКЛЮЧЕНИЕМ исхода тайных операций (exposure_risk): его нельзя показывать
    // до подписи приказа, иначе игрок отменит ход и обойдёт риск раскрытия «читом».
    // См. revealCovertOutcome в applyTurn.
    // regenInitiative ДОЛЖЕН совпадать с тем, что использует confirm (!multiAction) —
    // без этого preview в мульти-режиме показывал заниженную (на величину regen) цену
    // хода, расходясь с тем, что реально спишется при confirm. Найдено при тестировании.
    const { MULTI_ACTION_TURNS: previewMultiAction } = require("../rules/rules-engine");
    const { statDeltas, relationDeltas } = applyTurn({
      state: { stats: statsAfterDelayed, relations: game.relations },
      gmClassification,
      gameId,
      turnNumber: nextTurnNumber,
      actionMode,
      revealCovertOutcome: false,
      regenInitiative: !previewMultiAction,
    });

    await pendingTurnStore.save(gameId, {
      gmClassification,
      turnNumber: nextTurnNumber,
      statsAfterDelayed,
      remainingEffects,
      actionMode,
    });

    return reply.send({
      turnNumber: nextTurnNumber,
      narrative: gmClassification.narrative,
      effectLogic: gmClassification.effect_logic || null,
      advisorObjection: gmClassification.advisor_objection,
      statDeltasPreview: statDeltas,
      relationDeltasPreview: relationDeltas,
      gmActionType: gmClassification.action_type,
      corruptionLeak: statDeltas._corruption_leak || 0,
      militaryStreak: typeof statDeltas.military_streak === "number" ? statDeltas.military_streak : null,
      requiresConfirmation: true,
    });
  });

  // ---------- CONFIRM ----------
  fastify.post("/games/:gameId/turns/confirm", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const pending = await pendingTurnStore.get(gameId);
    if (!pending) {
      return reply.code(409).send({
        error: "No pending turn found (expired or never previewed). Call /turns/preview first.",
      });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const game = await loadGameForUpdate(client, gameId);
      if (!game) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Game not found" });
      }

      // Защита от рассинхрона: если current_turn успел измениться с момента
      // preview (например другой клиент того же игрока), отклоняем confirm.
      if (game.current_turn + 1 !== pending.turnNumber) {
        await client.query("ROLLBACK");
        await pendingTurnStore.clear(gameId);
        return reply.code(409).send({
          error: "Game state changed since preview. Call /turns/preview again.",
        });
      }

      const { gmClassification, turnNumber, statsAfterDelayed, remainingEffects, actionMode: pendingActionMode = "decree" } = pending;

      // Военный лимит: повторная проверка (защита от race condition)
      const confirmAt = gmClassification.action_type;
      const isConfirmMilitary = CATEGORY_GROUP.military_operations.has(confirmAt);
      if (isConfirmMilitary) {
        if (game.stats?.military_blocked_this_month) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Войска на отдыхе после двойного наступления — военные операции недоступны до следующего месяца." });
        }
        if (game.stats?.military_used_this_month && !game.stats?.regroup_bonus_attack) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "В этом месяце уже проводилась военная операция. Используйте перегруппировку для второго удара." });
        }
      }

      const crisisMode = !!(game.stats?.crisis_mode || game.overview?.crisis_mode);
      const { MULTI_ACTION_TURNS } = require("../rules/rules-engine");
      const multiAction = MULTI_ACTION_TURNS;

      const { newStats, newRelations, statDeltas, relationDeltas } = applyTurn({
        state: { stats: statsAfterDelayed, relations: game.relations },
        gmClassification,
        gameId,
        turnNumber,
        actionMode: pendingActionMode,
        crisisMode,
        regenInitiative: !multiAction, // в мульти-режиме инициатива = бюджет месяца (регенерация в конце месяца)
        revealCovertOutcome: true, // раскрытие тайной операции считается только здесь, один раз, после подписи
      });

      // Снапшот после декрета — для расчёта changelog в конце хода
      const CHANGELOG_KEYS = ["economy", "military", "stability", "diplomacy", "approval"];
      const statsAfterDecree = Object.fromEntries(CHANGELOG_KEYS.map(k => [k, newStats[k] ?? 50]));

      // Отслеживаем военные операции (лимит 1/мес, 2-я требует перегруппировки)
      if (isConfirmMilitary) {
        if (newStats.regroup_bonus_attack && newStats.military_used_this_month) {
          // Второй удар благодаря перегруппировке — блок следующего месяца
          delete newStats.regroup_bonus_attack;
          newStats.military_locked_next_month = true;
        }
        newStats.military_used_this_month = true;
      }

      // --- ТЕРРИТОРИАЛЬНЫЙ КОНТРОЛЬ ---
      // Наступательные операции продвигают фронт, peace/diplomacy могут фиксировать или уступать территории
      {
        const TERRITORY_KEYS = ["donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"];
        const TERRITORY_HARDNESS = { donetsk: 1.0, luhansk: 0.6, zaporizhzhia: 1.2, kherson: 1.3, kharkiv: 1.5 };
        const at = gmClassification.action_type;
        const sev = gmClassification.severity || 2;
        const isOffensiveLike = CATEGORY_GROUP.military_offensive_like.has(at);
        const isDefensiveLike = CATEGORY_GROUP.military_defensive_like.has(at);
        const isDiplomaticLike = CATEGORY_GROUP.diplomatic_activity.has(at) || pendingActionMode === "diplomacy_op";

        if (isOffensiveLike) {
          // Прогресс зависит от армии и severity. Опыт войск (veterans) — обстрелянные части
          // эффективнее берут территорию независимо от текущего духа/техники.
          const armyQuality = ((newStats.army_morale ?? 50) + (newStats.readiness ?? 50) + (newStats.equipment ?? 50) + (newStats.veterans ?? 50)) / 4;
          const baseGain = sev * 3 + Math.max(0, (armyQuality - 60) / 5); // 3-12 pts
          for (const key of TERRITORY_KEYS) {
            const regionName = key.replace("_control", "");
            const hardness = TERRITORY_HARDNESS[regionName] || 1.0;
            const current = newStats[key] ?? 50;
            if (current < 100) {
              // Труднее брать уже занятые территории и более укреплённые
              const effectiveness = Math.max(0.1, 1 - (current / 100) * 0.5);
              const gain = Math.round((baseGain / hardness) * effectiveness);
              newStats[key] = Math.min(100, current + Math.max(1, gain));
            }
          }
        } else if (isDefensiveLike) {
          // Оборона — удержание. Небольшое восстановление потерянных позиций
          for (const key of TERRITORY_KEYS) {
            const current = newStats[key] ?? 50;
            if (current < 60 && current > 0) {
              newStats[key] = Math.min(60, current + 2);
            }
          }
        } else if (isDiplomaticLike) {
          // Мирный/дипломатический трек — небольшие уступки на спорных территориях
          const concession = sev === 3 ? 4 : sev === 2 ? 2 : 1;
          for (const key of ["kharkiv_control", "kherson_control"]) {
            const current = newStats[key] ?? 50;
            // Уступаем только спорное — не более 20 пунктов за всю игру
            if (current > 5) {
              newStats[key] = Math.max(5, current - concession);
            }
          }
        } else if (at === "diplo_pressure") {
          // Жёсткая риторика — обострение, мелкие тактические потери
          const kh = "kharkiv_control";
          const current = newStats[kh] ?? 12;
          newStats[kh] = Math.max(0, current - 3);
        } else if (at === "null_action") {
          // Бездействие — контрнаступление Украины на спорных направлениях
          for (const key of ["kharkiv_control", "kherson_control"]) {
            const current = newStats[key] ?? 50;
            newStats[key] = Math.max(0, current - 3);
          }
          newStats["zaporizhzhia_control"] = Math.max(0, (newStats["zaporizhzhia_control"] ?? 68) - 1);
        }

        // --- Украинское сопротивление при наступлении ---
        // Каждый offensive — ВСУ и союзники контратакуют: случайный откат 1-3 территорий
        if (isOffensiveLike) {
          // Опытные части лучше держат удар при контратаке — тоже снижает интенсивность отката.
          const armyQuality = ((newStats.army_morale ?? 50) + (newStats.readiness ?? 50) + (newStats.veterans ?? 50)) / 3;
          // Интенсивность ответа зависит от западной поддержки (diplomacy_vs_west прокси = relations с США/ЕС)
          const resistanceIntensity = Math.max(1, Math.round(3 - (armyQuality - 50) / 20));
          // Украина контратакует преимущественно на слабых флангах (Харьков, Херсон)
          const contestedKeys = ["kharkiv_control", "kherson_control", "zaporizhzhia_control"];
          const numContested = Math.min(contestedKeys.length, 1 + Math.floor(Math.random() * resistanceIntensity));
          const shuffled = contestedKeys.sort(() => Math.random() - 0.5).slice(0, numContested);
          for (const key of shuffled) {
            const current = newStats[key] ?? 0;
            const pushback = Math.round(1 + Math.random() * resistanceIntensity);
            newStats[key] = Math.max(0, current - pushback);
          }
          // Потери от боёв: армейский моральный откат
          newStats.army_morale = Math.max(0, (newStats.army_morale ?? 50) - Math.round(1 + Math.random() * 3));
        }
      }
      // --- конец территорий ---

      // Автоматический выход из кризиса если стабильность восстановилась
      if (crisisMode && newStats.stability >= 40) {
        newStats.crisis_mode = false;
      } else if (crisisMode) {
        newStats.crisis_mode = true;
      }
      // Автоматический вход в кризис
      if (!crisisMode && newStats.stability < 25) {
        newStats.crisis_mode = true;
      }

      // Сдвигаем дату игры. В мульти-режиме дата НЕ двигается на каждое действие —
      // только при «Завершить месяц» (см. /turns/end-month).
      const currentGameDate = game.overview?.date;
      const newGameDate = (!multiAction && currentGameDate) ? advanceGameDate(currentGameDate, crisisMode) : null;

      const newDelayedEffects = (gmClassification.delayed_effects || []).map((e, idx) => {
        const delta = computeDelayedEffectDelta({
          category: gmClassification.action_type,
          stat: e.stat,
          gameId,
          turnNumber,
          effectIndex: idx,
        });
        return {
          trigger_turn: turnNumber + e.trigger_turn_offset,
          effect: { [e.stat]: delta },
          reason: e.reason,
        };
      });

      const updatedDelayedEffects = [...remainingEffects, ...newDelayedEffects];

      await client.query(
        `INSERT INTO turns (game_id, turn_n, player_input, action_mode, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection, stats_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          gameId,
          turnNumber,
          request.body?.playerInput || "(см. gm_classification)",
          pendingActionMode,
          JSON.stringify(gmClassification),
          JSON.stringify(statDeltas),
          JSON.stringify(relationDeltas),
          gmClassification.narrative,
          gmClassification.advisor_objection,
          JSON.stringify(newStats),
        ]
      );

      let updatedPolicies = game.policies || [];
      if (gmClassification.policy_update?.is_new_policy) {
        const GAME_MAX_TURNS = 24;
        const rawDuration = gmClassification.policy_update.duration_turns || DECREE_DURATION[pendingActionMode] || 5;
        // Срок не может выйти за пределы партии (24 хода) и не превышает разумный потолок (12 — госпрограмма).
        const remainingTurns = Math.max(1, GAME_MAX_TURNS - turnNumber);
        const policyDuration = Math.min(rawDuration, 12, remainingTurns);
        updatedPolicies = [
          ...updatedPolicies,
          {
            title: gmClassification.policy_update.title,
            turn: turnNumber,
            target_turn: turnNumber + policyDuration,
            duration_turns: policyDuration,
            status: "active",
            items: gmClassification.policy_update.items || [],
            completion_conditions: gmClassification.policy_update.completion_conditions || null,
            newsfeed_keyword: gmClassification.policy_update.title,
          },
        ];
      }

      // Обновляем дату в overview
      let updatedOverview = game.overview || {};
      if (newGameDate) updatedOverview = { ...updatedOverview, date: newGameDate };
      if (newStats.crisis_mode !== undefined) {
        updatedOverview = { ...updatedOverview, crisis_mode: newStats.crisis_mode };
      }

      await client.query(
        `UPDATE game_state
         SET stats = $1, relations = $2, policies = $3, delayed_effects = $4, overview = $5, updated_at = now()
         WHERE game_id = $6`,
        [JSON.stringify(newStats), JSON.stringify(newRelations), JSON.stringify(updatedPolicies), JSON.stringify(updatedDelayedEffects), JSON.stringify(updatedOverview), gameId]
      );

      // В мульти-режиме месяц (current_turn) НЕ продвигается на действие — только в /turns/end-month.
      if (!multiAction) {
        await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);
      }

      // Для тайных операций — без публичных комментариев, только внутренний брифинг
      const isSecret = pendingActionMode === "intel";
      const isDiplomacy = pendingActionMode === "diplomacy_op";
      const isDecree = pendingActionMode.startsWith("decree") || pendingActionMode === "crisis";
      applyOilFxTextImpact(gmClassification.narrative, newStats);
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          gameId,
          turnNumber,
          isSecret ? "news" : (gmClassification.policy_update?.is_new_policy ? "decree" : "news"),
          isSecret ? "Служба внешней разведки" : isDiplomacy ? "МИД России" : (isDecree ? "Президентский указ" : "Брифинг штаба"),
          isSecret ? `[СЕКРЕТНО] ${gmClassification.narrative}` : gmClassification.narrative,
          isSecret ? "[]" : JSON.stringify(gmClassification.newsfeed_reactions || []),
        ]
      );

      // --- ЕСТЕСТВЕННЫЙ РАСПАД МИРНОГО ТРЕКА ---
      // Если игрок не делает дипломатию/мирные инициативы — мир сам по себе распадается.
      // В мульти-режиме пассивный распад переносится в конец месяца (/turns/end-month).
      if (!multiAction) {
        const isActiveDiplomacy = CATEGORY_GROUP.diplomatic_activity.has(gmClassification.action_type);
        const isOffensiveLikeForDecay = CATEGORY_GROUP.military_offensive_like.has(gmClassification.action_type);
        if (!isActiveDiplomacy && (newStats.peace_progress ?? 0) > 5) {
          const p = newStats.peace_progress ?? 0;
          // Установленный мир (>=40, порог принуждения к миру) распадается заметно медленнее:
          // игрок, выстроивший мирный трек, может давить военным путём, не теряя его —
          // «дипломатия с позиции силы». Низкий мир по-прежнему тает быстро.
          let decay = isOffensiveLikeForDecay ? 7 : 4;
          if (p >= 40) decay = isOffensiveLikeForDecay ? 3 : 1;
          newStats.peace_progress = Math.max(0, p - decay);
        }
      }

      // --- ВОЕННЫЙ БЛОУЭФФЕКТ ---
      // Наступательные операции с вероятностью 35% вызывают эскалацию и международное осуждение
      if (CATEGORY_GROUP.military_offensive_like.has(gmClassification.action_type) && Math.random() < 0.20) {
        const BLOWBACK_EVENTS = [
          { source: "AP", penalty: 8, diplomacyDelta: -5, approvalDelta: -4,
            text: "Международный суд ООН открыл расследование в связи с последними военными операциями. Верховный комиссар по правам человека ООН Гомес потребовал немедленного прекращения огня." },
          { source: "Reuters", penalty: 10, diplomacyDelta: -6, economyDelta: -4,
            text: "G7 ввела новый пакет санкций в ответ на военные действия. Под удар попали госбанки и экспорт энергоносителей. Рубль упал на 8% за один день." },
          { source: "Al Jazeera", penalty: 6, diplomacyDelta: -4, stabilityDelta: -3,
            text: "Массовые антивоенные протесты прошли в 20 городах страны. Матери погибших солдат вышли на улицы — полиция применила силу, что вызвало новую волну возмущения." },
          { source: "Financial Times", penalty: 12, economyDelta: -5, diplomacyDelta: -5,
            text: "Крупнейшие международные банки заморозили корреспондентские счета российских структур. Доступ к SWIFT для ещё 12 банков закрыт. Экспортные доходы резко сократились." },
          { source: "Bild", penalty: 7, diplomacyDelta: -5,
            text: "Германия, Франция и Италия потребовали созыва Совета Безопасности ООН. Европейские столицы говорят о «военных преступлениях» и готовят ордер Международного уголовного суда." },
        ];
        const blowback = BLOWBACK_EVENTS[Math.floor(Math.random() * BLOWBACK_EVENTS.length)];
        newStats.peace_progress = Math.max(0, (newStats.peace_progress ?? 0) - blowback.penalty);
        if (blowback.diplomacyDelta) newStats.diplomacy = Math.max(0, Math.min(100, (newStats.diplomacy ?? 50) + blowback.diplomacyDelta));
        if (blowback.approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + blowback.approvalDelta));
        if (blowback.economyDelta) newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + blowback.economyDelta));
        if (blowback.stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + blowback.stabilityDelta));
        applyOilFxTextImpact(blowback.text, newStats);
        // Счётчик военной эскалации — накапливается, ведёт к defeat_war
        newStats.war_escalation_counter = Math.min(5, (newStats.war_escalation_counter ?? 0) + 1);
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, turnNumber, "news", blowback.source, blowback.text, JSON.stringify([
            { emoji: "⚠️", label: "эскалация", count: Math.floor(Math.random() * 100) + 50 },
          ])]
        );
        fastify.log.info({ gameId, source: blowback.source }, "Military blowback fired");
      } else if (!CATEGORY_GROUP.military_offensive_like.has(gmClassification.action_type)) {
        // Снижаем счётчик если не воюем
        if ((newStats.war_escalation_counter ?? 0) > 0) {
          newStats.war_escalation_counter = Math.max(0, (newStats.war_escalation_counter ?? 0) - 1);
        }
      }

      // ВНУТРЕННИЕ КРИЗИСЫ и ВОЕННО-ЭКОНОМИЧЕСКОЕ ДАВЛЕНИЕ перенесены в /turns/end-month:
      // в MULTI_ACTION_TURNS режиме несколько confirm в месяц → стреляли бы при каждом действии.

      // --- ВМЕШАТЕЛЬСТВО ТРЕТЬИХ АКТОРОВ ---
      // Когда мирный трек растёт, акторы с интересом в войне мешают.
      // Вероятность: 20% при 30, до 65% при 90+.
      const peaceNow = newStats.peace_progress ?? 0;
      if (peaceNow >= 25) {
        const interferenceChance = Math.min(0.65, 0.20 + (peaceNow - 25) * 0.008);
        if (Math.random() < interferenceChance) {
          const INTERFERENCE_ACTORS = [
            // Западные правительства
            { minPeace: 25, source: "Reuters", penalty: 15, diplomacyDelta: -4,
              text: "Министр иностранных дел Великобритании Лэмонд экстренно прилетел в Киев. Лондон настаивает на продолжении боевых действий и обещает увеличить поставки вооружений — «не время для переговоров»." },
            { minPeace: 25, source: "BBC", penalty: 12, diplomacyDelta: -3,
              text: "Премьер-министр Великобритании Стармер объявил о «беспрецедентном» пакете военной помощи Украине. Лондон открыто предупредил Москву: любой мирный договор без одобрения Запада — «нелегитимен»." },
            { minPeace: 30, source: "Politico", penalty: 16, diplomacyDelta: -5,
              text: "Польша и страны Балтии сформировали «Коалицию несогласных» против переговоров. Варшава пригрозила наложить вето на любое решение ЕС, легитимизирующее российские территориальные претензии." },
            { minPeace: 30, source: "AP", penalty: 14, diplomacyDelta: -4,
              text: "Экстренное заседание НАТО в Брюсселе: альянс потребовал от Киева отклонить российские мирные условия. Генсек Альянса Руттерс заявил — любой договор без полного вывода российских войск неприемлем." },
            // Американский фактор
            { minPeace: 25, source: "Bloomberg", penalty: 13, economyDelta: -3,
              text: "Американский ВПК объявил о новом контракте на поставку Украине вооружений на $9 млрд. Конгресс одобрил экстренный пакет военной помощи. Акции Raytheon и Lockheed выросли на 12%." },
            { minPeace: 45, source: "NYT", penalty: 15, diplomacyDelta: -4,
              text: "Сенатор Хоукс инициировал слушания: «Любое мирное соглашение с Россией — это Мюнхен-2». Администрация Белого дома под давлением заморозила официальные контакты с российской стороной." },
            { minPeace: 55, source: "Washington Post", penalty: 17, diplomacyDelta: -5, economyDelta: -3,
              text: "Конгресс США принял закон о немедленных санкциях против любой страны, предоставляющей площадку для переговоров. Под ударом — ОАЭ, Турция, Индия. Международная дипломатия парализована." },
            // Внутренний российский фактор
            { minPeace: 30, source: "Коммерсантъ", penalty: 11, stabilityDelta: -4,
              text: "Силовой блок выразил несогласие с мирными инициативами президента. Директор ФСБ Патров провёл закрытое совещание — источники говорят о «красных линиях», которые не должны быть пересечены." },
            { minPeace: 35, source: "РБК", penalty: 10, stabilityDelta: -5, approvalDelta: -3,
              text: "Группа депутатов Думы потребовала денонсации мирных инициатив. «Мы отдали слишком много жизней, чтобы сейчас договариваться» — заявил Соколин. Силовики демонстративно бойкотировали совещание в Кремле." },
            { minPeace: 45, source: "Фонтанка", penalty: 9, stabilityDelta: -4, approvalDelta: -4,
              text: "Ветеранские организации и «Комитет матерей погибших» вступили в открытое противостояние: одни требуют мира, другие — продолжения «до победы». Раскол в обществе усиливается." },
            { minPeace: 50, source: "Медиазона", penalty: 8, stabilityDelta: -6,
              text: "Утечка: группа генералов направила закрытое письмо в Совет Безопасности с требованием отставки гражданских советников, выступающих за переговоры. Армия не готова принять «позорный мир»." },
            // Украинский фактор
            { minPeace: 35, source: "Kyiv Post", penalty: 14, diplomacyDelta: -5,
              text: "Националистические формирования Украины отказались выполнять приказ об отводе войск. Командиры заявили: «Мы не подчиняемся приказам, противоречащим нашей присяге освободить все украинские земли»." },
            { minPeace: 50, source: "Украинская правда", penalty: 12, diplomacyDelta: -4,
              text: "Митинги в Киеве: сотни тысяч вышли против любых переговоров с Россией. Зелин под давлением сделал жёсткое заявление — никаких компромиссов по территориям. Мирный трек трещит по швам." },
            // Европейский фактор
            { minPeace: 40, source: "Le Monde", penalty: 18, diplomacyDelta: -6,
              text: "Экстренный саммит G7: лидеры семёрки потребовали от Киева отклонить российские инициативы и пригрозили санкциями посредникам, содействующим «несправедливому миру»." },
            { minPeace: 60, source: "Der Spiegel", penalty: 20, stabilityDelta: -5, economyDelta: -4,
              text: "Утечка из BND: США рассматривают прямое участие в конфликте если Украина подпишет мирный договор. «Стратегическое поражение» неприемлемо для Вашингтона. Немецкие политики в панике." },
            { minPeace: 55, source: "Financial Times", penalty: 16, economyDelta: -6, diplomacyDelta: -4,
              text: "Европейский банк реконструкции и развития объявил о заморозке финансирования любых проектов с российским участием. Брюссель ввёл 14-й пакет санкций — удар по нефтяному экспорту." },
            // Азиатский и Ближневосточный фактор
            { minPeace: 35, source: "South China Morning Post", penalty: 10, diplomacyDelta: -3,
              text: "Китай публично дистанцировался от мирных инициатив — «Пекин не вмешивается во внутренние дела суверенных государств». Китайские компании приостановили сделки с Россией под давлением США." },
            { minPeace: 40, source: "Haaretz", penalty: 9, diplomacyDelta: -4,
              text: "Израиль отказался выступить посредником в переговорах. Иерусалим «не намерен ссориться с Вашингтоном». Израильские компании тихо сворачивают деловые связи с российскими структурами." },
            { minPeace: 45, source: "Arab News", penalty: 11, economyDelta: -4,
              text: "Саудовская Аравия резко увеличила добычу нефти, обвалив цены. Нефтегазовые доходы России упали на 18%. Эр-Рияд недвусмысленно дал понять: цена мира — экономические уступки." },
            { minPeace: 50, source: "Al Jazeera", penalty: 8, diplomacyDelta: -3,
              text: "Турция под давлением США заморозила переговорную площадку в Стамбуле. Эрдоев вынужден выбирать между ролью посредника и членством в НАТО — Анкара выбирает Брюссель." },
            // ВПК и финансовые интересы
            { minPeace: 30, source: "Defense News", penalty: 13, economyDelta: -3,
              text: "Консорциум западных оружейных концернов выделил $500 млн на лоббирование «продолжения конфликта» в Конгрессе и парламентах ЕС. PR-кампания «Мир — это капитуляция» запущена в 40 странах." },
            { minPeace: 55, source: "Axios", penalty: 14, diplomacyDelta: -5, economyDelta: -4,
              text: "Утечка: крупнейшие хедж-фонды Уолл-стрит сделали ставки на продолжение войны на $200 млрд. Финансовое лобби давит на Белый дом — «мир обвалит наши портфели»." },
            // Внутренние олигархи и ФСБ
            { minPeace: 60, source: "The Bell", penalty: 12, stabilityDelta: -5, economyDelta: -3,
              text: "Олигархи, нажившиеся на военных контрактах, организовали кампанию против мира. Сотни миллиардов рублей в военной промышленности оказались под угрозой при завершении конфликта." },
            { minPeace: 70, source: "Новая газета", penalty: 16, stabilityDelta: -6, approvalDelta: -4,
              text: "ФСБ инициировала уголовные дела против нескольких чиновников, поддержавших мирный трек. Послание чёткое: кто выступает за переговоры — предатель. Часть советников президента молчит." },
          ].filter(a => a.minPeace <= peaceNow);

          if (INTERFERENCE_ACTORS.length > 0) {
            const actor = INTERFERENCE_ACTORS[Math.floor(Math.random() * INTERFERENCE_ACTORS.length)];
            newStats.peace_progress = Math.max(0, peaceNow - actor.penalty);
            if (actor.diplomacyDelta) newStats.diplomacy = Math.max(0, Math.min(100, (newStats.diplomacy ?? 50) + actor.diplomacyDelta));
            if (actor.stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + actor.stabilityDelta));
            if (actor.economyDelta) newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + actor.economyDelta));
            if (actor.approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + actor.approvalDelta));
            applyOilFxTextImpact(actor.text, newStats);
            await client.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
              [gameId, turnNumber, "news", actor.source, actor.text, JSON.stringify([
                { emoji: "😤", label: "возмущение", count: Math.floor(Math.random() * 80) + 40 },
                { emoji: "😟", label: "беспокойство", count: Math.floor(Math.random() * 60) + 20 },
              ])]
            );
            await client.query(
              `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
              [JSON.stringify(newStats), gameId]
            );
            fastify.log.info({ gameId, actor: actor.source, penalty: actor.penalty }, "Third-party interference fired");
          }
        }
      }
      // --- конец вмешательства ---

      // --- ДЕЙСТВИЯ УКРАИНЫ ---
      // Украина выполняет одно действие каждый ход — в зависимости от состояния игры
      {
        const mil = newStats.military ?? 50;
        const eco = newStats.economy ?? 50;
        const peace = newStats.peace_progress ?? 0;
        const don = newStats.donetsk_control ?? 78;
        const kha = newStats.kharkiv_control ?? 12;

        // Все возможные действия Украины, каждое имеет вес (weight) и условие активности
        const UA_ACTIONS = [
          // Дроны и удары по инфраструктуре
          {
            type: "drone_strike", weight: eco > 45 ? 3 : 5,
            title: "Удар по нефтяной инфраструктуре",
            text: "Украинские FPV-дроны атаковали нефтеперерабатывающий завод в Саратовской области. Пожар продолжается несколько часов — ущерб оценивается в $200 млн. Нефтяные фьючерсы выросли на фоне перебоев поставок.",
            economyDelta: -3, stabilityDelta: -1,
            responses: [
              { label: "Усилить ПВО и ввести режим воздушной тревоги в пострадавших регионах", type: "defend" },
              { label: "Нанести ответный удар по украинской энергетической инфраструктуре", type: "retaliate" },
              { label: "Признать потери и продолжить военную программу в штатном режиме", type: "accept" },
            ],
          },
          {
            type: "rail_sabotage", weight: mil > 70 ? 2 : 3,
            title: "Диверсия на логистической инфраструктуре",
            text: "Группа украинских диверсантов подорвала железнодорожный мост в Курской области. Движение военных грузов нарушено. Переброска техники на фронт задерживается на несколько суток.",
            militaryDelta: -2, readinessDelta: -3,
            responses: [
              { label: "Развернуть силы ФСБ и Росгвардии для зачистки приграничных районов", type: "defend" },
              { label: "Ответить ударами по украинским транспортным узлам", type: "retaliate" },
              { label: "Переориентировать логистику на обходные маршруты", type: "accept" },
            ],
          },
          // Контрнаступление
          {
            type: "counterattack", weight: kha < 30 ? 4 : 2,
            title: "Контрнаступление ВСУ",
            text: "Силы ВСУ при поддержке западной артиллерии предприняли контрнаступление на харьковском направлении. Бои идут в нескольких сёлах. Российские подразделения отходят на заранее подготовленные позиции.",
            kharkivDelta: -4, army_moraleDelta: -2,
            responses: [
              { label: "Экстренно перебросить резервы для стабилизации линии фронта", type: "defend" },
              { label: "Начать контрудар с целью полного окружения прорвавшихся частей", type: "retaliate" },
              { label: "Выровнять линию обороны — тактическое отступление сохранит силы", type: "accept" },
            ],
          },
          {
            type: "donbass_breakthrough", weight: mil < 30 ? 6 : 0,
            title: "Прорыв фронта в Донбассе",
            text: "Резкое падение боеспособности российской группировки позволило ВСУ провести масштабное наступление на донбасском направлении. Украинские части заняли ряд населённых пунктов, ранее считавшихся глубоким тылом — линия фронта рушится на глазах.",
            donetskDelta: -8, luhanskDelta: -6, army_moraleDelta: -4,
            responses: [
              { label: "Экстренно перебросить резервы и стабилизировать фронт любой ценой", type: "defend" },
              { label: "Нанести массированный контрудар для восстановления позиций", type: "retaliate" },
              { label: "Организовать плановый отход на новые рубежи обороны", type: "accept" },
            ],
          },
          {
            type: "dnipro_push", weight: don > 90 ? 4 : 1,
            title: "Удары по переправам через Днепр",
            text: "ВСУ нанесли серию ракетных ударов по мостам и переправам через Днепр. Снабжение группировки в Херсонской области осложнено. Командование вынуждено перейти на воздушное снабжение.",
            khersonDelta: -3, economyDelta: -2,
            responses: [
              { label: "Организовать альтернативные маршруты снабжения через понтонные переправы", type: "defend" },
              { label: "Нанести превентивные удары по украинским ракетным позициям", type: "retaliate" },
              { label: "Перегруппировать войска и перейти к обороне правого берега", type: "accept" },
            ],
          },
          // Дипломатическое давление
          {
            type: "diplomatic_offensive", weight: peace > 30 ? 5 : 2,
            title: "Дипломатическое наступление Киева",
            text: "Глава МИД Украины совершил стремительный тур по европейским столицам. Киев добился расширения пакета помощи и новых обязательств по поставкам вооружений. Мирные инициативы Москвы названы «дымовой завесой».",
            peace_progressDelta: -10, diplomacyDelta: -3,
            responses: [
              { label: "Запустить контрдипломатическую кампанию через нейтральных посредников", type: "defend" },
              { label: "Жёстко заявить о нелегитимности киевского режима на международных площадках", type: "retaliate" },
              { label: "Проигнорировать — время работает на нас", type: "accept" },
            ],
          },
          {
            type: "war_crimes_tribunal", weight: peace > 50 ? 4 : 1,
            title: "Украина давит на международные суды",
            text: "По запросу Украины МУС выдал ещё 12 ордеров на арест российских чиновников и военных. Западные СМИ широко освещают показания свидетелей. Ряд нейтральных стран заморозил дипломатические контакты.",
            diplomacyDelta: -4, approvalDelta: -2,
            responses: [
              { label: "Организовать встречную информационную кампанию с доказательствами украинских преступлений", type: "defend" },
              { label: "Официально отозвать признание юрисдикции МУС и потребовать от союзников того же", type: "retaliate" },
              { label: "Принять к сведению — западные суды не имеют реальных рычагов давления", type: "accept" },
            ],
          },
          // Информационная война
          {
            type: "info_warfare", weight: 3,
            title: "Информационная атака",
            text: "Украинские хакеры взломали несколько российских телеграм-каналов и региональных сайтов, разместив антивоенный контент и данные о потерях. Видео с реальными потерями армии набирает миллионы просмотров внутри страны.",
            approvalDelta: -2, stabilityDelta: -2,
            responses: [
              { label: "Задействовать Роскомнадзор и ФСБ для блокировки и зачистки контента", type: "defend" },
              { label: "Ответить мощной контрпропагандистской волной о победах армии", type: "retaliate" },
              { label: "Алгоритмически подавить распространение без широкой огласки", type: "accept" },
            ],
          },
          {
            type: "soldier_leaks", weight: 2,
            title: "Утечка: потери армии",
            text: "Независимые журналисты опубликовали базу данных погибших с именами и регионами. Матери и жёны солдат начали стихийные акции у военкоматов. Телеграм-каналы фиксируют резкий рост антивоенных настроений.",
            approvalDelta: -3, stabilityDelta: -3,
            responses: [
              { label: "Уголовное преследование источников утечки и распространителей", type: "defend" },
              { label: "Публично опровергнуть данные, представить альтернативную статистику", type: "retaliate" },
              { label: "Выплатить компенсации семьям и усилить контроль за информацией", type: "accept" },
            ],
          },
          // Экономическое давление
          {
            type: "sanctions_push", weight: eco < 50 ? 4 : 2,
            title: "Киев лоббирует новые санкции",
            text: "Украина передала в Конгресс США и Европарламент пакет доказательств по обходу санкций через третьи страны. США и ЕС готовят вторичные санкции против посредников — Индии, ОАЭ, Турции.",
            economyDelta: -3, diplomacyDelta: -2,
            responses: [
              { label: "Экстренно укрепить отношения с ключевыми посредниками — дополнительные преференции", type: "defend" },
              { label: "Предупредить партнёров: выбор придётся сделать — Запад или Россия", type: "retaliate" },
              { label: "Диверсифицировать цепочки поставок на альтернативные рынки", type: "accept" },
            ],
          },
          // Военные поставки
          {
            type: "weapons_delivery", weight: mil > 75 ? 3 : 2,
            title: "Западные системы вооружений прибыли на фронт",
            text: "Украина получила партию дальнобойных ракет Storm Shadow и 50 танков Leopard 2A6. Командование ВСУ объявило о создании новой ударной бригады. Российские военные аналитики предупреждают об угрозе глубокого удара.",
            army_moraleDelta: -2, readinessDelta: -3,
            responses: [
              { label: "Нанести превентивный удар по складам техники до ввода её в строй", type: "retaliate" },
              { label: "Усилить эшелонированную оборону на потенциально угрожаемых направлениях", type: "defend" },
              { label: "Принять меры по маскировке и рассредоточению собственных позиций", type: "accept" },
            ],
          },
        ];

        // ВЕРОЛОМСТВО КИЕВА — максимум ДВА раза за партию.
        //   1-е: гамбит Киева. «Один раз обманул — виноват обманщик.» Значительный откат мира.
        //   2-е: только если Киев УВЕРЕН, что не проиграет войну (игрок НЕ доминирует военно).
        //        «Два раза обманул — виноват тот, кто дал себя обмануть.»
        //        Если игрок раздавил фронт — Киеву невыгодно предавать, и он не рискует.
        //   3-го не бывает: после двух предательств мирный трек мёртв — только война.
        const isPeaceMove = pendingActionMode === "diplomacy_op";
        const betrayalCount = newStats.betrayal_count ?? 0;
        const peaceNow0 = newStats.peace_progress ?? 0;
        // Военное доминирование игрока — Киев оценивает, выгодно ли ему предавать
        const playerDominant = (newStats.military ?? 50) >= 80 &&
          (newStats.donetsk_control ?? 0) >= 90 && (newStats.luhansk_control ?? 0) >= 95;

        let willBetray = false;
        if (isPeaceMove && peaceNow0 > 12 && betrayalCount < 2) {
          if (betrayalCount === 0) {
            willBetray = Math.random() < 0.30;            // первый гамбит
          } else if (!playerDominant) {
            willBetray = Math.random() < 0.45;            // второй — только если Киев не загнан в угол
          }
          // если игрок доминирует — Киев не смеет предавать второй раз
        }

        const firstBetrayal = {
          type: "ceasefire_betrayal",
          title: "Киев нарушил перемирие",
          text: "Пока шли переговоры и российские войска отводились на согласованные позиции, ВСУ внезапно перешли в наступление на оголённых участках. Киев публично заявил, что «не связан договорённостями с агрессором». Доверие к переговорному процессу подорвано.",
          khersonDelta: -2, kharkivDelta: -1, zaporizhzhiaDelta: -1,
          army_moraleDelta: -3, peace_progressDelta: -18, stabilityDelta: -2,
          responses: [
            { label: "Жёстко предупредить Киев и его покровителей: ещё одно вероломство — и никакого мира, только война", type: "defend" },
            { label: "Возобновить наступление — переговоры были ошибкой, отвечаем силой", type: "retaliate" },
            { label: "Сохранить выдержку — не дать втянуть себя в новый виток эскалации", type: "accept" },
          ],
        };
        const secondBetrayal = {
          type: "ceasefire_betrayal_final",
          title: "Киев предал во второй раз — мира не будет",
          text: "Несмотря на предупреждения, Киев вновь нарушил перемирие и ударил по согласованным позициям, сочтя, что Москва не доведёт войну до конца. Переговорный трек окончательно мёртв. Теперь вопрос решается только на поле боя.",
          khersonDelta: -2, kharkivDelta: -2, zaporizhzhiaDelta: -1,
          army_moraleDelta: -2, peace_progressDelta: -40, stabilityDelta: -1,
          responses: [
            { label: "Объявить о прекращении переговоров и перейти к решительному наступлению", type: "retaliate" },
            { label: "Мобилизовать резервы и закрыть все территориальные цели силой", type: "retaliate" },
            { label: "Зафиксировать вероломство для истории и продолжить военную операцию", type: "defend" },
          ],
        };

        let uaAction;
        if (willBetray) {
          uaAction = (betrayalCount === 0) ? firstBetrayal : secondBetrayal;
          newStats.betrayal_count = betrayalCount + 1;
          fastify.log.info({ gameId, turnNumber, betrayalNumber: betrayalCount + 1 }, "Ukraine CEASEFIRE BETRAYAL fired");
        } else {
          // Стратегически управляемый выбор: Claude Haiku выбирает стратегию,
          // мультипликаторы весов усиливают нужные действия в этом направлении
          const recentTurnsRes = await client.query(
            `SELECT action_mode, player_input FROM turns WHERE game_id = $1 ORDER BY id DESC LIMIT 4`,
            [gameId]
          );
          const recentMoves = recentTurnsRes.rows.map(r => ({
            mode: r.action_mode || "decree",
            input: (r.player_input || "").slice(0, 80),
          }));
          const uaStrategy = await selectUkraineStrategy(newStats, recentMoves, callClaudeApi);
          fastify.log.info({ gameId, uaStrategy }, "Ukraine strategy selected");
          const mults = UA_STRATEGY_MULTIPLIERS[uaStrategy] || {};
          const weightedActions = UA_ACTIONS.map(a => ({ ...a, weight: a.weight * (mults[a.type] ?? 1) }));
          const totalWeight = weightedActions.reduce((s, a) => s + a.weight, 0);
          let rnd = Math.random() * totalWeight;
          uaAction = weightedActions[0];
          for (const a of weightedActions) {
            rnd -= a.weight;
            if (rnd <= 0) { uaAction = a; break; }
          }
        }

        // Применяем эффекты
        const UA_STAT_MAP = {
          economyDelta: "economy", stabilityDelta: "stability", approvalDelta: "approval",
          diplomacyDelta: "diplomacy", militaryDelta: "military", peace_progressDelta: "peace_progress",
          army_moraleDelta: "army_morale", readinessDelta: "readiness",
          kharkivDelta: "kharkiv_control", khersonDelta: "kherson_control",
          zaporizhzhiaDelta: "zaporizhzhia_control", donetskDelta: "donetsk_control",
          luhanskDelta: "luhansk_control",
        };
        for (const [deltaKey, statKey] of Object.entries(UA_STAT_MAP)) {
          if (typeof uaAction[deltaKey] === "number") {
            newStats[statKey] = Math.max(0, Math.min(100, (newStats[statKey] ?? 50) + uaAction[deltaKey]));
          }
        }

        // Обновляем собственное состояние Украины
        {
          const ruArmy = newStats.military ?? 50;
          const ruDip = newStats.diplomacy ?? 50;
          // Западная поддержка: растёт если Россия дипломатически слабее, падает если сильнее
          const westDelta = ruDip > 65 ? -2 : ruDip < 35 ? 2 : 1;
          newStats.ua_west_support = Math.max(10, Math.min(95, (newStats.ua_west_support ?? 75) + westDelta));
          // Армия ВСУ: давление от военной мощи России
          const armyDelta = ruArmy > 70 ? -2 : ruArmy < 40 ? 1 : 0;
          newStats.ua_army = Math.max(10, Math.min(90, (newStats.ua_army ?? 65) + armyDelta));
          // Боевой дух: зависит от соотношения сил
          const moraleDelta = (newStats.ua_army ?? 65) > ruArmy ? 1 : -1;
          newStats.ua_morale = Math.max(10, Math.min(95, (newStats.ua_morale ?? 65) + moraleDelta));
        }

        // Сохраняем в ленту как ukraine_action с вариантами ответа
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
           VALUES ($1, $2, 'ukraine_action', $3, $4, $5)`,
          [gameId, turnNumber, `Украина · ${uaAction.title}`, uaAction.text,
           JSON.stringify({ type: uaAction.type, responses: uaAction.responses })]
        );
        fastify.log.info({ gameId, uaAction: uaAction.type }, "Ukraine action fired");
      }
      // --- конец действий Украины ---

      // Сохраняем все изменения stats (decay + blowback + crisis + interference + ukraine)
      await client.query(
        `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      // Записываем снапшот для лидерборда (score = среднее ключевых показателей)
      const scoreKeys = ["stability", "economy", "military", "diplomacy", "approval"];
      const scoreVals = scoreKeys.map(k => newStats[k] ?? 50);
      const score = Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length);
      const scoreBreakdown = Object.fromEntries(scoreKeys.map(k => [k, newStats[k] ?? 50]));
      await client.query(
        `INSERT INTO leaderboard_snap (game_id, turn_n, score, score_breakdown)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [gameId, turnNumber, score, JSON.stringify(scoreBreakdown)]
      );

      await client.query("COMMIT");
      await pendingTurnStore.clear(gameId);

      // Применяем события геймастера (если есть) — после основной транзакции
      if (adminEventStore) {
        const adminEvents = await adminEventStore.popAll(gameId);
        for (const ev of adminEvents) {
          try {
            // Применяем stat deltas
            if (ev.statDeltas && Object.keys(ev.statDeltas).length > 0) {
              const statsRes = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
              if (statsRes.rowCount > 0) {
                const currentStats = statsRes.rows[0].stats;
                const patched = { ...currentStats };
                for (const [k, v] of Object.entries(ev.statDeltas)) {
                  if (typeof patched[k] === "number") {
                    patched[k] = Math.min(100, Math.max(0, patched[k] + v));
                  }
                }
                await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(patched), gameId]);
              }
            }
            // Добавляем в ленту (если не secret)
            if (!ev.secret) {
              await db.query(
                `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
                 VALUES ($1, $2, 'reaction', $3, $4, '[]')`,
                [gameId, turnNumber, ev.source || "Внешний источник", ev.text]
              );
            }
          } catch (evErr) {
            fastify.log.error({ evErr }, "Failed to apply admin event");
          }
        }
      }

      // Запускаем обновление мира ПОСЛЕ транзакции — не блокирует ответ игроку.
      // Результат (новый overview + реакции стран) сохраняется в БД асинхронно
      // и будет виден при следующем GET /games/:id (который фронт делает сразу после confirm).
      generateWorldUpdate({
        params: {
          countryName: game.country_name,
          turnNumber,
          actionType: gmClassification.action_type,
          playerInput: gmClassification.narrative,
          narrative: gmClassification.narrative,
          statDeltas,
          relationDeltas,
          currentStats: newStats,
          currentRelations: newRelations,
          prevOverview: game.overview || {},
        },
        callClaudeApi,
      }).then(async (worldUpdate) => {
        const isNuclearAction = gmClassification.action_type === "nuclear_strike";
        // Если worldUpdate упал и это был ядерный удар — пишем минимальные реакции-заглушки
        if (!worldUpdate) {
          if (isNuclearAction) {
            const fallbackReactions = [
              { source: "Совет Безопасности ООН", text: "Экстренное заседание СБ ООН созвано в связи с применением ядерного оружия. Мировое сообщество потрясено.", escalation: 1 },
              { source: "США / НАТО", text: "Президент США: «Это беспрецедентный акт агрессии. Мы рассматриваем все варианты ответа, включая применение ядерного оружия». НАТО переведено в DEFCON 2.", escalation: 3 },
              { source: "Китай", text: "МИД КНР осудил применение ядерного оружия и потребовал немедленного прекращения огня. Китай приводит собственные ядерные силы в повышенную готовность.", escalation: 2 },
              { source: "Мировые рынки", text: "Фондовые биржи рухнули. Нефть взлетела до исторического максимума. Международная торговля парализована.", escalation: 1 },
            ];
            for (const r of fallbackReactions) {
              await db.query(
                `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, 'nuclear_reaction', $3, $4, $5)`,
                [gameId, turnNumber, r.source, r.text, JSON.stringify([{ escalation: r.escalation }])]
              );
            }
          }
          return;
        }
        try {
          // Обновляем overview
          if (worldUpdate.overview) {
            await db.query(
              `UPDATE game_state SET overview = $1, updated_at = now() WHERE game_id = $2`,
              [JSON.stringify({ ...worldUpdate.overview, turn: turnNumber }), gameId]
            );
          }
          // Добавляем реакции стран в ленту
          const rawReactions = (worldUpdate.world_reactions || []).slice(0, 3);
          const isNuclearUpdate = rawReactions.some(r => r.escalation);
          const reactionItemType = isNuclearUpdate ? "nuclear_reaction" : "reaction";
          const sortedReactions = isNuclearUpdate
            ? [...rawReactions].sort((a, b) => (a.escalation || 1) - (b.escalation || 1))
            : rawReactions;
          for (const reaction of sortedReactions) {
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [gameId, turnNumber, reactionItemType, reaction.source, reaction.text,
               reaction.escalation ? JSON.stringify([{ escalation: reaction.escalation }]) : "[]"]
            );
          }
          // Добавляем ходы других стран + применяем stat_delta
          const VALID_STATS = new Set(["economy", "military", "stability", "diplomacy", "approval"]);
          for (const move of worldUpdate.world_moves || []) {
            const statDelta = move.stat_delta && typeof move.stat_delta === "object" ? move.stat_delta : {};
            // Валидируем и клэмпим delta
            const safeDelta = {};
            for (const [k, v] of Object.entries(statDelta)) {
              if (VALID_STATS.has(k) && typeof v === "number") {
                safeDelta[k] = Math.max(-5, Math.min(5, Math.round(v)));
              }
            }
            await db.query(
              `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
               VALUES ($1, $2, 'world_move', $3, $4, $5)`,
              [gameId, turnNumber, move.country, move.action, JSON.stringify([{
                user: "Аналитик", text: move.impact,
                tone: move.direction === "hostile" ? "neg" : move.direction === "cooperative" ? "pos" : "neutral",
                stat_delta: safeDelta,
              }])]
            );
            // Применяем stat_delta к game_state
            if (Object.keys(safeDelta).length > 0) {
              const stateRow = await db.query(`SELECT stats FROM game_state WHERE game_id = $1`, [gameId]);
              if (stateRow.rows[0]) {
                const cur = stateRow.rows[0].stats || {};
                const updated = { ...cur };
                for (const [k, v] of Object.entries(safeDelta)) {
                  updated[k] = Math.max(0, Math.min(100, (cur[k] ?? 50) + v));
                }
                await db.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
                  [JSON.stringify(updated), gameId]);
              }
            }
          }
        } catch (err) {
          fastify.log.error({ err }, "worldUpdate DB write failed");
        }
      }).catch((err) => fastify.log.error({ err }, "worldUpdate failed"));

      // Win/loss/partial outcome detection
      const MAX_TURNS = 24;
      const gameOutcome = detectGameOutcome(newStats, turnNumber, MAX_TURNS);
      if (gameOutcome) {
        await client.query(`UPDATE games SET status = $1, updated_at = now() WHERE id = $2`, [gameOutcome, gameId]);
      }

      // --- CHANGELOG: разбивка изменений по источникам ---
      const statChangelog = {};
      for (const k of CHANGELOG_KEYS) {
        const decreeD = statDeltas[k] ?? 0;
        const totalD = (newStats[k] ?? 50) - (statsAfterDelayed[k] ?? 50);
        const eventsD = totalD - decreeD;
        if (decreeD !== 0 || eventsD !== 0) {
          statChangelog[k] = { decree: decreeD, events: eventsD, total: totalD };
        }
      }

      return reply.send({
        turnNumber,
        narrative: gmClassification.narrative,
        statDeltas,
        relationDeltas,
        newStats,
        newRelations,
        gameOutcome: gameOutcome || null,
        maxTurns: MAX_TURNS,
        // Мульти-режим: месяц продолжается, пока игрок не нажмёт «Завершить месяц»
        turnContinues: multiAction && !gameOutcome,
        initiative: newStats.initiative,
        month: turnNumber,
        statChangelog,
        prevStats: Object.fromEntries(CHANGELOG_KEYS.map(k => [k, statsAfterDelayed[k] ?? 50])),
        // Исход раскрытия тайной операции (covert_*) — известен ТОЛЬКО здесь, после подписи
        // приказа (см. revealCovertOutcome в applyTurn). undefined для остальных категорий —
        // фронт показывает отдельный «реванш»-попап только когда поле присутствует.
        covertExposed: typeof statDeltas.exposed === "boolean" ? statDeltas.exposed : undefined,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Internal error confirming turn" });
    } finally {
      client.release();
    }
  });

  // ---------- CANCEL ----------
  fastify.post("/games/:gameId/turns/cancel", async (request, reply) => {
    const { gameId } = request.params;
    await pendingTurnStore.clear(gameId);
    return reply.send({ cancelled: true });
  });

  // ---------- END MONTH (мульти-режим) ----------
  // Завершает месяц: рефилл инициативы (бюджет нового месяца), пассивный распад
  // мирного трека, сдвиг даты, +1 месяц, проверка исхода. Действия в течение месяца
  // делаются через /turns/confirm (они месяц не продвигают).
  fastify.post("/games/:gameId/turns/end-month", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { INITIATIVE_MAX, MULTI_ACTION_TURNS } = require("../rules/rules-engine");
    if (!MULTI_ACTION_TURNS) return reply.code(400).send({ error: "Мульти-режим выключен" });

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const completedMonth = game.current_turn + 1;
      const crisisMode = !!(game.stats?.crisis_mode || game.overview?.crisis_mode);
      const newStats = { ...game.stats };
      // БАЛАНС: экономика на начало месяца — используется в конце блока, чтобы ограничить
      // суммарную автоматическую эрозию за месяц (ставка ЦБ + военное бремя + инфляция +
      // спираль казны + случайный кризис могли раньше сложиться в −10..−15 за один ход без
      // предупреждения игрока — теперь потолок и явный лог см. ниже, "ECONOMY EROSION CAP").
      const economyAtMonthStart = newStats.economy ?? 50;
      const economyAutoEffects = []; // {label, delta} — каждый автоматический эффект на экономику за этот месяц

      // Рефилл инициативы — бюджет нового месяца.
      // Carryover 40%: неизрасходованная инициатива частично переходит в следующий месяц,
      // позволяя накопить до 130 (бонус за экономию). Стимул не тратить всё до копейки.
      const prevInitiative = typeof game.stats.initiative === "number" ? game.stats.initiative : 0;
      const carryover = Math.round(prevInitiative * 0.4);
      newStats.initiative = Math.min(130, INITIATIVE_MAX + carryover);
      // Сброс флага передышки — новый месяц, можно снова
      delete newStats.skip_used_this_month;
      // Военные флаги: сброс месячных, конвертация cooldown в блок
      delete newStats.military_used_this_month;
      delete newStats.regroup_bonus_attack;
      if (newStats.military_locked_next_month) {
        newStats.military_blocked_this_month = true;
        delete newStats.military_locked_next_month;
      } else {
        delete newStats.military_blocked_this_month;
      }

      // Пассивный распад мирного трека (раз в месяц), если в этом месяце не было дипломатии
      const turnsThisMonth = await client.query(
        `SELECT action_mode, gm_classification FROM turns WHERE game_id = $1 AND turn_n = $2`,
        [gameId, completedMonth]
      );
      const hadDiplomacy = turnsThisMonth.rows.some(r => {
        const at = (typeof r.gm_classification === "string" ? JSON.parse(r.gm_classification) : r.gm_classification)?.action_type;
        return CATEGORY_GROUP.diplomatic_activity.has(at) || r.action_mode === "diplomacy_op";
      });
      if (!hadDiplomacy && (newStats.peace_progress ?? 0) > 5) {
        const p = newStats.peace_progress ?? 0;
        const decay = p >= 40 ? 1 : 4; // установленный мир (>=40) тает медленнее
        newStats.peace_progress = Math.max(0, p - decay);
      }

      // --- НЕФТЬ И ВАЛЮТА: сценарная траектория + помесячный дрейф + рыночные события ---
      // Реальные единицы: $/баррель Brent и ₽/$. Сценарная дуга: ирано-американская
      // эскалация толкает цену ВВЕРХ первые OIL_DEAL_TURN ходов, затем — временная сделка
      // США-Иран (санкции на иранский экспорт частично сняты, нефть возвращается на рынок),
      // после чего цель дрейфа падает к довоенному уровню — как и в реальности, военная
      // надбавка временна.
      //
      // Доход казны считается ОТНОСИТЕЛЬНО ЦЕНЫ ОТСЕЧЕНИЯ БЮДЖЕТА ($65, как в реальном
      // бюджетном правиле РФ) — НЕ относительно текущей "нормальной" цены. Раньше база
      // дохода = текущая цель дрейфа (85), из-за чего партии, стартовавшие до этого фикса
      // с ценой ниже 85 (например, старый сид $68), показывали "убыток" от нефти — хотя
      // реальный доход от продажи нефти всегда положителен при любой цене выше отсечения,
      // просто меньше, чем при пиковых ценах.
      const OIL_BUDGET_CUTOFF = 65;  // цена отсечения бюджета — база для oilIncome, НЕ меняется по ходу игры
      const OIL_DEAL_TURN = 6;       // ход, на котором происходит сделка США-Иран
      const FX_BASELINE = 80;
      const oilDealAlreadyReached = !!newStats.oil_iran_deal_reached;
      const oilReversionTarget = oilDealAlreadyReached ? 68 : 85; // цель дрейфа: военная надбавка / довоенный уровень
      const oilBefore = typeof newStats.oil_price === "number" ? newStats.oil_price : 85;
      const fxBefore = typeof newStats.usd_rub === "number" ? newStats.usd_rub : FX_BASELINE;
      const oilReversion = (oilReversionTarget - oilBefore) * 0.08;
      const fxReversion = (FX_BASELINE - fxBefore) * 0.08;
      let oilNow = Math.max(35, Math.min(120, oilBefore + oilReversion + (Math.random() * 6 - 3))); // возврат к цели + дрейф ±3$
      let fxNow = Math.max(55, Math.min(140, fxBefore + fxReversion + (Math.random() * 4 - 2)));    // возврат к базе + дрейф ±2₽
      let marketEventLine = "";

      // Сценарная дуга: эскалация толкает цену вверх, пока не наступит сделка США-Иран
      if (!oilDealAlreadyReached && completedMonth >= OIL_DEAL_TURN) {
        newStats.oil_iran_deal_reached = true;
        oilNow = Math.max(35, oilNow - 22); // иранская нефть возвращается на рынок — резкое падение
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, completedMonth, "news", "Reuters",
           "США и Иран подписали временное соглашение по ядерной программе — часть санкций на иранский экспорт нефти снята. Иранская нефть возвращается на мировой рынок, цены на Brent резко пошли вниз, снимая военную надбавку последних месяцев.",
           JSON.stringify([{ emoji: "🕊️", label: "разрядка", count: Math.floor(Math.random() * 120) + 40 }])]
        );
        fastify.log.info({ gameId, turn: completedMonth }, "Iran deal reached — oil price shock down");
      } else if (!oilDealAlreadyReached) {
        oilNow = Math.min(120, oilNow + 3 + Math.random() * 2); // эскалация продолжается — цена ползёт вверх
      }

      if (Math.random() < 0.15) {
        const MARKET_EVENTS = [
          { source: "Bloomberg", oilDelta: 14, text: "Эскалация вокруг Ирана: удары по объектам в Персидском заливе подняли страх перебоев поставок. Нефть Brent подскочила на фоне угрозы блокады Ормузского пролива." },
          { source: "Reuters", oilDelta: 8, text: "ОПЕК+ объявила о неожиданном сокращении добычи. Картель ссылается на «стабилизацию рынка» — цены на нефть пошли вверх." },
          { source: "WSJ", oilDelta: -9, text: "Опасения рецессии в Китае и США обвалили прогнозы спроса на нефть. Котировки Brent резко просели." },
          { source: "Financial Times", oilDelta: -7, text: "США объявили о выбросе нефти из стратегического резерва, чтобы сбить цены перед выборами. Рынок отреагировал распродажей." },
          { source: "Коммерсантъ", fxDelta: 7, text: "Новый пакет санкций ударил по экспортным расчётам — рубль ослаб на фоне дефицита валютной ликвидности." },
          { source: "РБК", fxDelta: -6, text: "Сильный экспортный квартал и удержание капитала в стране укрепили рубль." },
          { source: "Forbes", fxDelta: 8, text: "Отток капитала ускорился: крупный бизнес выводит резервы за рубеж на фоне неопределённости. Рубль слабеет." },
          { source: "Al Jazeera", oilDelta: 11, text: "Иран пригрозил закрыть Ормузский пролив в ответ на новые удары США по своей территории. Через пролив идёт пятая часть мировой нефти — рынок в панике." },
          { source: "CNBC", oilDelta: -6, text: "Саудовская Аравия и ОАЭ нарастили добычу сверх квот ОПЕК+, компенсируя выпадающие иранские поставки. Цены на нефть скорректировались вниз." },
          { source: "OilPrice.com", oilDelta: 6, text: "ОПЕК+ продлила соглашение об ограничении добычи ещё на квартал — участники картеля настаивают на защите цен несмотря на рост предложения вне картеля." },
        ];
        const ev = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
        if (ev.oilDelta) oilNow = Math.max(35, Math.min(120, oilNow + ev.oilDelta));
        if (ev.fxDelta) fxNow = Math.max(55, Math.min(140, fxNow + dampenFxShock(ev.fxDelta, newStats)));
        marketEventLine = ev.text;
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, completedMonth, "news", ev.source, ev.text, JSON.stringify([
            { emoji: "🛢️", label: "рынок", count: Math.floor(Math.random() * 90) + 20 },
          ])]
        );
        fastify.log.info({ gameId, source: ev.source }, "Oil/FX market event fired");
      }
      newStats.oil_price = Math.round(oilNow * 10) / 10;
      newStats.usd_rub = Math.round(fxNow * 10) / 10;
      // Слабый рубль номинально УВЕЛИЧИВАЕТ доход казны от долларовой нефти (как в реальном
      // бюджетном правиле РФ), но усиливает инфляцию через импорт. Сильная нефть — доход,
      // но не влияет напрямую на инфляцию.
      // Санкционный дисконт: высокая изоляция снижает эффективную цену нефти (скидка Urals к Brent).
      // isolation 0–50 → нет штрафа; 51–80 → до −30% дохода; 81–100 → до −50%.
      const isolationVal = newStats.isolation ?? 68;
      const rawSanctionDiscount = isolationVal <= 50 ? 0
        : isolationVal <= 80 ? (isolationVal - 50) / 100   // 0..0.30
        : 0.30 + (isolationVal - 80) / 200;               // 0.30..0.40
      // Доверие союзников смягчает санкционный дисконт: параллельная торговля и альтернативные
      // платёжные каналы через дружественные страны (Китай, Беларусь, Иран и т.д.) частично
      // компенсируют изоляцию — до 15 п.п. при максимальном доверии.
      const allyTrustVal = newStats.ally_trust ?? 42;
      const allyMitigation = allyTrustVal > 50 ? Math.min(0.15, (allyTrustVal - 50) / 100) : 0;
      const sanctionDiscount = Math.max(0, rawSanctionDiscount - allyMitigation);
      const oilIncome = Math.round((newStats.oil_price - OIL_BUDGET_CUTOFF) * 0.7 * (1 - sanctionDiscount));
      const fxIncome = Math.round((newStats.usd_rub - FX_BASELINE) * 0.4);
      if (newStats.usd_rub > FX_BASELINE + 10) {
        newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 0.5);
      }

      // --- РЕЗЕРВЫ: помесячный дрейф + излишек нефтедоходов + уязвимость при низком уровне ---
      // Профицит торгового баланса (дорогая нефть + выгодный курс) понемногу пополняет ЗВР,
      // дефицит — расходует. Высокая изоляция размывает резервы (заморозка активов за рубежом,
      // ограничения на расчёты). Резервы ниже 20 означают, что ЦБ нечем защищать рубль —
      // это усиливает инфляцию (см. также демпфер валютных шоков выше).
      // Излишек нефтегазовых доходов сверх порога 15/мес не сгорает бесследно, а частично уходит
      // в резервы — как бюджетное правило Минфина РФ (доходы выше цены отсечения — в ФНБ).
      const tradeBalance = oilIncome + fxIncome;
      const tradeSurplus = Math.max(0, tradeBalance - 15);
      let reservesDelta = (tradeBalance > 5 ? 1 : tradeBalance < -5 ? -1 : 0) + Math.round(tradeSurplus * 0.3);
      if (isolationVal > 75) reservesDelta -= 1;
      newStats.reserves = Math.max(0, Math.min(100, (newStats.reserves ?? 48) + reservesDelta));
      if (newStats.reserves < 20) {
        newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 0.5);
      }

      // --- КАЗНА: месячный доход и расход ---
      const { TREASURY_MIN } = require("../rules/rules-engine");
      const { ofzTotalMonthlyCost } = require("./treasury");
      const activePolicies = (game.policies || []).filter(p => p.status !== "cancelled");
      const rawTaxIncome = activePolicies.reduce((s, p) => s + (Number(p.budget_income) || 0), 0);
      const programUpkeep = activePolicies.reduce((s, p) => s + (Number(p.budget_upkeep) || 0), 0);
      // ОФЗ: обслуживание долга (вычитается из казны каждый месяц). Стоимость 1 выпуска
      // компаундится вместе с ключевой ставкой ЦБ — см. treasury.js/ofzMonthlyCostPerBond.
      const ofzCount = newStats.ofz_count ?? 0;
      const ofzDebtService = ofzTotalMonthlyCost(ofzCount, newStats.key_rate);
      // Налоговый доход: при экономике > 50 — растёт, ниже 50 — падает, ниже 35 — минимум
      const eco = newStats.economy ?? 50;
      const rawEconomyIncome = eco >= 50
        ? Math.round(20 + (eco - 50) * 0.6)  // 50→20, 60→26, 80→38, 100→50
        : eco >= 35
          ? Math.round(eco * 0.4)              // 35→14, 49→19 — почти стагнация
          : Math.round(Math.max(5, eco * 0.2)); // ниже 35 — минимальные поступления
      // БЕЗРАБОТИЦА → НАЛОГОВАЯ БАЗА: занятость (employment) двигает множитель дохода вокруг
      // стартового уровня 74 (сид партии) — так игра не штрафует экономику с 1-го хода из-за
      // абсолютного значения подстаты, только за реальное отклонение от базы.
      const employmentNow = newStats.employment ?? 74;
      const employmentFactor = Math.max(0.6, Math.min(1.3, 1 + (employmentNow - 74) * 0.004));
      const economyIncome = Math.round(rawEconomyIncome * employmentFactor);
      const taxIncome = Math.round(rawTaxIncome * employmentFactor);
      // ЗАНЯТОСТЬ → ИНФЛЯЦИЯ (кривая Филлипса): перегретый рынок труда разгоняет цены через
      // рост зарплат при дефиците рабочих рук; высокая безработица (низкая занятость), наоборот,
      // охлаждает инфляцию за счёт слабого спроса. Компаундинг относительно старта партии (74),
      // как и у gdp_growth — намеренно мягкий (/25), т.к. инфляционных механизмов уже много.
      const employmentInflationEffect = Math.round((employmentNow - 74) / 25);
      if (employmentInflationEffect) {
        newStats.inflation = Math.max(0, Math.min(100, (newStats.inflation ?? 64) + employmentInflationEffect));
      }
      // Коррупционная утечка: часть бюджета разворовывается каждый месяц, пропорционально уровню коррупции.
      // 0-50 коррупции — утечки нет; 50-100 — растёт нелинейно (схемы крупнее при высокой коррупции).
      // Подстата живёт в группе «Одобрение» (коррупция — про элиты), но эффект чисто экономический.
      const corrLevel = newStats.corruption ?? 55;
      const corruptionDrain = corrLevel > 50 ? Math.round(Math.pow((corrLevel - 50) / 50, 1.3) * 12) : 0;
      // СОДЕРЖАНИЕ ОТВОЁВАННЫХ ТЕРРИТОРИЙ: администрирование и восстановление занятых регионов
      // стоит денег каждый месяц — не бесплатный трофей. Считается только сверх стартового
      // контроля (сид партии): то, что было под контролем изначально, ничего не стоит — платится
      // только за реальную экспансию силой.
      const TERRITORY_BASELINE = { donetsk_control: 78, luhansk_control: 96, zaporizhzhia_control: 68, kherson_control: 58, kharkiv_control: 12 };
      const territoryGainPts = Object.entries(TERRITORY_BASELINE).reduce(
        (s, [k, base]) => s + Math.max(0, (newStats[k] ?? base) - base), 0
      );
      const territoryUpkeep = Math.round(territoryGainPts / 15);
      const monthlyNet = economyIncome + taxIncome - programUpkeep - ofzDebtService + oilIncome + fxIncome - corruptionDrain - territoryUpkeep;
      const treasuryBefore = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      let treasuryAfter = Math.max(TREASURY_MIN, treasuryBefore + monthlyNet);
      // ОФЗ инфляционное давление: +0.3 инфляции за каждый активный выпуск в месяц (было +1 —
      // слишком резко для фонового, а не разового эффекта)
      if (ofzCount > 0) {
        newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + ofzCount * 0.3);
      }
      // РОСТ ВВП → ЭКОНОМИКА: gdp_growth — подстата, которая раньше двигалась от действий, но
      // никак не влияла на саму economy. Теперь отклонение от стартового уровня (36 на сиде)
      // понемногу компаундится в economy — устойчивый рост ВВП постепенно поднимает всю
      // экономику, устойчивый спад — подтачивает её, а не просто существует "для галочки".
      const gdpGrowthNow = newStats.gdp_growth ?? 36;
      const gdpEconomyEffect = Math.round((gdpGrowthNow - 36) / 25);
      if (gdpEconomyEffect) {
        newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + gdpEconomyEffect));
        economyAutoEffects.push({ label: "Рост ВВП", delta: gdpEconomyEffect });
      }
      // ПЕРЕГРЕВ ВВП → ИНФЛЯЦИЯ: gdp_growth не откатывается назад (в отличие от нефти/курса) —
      // устойчивый экономический рост реален и должен накапливаться. Но рост выше потенциального
      // объёма производства в реальности не даёт больше товаров — он просто разгоняет спрос без
      // роста предложения (перегрев). Тот же принцип, что и у кривой Филлипса для занятости:
      // выше 60 баллов gdp_growth каждый месяц добавляет немного инфляционного давления —
      // компаундинг в экономику остаётся бесплатным до этого уровня, выше — уже не бесплатен.
      const gdpOverheatEffect = gdpGrowthNow > 60 ? Math.round((gdpGrowthNow - 60) / 20) : 0;
      if (gdpOverheatEffect) {
        newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + gdpOverheatEffect);
      }
      // НАРОДНОЕ НАСТРОЕНИЕ → ОДОБРЕНИЕ: middle_class и lower_class_mood были декоративными
      // подстатами (двигались от действий, ни на что не влияли) — та же ситуация, что была
      // с gdp_growth. Теперь отклонение от стартового уровня (сид: 44 и 41) понемногу
      // компаундится в approval, каждая половина отдельно и мягче, чем ВВП→экономика,
      // потому что тут два источника бьют по одной и той же стате.
      const middleClassNow = newStats.middle_class ?? 44;
      const lowerClassNow = newStats.lower_class_mood ?? 41;
      const moodApprovalEffect = Math.round((middleClassNow - 44) / 30) + Math.round((lowerClassNow - 41) / 30);
      if (moodApprovalEffect) {
        newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + moodApprovalEffect));
      }
      // Сбрасываем флаг выпуска ОФЗ за месяц
      delete newStats.ofz_used_this_month;
      // Сбрасываем флаг давления на ЦБ
      delete newStats.cb_pressure_used;
      // Сбрасываем флаг антикоррупционной кампании
      delete newStats.anticorruption_used;
      // Сбрасываем флаг конвертации резервов
      delete newStats.reserves_converted_this_month;

      // --- КЛЮЧЕВАЯ СТАВКА ЦБ (автономная логика) ---
      // ЦБ медленно тянет ставку к целевому значению, зависящему от инфляции.
      // Глава ЦБ ("soft"/"hawkish") смещает цель и скорость реакции.
      {
        const cbHead = newStats.cb_head_type ?? "neutral";
        const inflForRate = newStats.inflation ?? 64;
        // Целевая ставка: жёсткая реакция на инфляцию
        const baseTarget = inflForRate > 70 ? 21 : inflForRate > 60 ? 18 : inflForRate < 50 ? 13 : 16;
        const cbTarget = cbHead === "soft" ? baseTarget - 3 : cbHead === "hawkish" ? baseTarget + 2 : baseTarget;
        const clampedTarget = Math.max(5, Math.min(25, cbTarget));
        const currentRate = newStats.key_rate ?? 18.5;
        // Скорость реакции: 15% разрыва в месяц (медленно, как реальный ЦБ)
        const rateSpeed = cbHead === "hawkish" ? 0.20 : cbHead === "soft" ? 0.10 : 0.15;
        const newRate = currentRate + (clampedTarget - currentRate) * rateSpeed;
        newStats.key_rate = Math.round(newRate * 2) / 2; // шаг 0.5%

        // Эффект ставки на инфляцию и экономику
        if (newStats.key_rate > 17) {
          newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 1); // высокая ставка сдерживает инфляцию
          newStats.economy = Math.max(0, (newStats.economy ?? 50) - 1);     // но душит кредитование
          economyAutoEffects.push({ label: "Ставка ЦБ (высокая)", delta: -1 });
        } else if (newStats.key_rate < 11) {
          newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 1); // низкая разгоняет инфляцию
          newStats.economy = Math.min(100, (newStats.economy ?? 50) + 1);     // стимулирует рост
          economyAutoEffects.push({ label: "Ставка ЦБ (низкая)", delta: 1 });
        }
        // Мягкий глава дополнительно давит ставку вниз: инфляционный риск
        if (cbHead === "soft" && newStats.key_rate > 10) {
          newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 1);
        }
      }

      // --- ОБОРОНЗАКАЗ (ВПК) ---
      // Раньше армия только СТОИЛА экономике (бремя выше 80) — реального "пушки кормят завод"
      // канала не было, хотя военные расходы на практике двигают промышленность. Умеренная
      // армия (50-80) даёт небольшой плюс к экономике через оборонный заказ; выше 80 — это уже
      // не стимул, а бремя (см. блок ниже) — ровно тот же принцип "гвозди vs масло".
      {
        const milForDefense = newStats.military ?? 50;
        if (milForDefense >= 50 && milForDefense <= 80) {
          const defenseBoost = Math.floor((milForDefense - 50) / 15); // 50→0, 65→1, 80→2
          if (defenseBoost > 0) {
            newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + defenseBoost));
            economyAutoEffects.push({ label: "Оборонзаказ (ВПК)", delta: defenseBoost });
          }
        }
      }

      // --- ВОЕННОЕ БРЕМЯ (раз в месяц, не на каждый confirm) ---
      // Объединяет два смежных по смыслу механизма: цена армии (по размеру, military > 80)
      // и усталость общества от затянувшейся войны (по длительности непрерывных военных
      // ходов, military_streak). Оба — про одну и ту же вещь: война стоит денег и поддержки,
      // раньше это были два несвязанных блока с раздельными новостями.
      {
        const milNow = newStats.military ?? 50;
        const warStreak = newStats.military_streak ?? 0;
        let burdenEconomy = 0, burdenApproval = 0, burdenStability = 0;
        const burdenParts = [];

        if (milNow > 80) {
          const sizeTax = Math.floor((milNow - 80) / 10) + 1; // 1-3 pts
          burdenEconomy += sizeTax;
          burdenApproval += 1;
          burdenParts.push(`содержание армии (${milNow} > 80): экономика −${sizeTax}, рейтинг −1`);
        }
        if (warStreak >= 4) {
          const wearinessHit = Math.min(5, Math.floor((warStreak - 3) * 1.5)); // 1-5 pts
          burdenApproval += wearinessHit;
          burdenStability += Math.ceil(wearinessHit / 2);
          burdenParts.push(`${warStreak}-й месяц непрерывной войны: рейтинг −${wearinessHit}, стабильность −${Math.ceil(wearinessHit / 2)}`);
        }

        if (burdenEconomy || burdenApproval || burdenStability) {
          if (burdenEconomy) {
            newStats.economy = Math.max(0, (newStats.economy ?? 50) - burdenEconomy);
            economyAutoEffects.push({ label: "Военное бремя", delta: -burdenEconomy });
          }
          if (burdenApproval) newStats.approval = Math.max(0, (newStats.approval ?? 50) - burdenApproval);
          if (burdenStability) newStats.stability = Math.max(0, (newStats.stability ?? 50) - burdenStability);
          await client.query(
            `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
            [gameId, completedMonth, "ВЦИОМ", `Военное бремя. ${burdenParts.join("; ")}.`]
          );
          fastify.log.info({ gameId, burdenEconomy, burdenApproval, burdenStability }, "War burden fired (end-month)");
        }
      }

      // --- ВНУТРЕННИЕ КРИЗИСЫ (раз в месяц, не на каждый confirm) ---
      if (Math.random() < 0.07) {
        const DOMESTIC_CRISES = [
          { source: "Ведомости", approvalDelta: -6, economyDelta: -4,
            text: "Крупнейшая утечка капитала за последние годы: олигархи вывели за рубеж $40 млрд за месяц. Центробанк вынужден экстренно поднять ставку, что ударило по малому бизнесу." },
          { source: "Новая газета", stabilityDelta: -5, approvalDelta: -5,
            text: "В 15 регионах прошли антивоенные акции. Задержаны более 3000 человек. Социологи фиксируют рекордный рост недовольства среди молодёжи и женщин — тех, кто теряет мужей и сыновей." },
          { source: "РИА Новости", economyDelta: -7, stabilityDelta: -3,
            text: "Крупный банковский кризис: четыре региональных банка обратились за экстренной ликвидностью. ЦБ объявил о введении временной администрации. Вкладчики выстроились в очереди." },
          { source: "Интерфакс", approvalDelta: -5, stabilityDelta: -4,
            text: "Антикоррупционный скандал: в Telegram-каналах опубликованы данные о роскошной жизни окружения президента. Яхты, виллы, тайные счета. Рейтинг падает на фоне военных расходов." },
          { source: "ТАСС", economyDelta: -5, approvalDelta: -4,
            text: "Дефицит базовых товаров в ряде регионов: сахар, масло, лекарства исчезли с полок. Губернаторы просят федеральный центр о помощи. Граждане начали делать запасы." },
          { source: "Фонтанка", stabilityDelta: -6, approvalDelta: -3,
            text: "Семьи погибших военнослужащих провели демонстрацию у здания Министерства обороны. Требования о выплате компенсаций и возврате тел не выполняются уже полгода. Силовики разгоняют акцию." },
          { source: "Медиазона", stabilityDelta: -5, economyDelta: -3,
            text: "Бунт в нескольких исправительных колониях: заключённые отказываются подписывать контракты для отправки на фронт. Информация подтверждается перехватами ФСБ." },
          { source: "The Bell", economyDelta: -6, approvalDelta: -4,
            text: "Инфляция вышла из-под контроля — официально 24%, реально, по независимым оценкам, все 40%. Пенсии и зарплаты бюджетников обесценились. Недовольство растёт в базовом электорате." },
        ];
        const crisis = DOMESTIC_CRISES[Math.floor(Math.random() * DOMESTIC_CRISES.length)];
        // СМЯГЧЕНИЕ СТАБИЛЬНОСТЬЮ: устойчивое общество лучше переносит шоки — при стабильности
        // выше 60 часть удара гасится (до 50% при стабильности 100), тот же принцип, что и
        // доверие союзников для санкций. Раньше кризис бил одинаково независимо от того, как
        // играл президент — хотя fix-текст в интерфейсе уже обещал этот "амортизатор".
        const stabForMitigation = newStats.stability ?? 50;
        const crisisMitigation = stabForMitigation > 60 ? Math.min(0.5, (stabForMitigation - 60) / 80) : 0;
        const mitigate = (d) => (d == null ? d : Math.round(d * (1 - crisisMitigation)));
        const approvalDelta = mitigate(crisis.approvalDelta);
        const economyDelta = mitigate(crisis.economyDelta);
        const stabilityDelta = mitigate(crisis.stabilityDelta);
        if (approvalDelta) newStats.approval = Math.max(0, Math.min(100, (newStats.approval ?? 50) + approvalDelta));
        if (economyDelta) {
          newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + economyDelta));
          economyAutoEffects.push({ label: `Кризис (${crisis.source})`, delta: economyDelta });
        }
        if (stabilityDelta) newStats.stability = Math.max(0, Math.min(100, (newStats.stability ?? 50) + stabilityDelta));
        applyOilFxTextImpact(crisis.text, newStats);
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, completedMonth, "news", crisis.source, crisis.text, JSON.stringify([
            { emoji: "😰", label: "тревога", count: Math.floor(Math.random() * 80) + 30 },
          ])]
        );
        if (crisisMitigation >= 0.2) {
          await client.query(
            `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
            [gameId, completedMonth, "news", "ВЦИОМ",
             `Высокая устойчивость общества (стабильность ${Math.round(stabForMitigation)}) смягчила последствия кризиса — потери оказались заметно меньше, чем могли бы быть. Крепкий тыл окупается.`,
             JSON.stringify([{ emoji: "💪", label: "устойчивость", count: Math.floor(Math.random() * 90) + 40 }])]
          );
        }
        fastify.log.info({ gameId, source: crisis.source, crisisMitigation }, "Domestic crisis fired (end-month)");
      }

      // --- МЯТЕЖ ЭЛИТ (раз в месяц, не на каждый confirm) ---
      // Пригожинский сценарий: если elite_satisfaction проседает надолго, часть силового
      // блока/ЧВК может выступить против центра. Это НЕ поражение само по себе — тревожный
      // звоночек с реальным ударом по статам. Подавление не гарантированно быстрое: второй
      // бросок решает, обошлось малой кровью или переросло в тяжёлый внутренний кризис.
      const eliteSatNow = newStats.elite_satisfaction ?? 62;
      if (eliteSatNow < 35 && Math.random() < 0.15) {
        const escalates = Math.random() < 0.55; // не так просто подавить — почти монетка не в пользу игрока
        if (escalates) {
          newStats.stability = Math.max(0, (newStats.stability ?? 50) - 9);
          newStats.approval = Math.max(0, (newStats.approval ?? 50) - 4);
          newStats.military = Math.max(0, (newStats.military ?? 50) - 3);
          newStats.army_morale = Math.max(0, (newStats.army_morale ?? 62) - 5);
        } else {
          newStats.stability = Math.max(0, (newStats.stability ?? 50) - 4);
          newStats.army_morale = Math.max(0, (newStats.army_morale ?? 62) - 2);
        }
        // Мятежная фракция устранена/куплена — оставшиеся элиты консолидируются вокруг центра
        newStats.elite_satisfaction = Math.min(100, Math.max(0, eliteSatNow - (escalates ? 12 : 8) + 8));
        const mutinyText = escalates
          ? "Марш на столицу: колонна силовых формирований, недовольных курсом Кремля, двинулась к центру. Несколько часов страна была на грани — переговоры и переброска верных частей остановили колонну в последний момент. Часть военного руководства отправлена в отставку, но осадок в армии и обществе останется надолго."
          : "Попытка мятежа в одном из силовых формирований подавлена в течение суток — командиры не поддержали выступление, зачинщики задержаны. Инцидент замяли, но слухи о расколе элит уже разошлись по Telegram-каналам.";
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1, $2, $3, $4, $5, $6)`,
          [gameId, completedMonth, "news", "Медуза", mutinyText, JSON.stringify([
            { emoji: "😱", label: "шок", count: Math.floor(Math.random() * 150) + 80 },
          ])]
        );
        fastify.log.info({ gameId, escalates }, "Elite mutiny fired (end-month)");
      }

      // ИНФЛЯЦИОННЫЙ ШОК: высокая инфляция (>70) давит на экономику и одобрение каждый месяц.
      // Каждые 10 пунктов сверх 70 = -1 к экономике и одобрению. Максимум: -3 при инфляции 100.
      const inflationNow = newStats.inflation ?? 64;
      let inflationEconomyPenalty = 0;
      let inflationApprovalPenalty = 0;
      if (inflationNow > 73) {
        inflationEconomyPenalty = Math.min(3, Math.floor((inflationNow - 73) / 10) + 1);
        inflationApprovalPenalty = Math.min(2, Math.floor((inflationNow - 73) / 15) + 1);
        newStats.economy = Math.max(0, (newStats.economy ?? 50) - inflationEconomyPenalty);
        newStats.approval = Math.max(0, (newStats.approval ?? 50) - inflationApprovalPenalty);
        economyAutoEffects.push({ label: "Инфляционный шок", delta: -inflationEconomyPenalty });
      }
      // СПИРАЛЬ КАЗНА → ЭКОНОМИКА (двусторонняя связь; обратная сторона — доход казны зависит от экономики)
      let deficitHit = false;
      let economyEffect = 0; // эффект на экономику от состояния казны
      if (treasuryAfter < 0) {
        // Дефицит — жёстко: вынужденные займы, инфляция, спад
        deficitHit = true;
        newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 2);
        newStats.stability = Math.max(0, (newStats.stability ?? 50) - 1);
        economyEffect = -2;
      } else if (treasuryAfter < 15) {
        // Низкая казна — вынужденная аустерити, экономика проседает
        economyEffect = -1;
      } else if (treasuryAfter > 65 && (newStats.economy ?? 50) < 82) {
        // Здоровый профицит — есть на инвестиции, экономика восстанавливается
        economyEffect = +1;
      }
      if (economyEffect) {
        newStats.economy = Math.max(0, Math.min(100, (newStats.economy ?? 50) + economyEffect));
        economyAutoEffects.push({ label: deficitHit ? "Дефицит казны" : economyEffect < 0 ? "Низкая казна" : "Профицит казны", delta: economyEffect });
      }
      // Казна ограничена 100 сверху: профицит выше 100 не накапливается
      newStats.treasury = Math.min(100, treasuryAfter);

      // --- АВТОНОМНЫЕ СОБЫТИЯ (мир живёт без тебя) ---
      // Перенесено сюда (было в самом конце обработчика, после потолка эрозии и проверки
      // победы/поражения) — санкционная ветка этого пула может бить по экономике до −3, но
      // раньше это происходило ПОСЛЕ того, как потолок эрозии и Организационный рост уже
      // посчитаны, и ПОСЛЕ проверки победы/поражения. Из-за этого эффект был невидим в разбивке
      // "Итоги месяца" и не учитывался ни потолком, ни условием "не было кризисов" у
      // Организационного роста, а обвал экономики этим каналом ниже порога поражения
      // засчитывался только на СЛЕДУЮЩИЙ месяц. Теперь событие резолвится раньше и его эффект
      // на экономику полноценно учтён везде, где учитываются остальные автоэффекты.
      const autonomousEvents = generateAutonomousEvents(newStats, completedMonth, gameId);
      for (const ev of autonomousEvents) {
        const economyDeltaFromEvent = ev.statDelta?.economy;
        for (const [k, d] of Object.entries(ev.statDelta || {})) {
          newStats[k] = Math.max(0, Math.min(100, (newStats[k] ?? 50) + d));
        }
        if (economyDeltaFromEvent) {
          economyAutoEffects.push({ label: `Мир живёт без вас (${ev.source})`, delta: economyDeltaFromEvent });
        }
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'world_reaction',$3,$4,'[]')`,
          [gameId, completedMonth, ev.source, ev.text]
        );
      }

      // --- ДИПЛОМАТИЧЕСКИЙ РАСПАД ПРИ ИЗОЛЯЦИИ ---
      // Если дипломатия ниже 25 и нет дипломатических ходов этот месяц — ещё −1 экономике.
      // Перенесено сюда по той же причине, что и автономные события выше — раньше срабатывало
      // уже после потолка эрозии и проверки победы/поражения, теперь учтено везде.
      {
        const hadDiplomacyMove = turnsThisMonth.rows.some(r => r.action_mode === "diplomacy_op");
        const dip = newStats.diplomacy ?? 50;
        if (!hadDiplomacyMove && dip < 25) {
          newStats.diplomacy = Math.max(0, dip - 2);
          newStats.economy = Math.max(0, (newStats.economy ?? 50) - 1);
          economyAutoEffects.push({ label: "Дипломатическая изоляция", delta: -1 });
        }
      }

      // --- МИРНЫЙ ДИВИДЕНД ---
      // Раньше «всё зелёное» не гарантировало НИКАКОГО пассивного роста экономики — только
      // казна>65, сильное отклонение ВВП (эффект режется /25) или низкая ставка ЦБ. Штрафы же
      // (ставка, военное бремя, инфляция, дефицит) срабатывают гораздо охотнее и без такого
      // смягчения. Игрок мог месяцами держать все статы здоровыми и не видеть роста экономики.
      // Добавляем скромный органический плюс: если и экономика, и стабильность, и дипломатия,
      // и рейтинг здоровы — И в этом месяце не сработал НИ ОДИН автоматический минус (ставка,
      // военное бремя, инфляция, дефицит, случайный кризис) — устойчивое правление даёт отдачу.
      {
        const noAutoCrisis = economyAutoEffects.every(e => e.delta >= 0);
        const coreEco = newStats.economy ?? 50;
        const coreStab = newStats.stability ?? 50;
        const coreDip = newStats.diplomacy ?? 50;
        const coreAppr = newStats.approval ?? 50;
        const allHealthy = coreEco >= 55 && coreStab >= 55 && coreDip >= 55 && coreAppr >= 55;
        const allStrong = coreEco >= 70 && coreStab >= 70 && coreDip >= 70 && coreAppr >= 70;
        if (noAutoCrisis && allHealthy) {
          const dividend = allStrong ? 2 : 1;
          newStats.economy = Math.min(100, coreEco + dividend);
          economyAutoEffects.push({ label: "Организационный рост", delta: dividend });
        }
      }

      // --- ПОТОЛОК МЕСЯЧНОЙ ЭРОЗИИ ЭКОНОМИКИ ---
      // Раньше несколько автоэффектов (ставка ЦБ, военное бремя, инфляция, спираль казны,
      // случайный кризис) могли сложиться в −10..−15 экономики за ОДИН месяц без верхнего
      // предела и без предупреждения игрока в момент подписи хода — партии срывались в
      // defeat_collapse внезапно. Теперь суммарное падение от автоэффектов капается, а разница
      // логируется прозрачно в бюджетной сводке ниже, чтобы ожидание игрока (по прогнозу при
      // подписи хода) совпадало с фактом.
      const EROSION_CAP = 6;
      const autoErosion = economyAutoEffects.reduce((sum, e) => sum + Math.min(0, e.delta), 0);
      let erosionCapped = false;
      if (autoErosion < -EROSION_CAP) {
        const giveBack = -EROSION_CAP - autoErosion; // положительное число
        newStats.economy = Math.min(100, (newStats.economy ?? 50) + giveBack);
        erosionCapped = true;
      }

      // --- ИСТЕЧЕНИЕ СРОКА ПОЛИТИК ---
      // Политики с target_turn <= completedMonth удаляются (реформа отработала срок).
      const activePoliciesRaw = game.policies || [];
      const expiredPolicies = activePoliciesRaw.filter(p => p.status !== "cancelled" && p.target_turn != null && p.target_turn <= completedMonth);
      const survivingPolicies = activePoliciesRaw.filter(p => p.status === "cancelled" || p.target_turn == null || p.target_turn > completedMonth);
      if (expiredPolicies.length > 0) {
        await client.query(
          `UPDATE game_state SET policies = $1 WHERE game_id = $2`,
          [JSON.stringify(survivingPolicies), gameId]
        );
        for (const p of expiredPolicies) {
          await client.query(
            `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
            [gameId, completedMonth, "Правительство", `Завершён срок действия программы «${p.title || p.type}». Эффекты политики исчерпаны.`]
          );
        }
      }

      // --- ПАССИВНЫЙ РОСТ КОРРУПЦИИ ---
      // Без антикоррупционных мер коррупция растёт на 1-2 пт/мес.
      // Антикоррупционные действия (anti_corruption, institutional_reform) сбрасывают
      // флаг newStats.anti_corruption_this_month, который выставляется в rules-engine.
      {
        const hadAntiCorruption = !!newStats.anti_corruption_this_month;
        delete newStats.anti_corruption_this_month; // сбрасываем флаг для следующего месяца
        if (!hadAntiCorruption) {
          const corr = newStats.corruption ?? 55;
          if (corr < 90) {
            const growth = corr < 40 ? 2 : 1; // быстрее растёт пока низкая
            newStats.corruption = Math.min(100, corr + growth);
          }
        }
      }

      // Сдвиг даты + продвижение месяца
      const currentGameDate = game.overview?.date;
      const newGameDate = currentGameDate ? advanceGameDate(currentGameDate, crisisMode) : null;
      let updatedOverview = game.overview || {};
      if (newGameDate) updatedOverview = { ...updatedOverview, date: newGameDate };

      const MAX_TURNS = 24;
      const gameOutcome = detectGameOutcome(newStats, completedMonth, MAX_TURNS);

      await client.query(
        `UPDATE game_state SET stats = $1, overview = $2, updated_at = now() WHERE game_id = $3`,
        [JSON.stringify(newStats), JSON.stringify(updatedOverview), gameId]
      );
      await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [completedMonth, gameId]);
      if (gameOutcome) {
        await client.query(`UPDATE games SET status = $1 WHERE id = $2`, [gameOutcome, gameId]);
      }
      // Снимок для лидерборда — раз в месяц
      const scoreKeys = ["stability", "economy", "military", "diplomacy", "approval"];
      const score = Math.round(scoreKeys.map(k => newStats[k] ?? 50).reduce((a, b) => a + b, 0) / scoreKeys.length);
      await client.query(
        `INSERT INTO leaderboard_snap (game_id, turn_n, score, score_breakdown) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [gameId, completedMonth, score, JSON.stringify(Object.fromEntries(scoreKeys.map(k => [k, newStats[k] ?? 50])))]
      );
      // Бюджетная сводка в ленту
      const T = 0.8; // ₽ трлн за пункт казны
      const flowSign = monthlyNet >= 0 ? "+" : "";
      const ofzLine = ofzCount > 0 ? `, обслуживание ОФЗ −${ofzDebtService}` : "";
      const oilFxLine = (oilIncome !== 0 || fxIncome !== 0)
        ? `, нефть/валюта ${oilIncome + fxIncome >= 0 ? "+" : ""}${oilIncome + fxIncome} (нефть $${newStats.oil_price}/барр., курс ₽${newStats.usd_rub}/$)`
        : "";
      const corruptionLine = corruptionDrain > 0 ? `, коррупционные потери −${corruptionDrain}` : "";
      const territoryUpkeepLine = territoryUpkeep > 0 ? `, содержание отвоёванных территорий −${territoryUpkeep}` : "";
      const inflationLine = inflationEconomyPenalty > 0
        ? ` Инфляционный шок (${inflationPercent(inflationNow).toFixed(1)}% г/г): экономика −${inflationEconomyPenalty}, одобрение −${inflationApprovalPenalty}.`
        : "";
      const allyMitigationLine = (allyMitigation > 0 && rawSanctionDiscount > 0)
        ? ` Доверие союзников смягчило санкционный дисконт на ${Math.round(allyMitigation * 100)} п.п. (параллельная торговля через дружественные страны).`
        : "";
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, completedMonth, "Минфин",
         `Бюджет за месяц: доходы +${economyIncome + taxIncome} (экономика +${economyIncome}, налоги +${taxIncome}), содержание программ −${programUpkeep}${ofzLine}${oilFxLine}${corruptionLine}${territoryUpkeepLine}. Итог: ${flowSign}${monthlyNet} → казна ${(newStats.treasury * T).toFixed(1)} трлн ₽.` +
         (deficitHit ? " ДЕФИЦИТ: займы разгоняют инфляцию, экономика и стабильность падают." :
          economyEffect < 0 ? " Низкая казна вынуждает урезать расходы — экономика проседает." :
          economyEffect > 0 ? " Профицит позволяет инвестировать — экономика крепнет." : "") +
         inflationLine + allyMitigationLine]
      );

      // ПРОЗРАЧНАЯ СВОДКА: игрок видел прогноз при подписи хода, но реальный итог месяца
      // складывается из НЕСКОЛЬКИХ автоэффектов, о которых он не знал заранее (ставка ЦБ,
      // военное бремя, инфляция, спираль казны, случайный кризис). Показываем их одним
      // списком, чтобы ожидание совпадало с фактом — плюс явно говорим, если сработал потолок.
      if (economyAutoEffects.length > 0) {
        const lines = economyAutoEffects.map(e => `${e.label}: ${e.delta >= 0 ? "+" : ""}${e.delta}`);
        const netChange = (newStats.economy ?? 50) - economyAtMonthStart;
        const capNote = erosionCapped
          ? ` Автоматические потери месяца превысили потолок в −${EROSION_CAP} — часть эффекта компенсирована, чтобы не рушить экономику за один ход.`
          : "";
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
          [gameId, completedMonth, "Минэкономразвития",
           `Итоги месяца · экономика: ${economyAtMonthStart} → ${newStats.economy} (${netChange >= 0 ? "+" : ""}${netChange}). Из чего сложилось: ${lines.join("; ")}.${capNote}`]
        );
      }

      // --- ФИНАЛЬНАЯ ГЛАВА: эскалация на ходах 17–23 ---
      const finalEvents = generateFinalChapterEvent(newStats, completedMonth);
      for (const ev of finalEvents) {
        for (const [k, d] of Object.entries(ev.statDelta || {})) {
          newStats[k] = Math.max(0, Math.min(100, (newStats[k] ?? 50) + d));
        }
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'world_move',$3,$4,$5)`,
          [gameId, completedMonth, ev.source, ev.text, JSON.stringify(ev.reactions || [])]
        );
      }
      if (finalEvents.some(e => Object.keys(e.statDelta || {}).length > 0)) {
        await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);
      }

      await client.query("COMMIT");
      await pendingTurnStore.clear(gameId);

      return reply.send({
        month: completedMonth,
        nextMonth: completedMonth + 1,
        date: newGameDate,
        initiative: newStats.initiative,
        gameOutcome: gameOutcome || null,
        maxTurns: MAX_TURNS,
        budget: { economyIncome, taxIncome, programUpkeep, ofzDebtService, oilIncome, fxIncome, corruptionDrain, net: monthlyNet, treasury: newStats.treasury, deficit: deficitHit, economyEffect, inflationPenalty: inflationEconomyPenalty, inflation: Math.round(inflationNow), oilPrice: newStats.oil_price, usdRub: newStats.usd_rub },
        // Прозрачная разбивка ВСЕХ автоматических эффектов на экономику за месяц (см. "ПОТОЛОК
        // МЕСЯЧНОЙ ЭРОЗИИ ЭКОНОМИКИ" выше) — фронт может показать это как единый список вместо
        // текста в ленте, чтобы игрок видел причину каждого пункта изменения.
        economySummary: {
          before: economyAtMonthStart,
          after: newStats.economy,
          effects: economyAutoEffects,
          capped: erosionCapped,
          cap: EROSION_CAP,
        },
        autonomousEvents: autonomousEvents.map(e => ({ source: e.source, text: e.text })),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "End-month failed" });
    } finally {
      client.release();
    }
  });

  // ---------- SKIP (пропустить ход) ----------
  // Быстрый ход без ИИ: null_action + бонусная регенерация инициативы
  fastify.post("/games/:gameId/turns/skip", async (request, reply) => {
    const { gameId } = request.params;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const turnNumber = game.current_turn + 1;
      const currentStats = game.stats || {};
      const { INITIATIVE_MAX } = require("../rules/rules-engine");

      // Лимит: передышка доступна только 1 раз за месяц
      if (currentStats.skip_used_this_month) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Гражданская передышка уже использована в этом месяце — завершите месяц чтобы использовать снова." });
      }

      // ГРАЖДАНСКАЯ ПЕРЕДЫШКА: президент сосредоточился на тыле.
      // Восстанавливает экономику/рейтинг/стабильность (и связанные субметрики),
      // НЕ даёт боевых бонусов (это работа перегруппировки) и оставляет фронт без внимания.
      const clamp = (v) => Math.max(0, Math.min(100, v));
      const newStats = { ...currentStats };
      const statDeltas = {};
      const homeRecovery = {
        economy: 3, approval: 3, stability: 3,
        lower_class_mood: 3, reserves: 2, employment: 1, social_tension: -2,
        inflation: -1,
      };
      for (const [k, d] of Object.entries(homeRecovery)) {
        const before = newStats[k] ?? 50;
        newStats[k] = clamp(before + d);
        statDeltas[k] = newStats[k] - before;
      }

      // Передышка восстанавливает инициативу умеренно (меньше перегруппировки: +40).
      // Cap 130 (не 100) — чтобы carryover-бонус не сгорал при вызове передышки.
      const currentInit = typeof currentStats.initiative === "number" ? currentStats.initiative : INITIATIVE_MAX;
      newStats.initiative = Math.min(130, currentInit + 40);
      statDeltas.initiative = newStats.initiative - currentInit;

      // Пока Россия отдыхает — Украина тоже восстанавливается (реальный трейдофф)
      const uaRecovery = { ua_morale: 4, ua_army: 3, ua_west_support: 1 };
      for (const [k, d] of Object.entries(uaRecovery)) {
        newStats[k] = Math.min(100, (newStats[k] ?? 50) + d);
      }

      // Фронт без внимания — лёгкий откат (мягче прежнего пропуска)
      for (const key of ["kharkiv_control", "kherson_control"]) {
        const cur = newStats[key] ?? 0;
        if (cur > 0) { newStats[key] = Math.max(0, cur - 1); statDeltas[key] = newStats[key] - cur; }
      }
      // Не дипломатия — мирный трек слегка проседает
      const peaceBefore = newStats.peace_progress ?? 0;
      newStats.peace_progress = Math.max(0, peaceBefore - 2);
      statDeltas.peace_progress = newStats.peace_progress - peaceBefore;

      // Помечаем что передышка использована в этом месяце
      newStats.skip_used_this_month = true;

      const narrative = "Гражданская передышка. Президент сосредоточился на внутренних делах — экономика, доходы населения и общественные настроения восстанавливаются. Фронт без активного давления: ВСУ используют паузу для восстановления боевого духа и пополнения личного состава.";

      await client.query(
        `INSERT INTO turns (game_id, turn_n, player_input, action_mode, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection, stats_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [gameId, turnNumber, "[Гражданская передышка]", "skip",
          JSON.stringify({ action_type: "civilian_breather", severity: 1 }),
          JSON.stringify(statDeltas),
          "[]", narrative, null, JSON.stringify(newStats)]
      );
      await client.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);
      // В мульти-режиме передышка — действие внутри месяца, месяц не продвигает.
      if (!require("../rules/rules-engine").MULTI_ACTION_TURNS) {
        await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);
      }
      await client.query("COMMIT");

      return reply.send({
        turnNumber,
        narrative,
        statDeltas,
        skipped: true,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Skip failed" });
    } finally {
      client.release();
    }
  });
  // ---------- REGROUP (перегруппировка) ----------
  // Восстанавливает 50 инициативы, даёт армии передышку, минимальные штрафы
  fastify.post("/games/:gameId/turns/regroup", async (request, reply) => {
    const { gameId } = request.params;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const turnNumber = game.current_turn + 1;
      const currentStats = game.stats || {};
      const { INITIATIVE_MAX, INITIATIVE_REGROUP_REGEN, applyTurn } = require("../rules/rules-engine");

      // Применяем military_regroup через rules-engine — мягкие позитивные эффекты для армии
      const { newStats, statDeltas } = applyTurn({
        state: { stats: currentStats, relations: game.relations || [] },
        gmClassification: { action_type: "military_regroup", severity: 2, affected_relations: [] },
        gameId,
        turnNumber,
        actionMode: "regroup",
      });

      // Перегруппировка: пассивная регенерация + бонус REGROUP_REGEN, без стоимости.
      // Cap 130 (не 100) — carryover-бонус не сгорает при перегруппировке.
      const currentInit = typeof currentStats.initiative === "number" ? currentStats.initiative : INITIATIVE_MAX;
      const passiveRegen = 25;
      newStats.initiative = Math.min(130, currentInit + passiveRegen + INITIATIVE_REGROUP_REGEN);
      statDeltas.initiative = newStats.initiative - currentInit;

      // Перегруппировка открывает второй военный удар в этом месяце (ценой блока следующего)
      newStats.regroup_bonus_attack = true;

      const narrative = "Войска перегруппированы и готовы к броску. Снабжение подтянуто, резервы переброшены на ключевые участки. В этом месяце доступен второй военный удар — но следующий месяц армия будет восстанавливаться без активных операций.";

      await client.query(
        `INSERT INTO turns (game_id, turn_n, player_input, action_mode, gm_classification, stat_deltas, relation_deltas, narrative_text, advisor_objection, stats_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [gameId, turnNumber, "[Перегруппировка]", "regroup",
          JSON.stringify({ action_type: "military_regroup", severity: 2 }),
          JSON.stringify(statDeltas),
          "[]", narrative, null, JSON.stringify(newStats)]
      );
      await client.query(`UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);
      // В мульти-режиме перегруппировка — действие внутри месяца, месяц не продвигает.
      if (!require("../rules/rules-engine").MULTI_ACTION_TURNS) {
        await client.query(`UPDATE games SET current_turn = $1, updated_at = now() WHERE id = $2`, [turnNumber, gameId]);
      }
      await client.query("COMMIT");

      // Ukraine action (такая же механика как в confirm)
      fastify.log.info({ gameId, turnNumber }, "regroup: triggering world update async");
      setImmediate(async () => {
        try {
          // --- ДЕЙСТВИЯ УКРАИНЫ при перегруппировке ---
          // Разведка Киева фиксирует отход войск → контрудар или усиление давления
          // Веса повышены: перегруппировка = уязвимость
          {
            const s = newStats;
            const mil = s.military ?? 50;
            const eco = s.economy ?? 50;
            const kha = s.kharkiv_control ?? 12;
            const don = s.donetsk_control ?? 78;

            const UA_REGROUP_ACTIONS = [
              // Контрнаступление — главная реакция на паузу
              {
                type: "counterattack", weight: 5,
                title: "ВСУ используют паузу для контрудара",
                text: "Разведка ВСУ зафиксировала отход российских частей на переформирование. Командование немедленно бросило в брешь резервные бригады. Контрудар поддержан артиллерией НАТО — российские позиции под давлением.",
                kharkivDelta: -4, army_moraleDelta: -3, readinessDelta: -2,
                responses: [
                  { label: "Экстренно перебросить резервы — остановить прорыв любой ценой", type: "defend" },
                  { label: "Дать контрудар превосходящими силами — окружить прорвавшихся", type: "retaliate" },
                  { label: "Выровнять линию обороны, сохранить силы для следующего наступления", type: "accept" },
                ],
              },
              // Диверсия в тылу — бьют пока мы восстанавливаемся
              {
                type: "rail_sabotage", weight: 4,
                title: "Диверсии в тылу во время паузы",
                text: "Украинские диверсионные группы активизировались в приграничных регионах. Взрывы на железнодорожных узлах и складах. Разведка докладывает: противник специально выбрал момент нашей перегруппировки.",
                militaryDelta: -2, readinessDelta: -4, economyDelta: -1,
                responses: [
                  { label: "Перевести тыловые районы на режим контрдиверсионных операций", type: "defend" },
                  { label: "Нанести ответные удары по украинской логистике и штабам", type: "retaliate" },
                  { label: "Форсировать перегруппировку и как можно быстрее вернуть инициативу", type: "accept" },
                ],
              },
              // Дроны — пока армия стоит, цели стационарны
              {
                type: "drone_strike", weight: 4,
                title: "Массированная атака дронов на позиции",
                text: "Украина запустила рой из 200+ FPV-дронов по сосредоточенным на переформировании российским частям. Скопление техники на марше — идеальная цель. Потери в технике значительные.",
                army_moraleDelta: -4, readinessDelta: -3, economyDelta: -2,
                responses: [
                  { label: "Рассредоточить войска, усилить РЭБ — не давать дронам захватить цели", type: "defend" },
                  { label: "Уничтожить украинские склады и производство дронов ответным ударом", type: "retaliate" },
                  { label: "Принять потери как неизбежные при перегруппировке, продолжить план", type: "accept" },
                ],
              },
              // Дипломатическое давление — момент «слабости» используют на Западе
              {
                type: "diplomatic_offensive", weight: 3,
                title: "Киев объявляет о «переломе» в войне",
                text: "МИД Украины экстренно созвал пресс-конференцию, заявив о «вынужденном отступлении» российских войск. Западные СМИ подхватили нарратив. Давление на Москву в Совете Безопасности резко возросло.",
                peace_progressDelta: -8, diplomacyDelta: -3, approvalDelta: -2,
                responses: [
                  { label: "Немедленно опровергнуть — провести брифинг Генштаба о плановой ротации", type: "defend" },
                  { label: "Ускорить возвращение в наступление — действия лучше слов", type: "retaliate" },
                  { label: "Проигнорировать — информационные войны не меняют карту", type: "accept" },
                ],
              },
            ];

            const totalWeight = UA_REGROUP_ACTIONS.reduce((s, a) => s + a.weight, 0);
            let rnd = Math.random() * totalWeight;
            let uaAction = UA_REGROUP_ACTIONS[0];
            for (const a of UA_REGROUP_ACTIONS) {
              rnd -= a.weight;
              if (rnd <= 0) { uaAction = a; break; }
            }

            // Применяем эффекты к stats и сохраняем в БД
            const UA_STAT_MAP = {
              economyDelta: "economy", stabilityDelta: "stability", approvalDelta: "approval",
              diplomacyDelta: "diplomacy", militaryDelta: "military", peace_progressDelta: "peace_progress",
              army_moraleDelta: "army_morale", readinessDelta: "readiness",
              kharkivDelta: "kharkiv_control", khersonDelta: "kherson_control",
            };
            const uaStats = { ...newStats };
            for (const [deltaKey, statKey] of Object.entries(UA_STAT_MAP)) {
              if (typeof uaAction[deltaKey] === "number") {
                uaStats[statKey] = Math.max(0, Math.min(100, (uaStats[statKey] ?? 50) + uaAction[deltaKey]));
              }
            }

            const client3 = await db.connect();
            try {
              await client3.query("BEGIN");
              await client3.query(
                `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions)
                 VALUES ($1, $2, 'ukraine_action', $3, $4, $5)`,
                [gameId, turnNumber, `Украина · ${uaAction.title}`, uaAction.text,
                 JSON.stringify({ type: uaAction.type, responses: uaAction.responses })]
              );
              await client3.query(
                `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
                [JSON.stringify(uaStats), gameId]
              );
              await client3.query("COMMIT");
              fastify.log.info({ gameId, uaAction: uaAction.type }, "regroup: Ukraine counter-action fired");
            } catch (e) {
              await client3.query("ROLLBACK");
              fastify.log.error({ err: e }, "regroup: Ukraine action DB write failed");
            } finally {
              client3.release();
            }
          }
          // --- конец действий Украины ---

          const { generateWorldUpdate } = require("../ai/worldUpdate");
          const worldResult = await generateWorldUpdate({
            params: {
              countryName: game.country_name || "Россия",
              turnNumber,
              playerInput: "[Перегруппировка войск — разведка противника фиксирует паузу]",
              narrative,
              statDeltas,
              relationDeltas: [],
              currentRelations: game.relations || [],
              actionType: "regroup",
            },
            callClaudeApi: require("../ai/claude-client").callClaudeApi,
          });
          if (worldResult) {
            const client2 = await db.connect();
            try {
              await client2.query("BEGIN");
              for (const reaction of (worldResult.world_reactions || [])) {
                await client2.query(
                  `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'reaction',$3,$4,'[]')`,
                  [gameId, turnNumber, reaction.source, reaction.text]
                );
              }
              await client2.query("COMMIT");
            } catch (e) {
              await client2.query("ROLLBACK");
              fastify.log.error({ err: e }, "regroup worldUpdate DB write failed");
            } finally {
              client2.release();
            }
          }
        } catch (e) {
          fastify.log.error({ err: e }, "regroup worldUpdate failed");
        }
      });

      return reply.send({
        turnNumber,
        narrative,
        statDeltas,
        regrouped: true,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Regroup failed" });
    } finally {
      client.release();
    }
  });

  // GET /games/:gameId/stat-history — история всех статов по ходам
  fastify.get("/games/:gameId/stat-history", async (request, reply) => {
    const { gameId } = request.params;
    const res = await db.query(
      `SELECT turn_n, stats_snapshot, stat_deltas, gm_classification->>'action_type' AS action_type
       FROM turns WHERE game_id = $1 AND stats_snapshot IS NOT NULL ORDER BY turn_n ASC`,
      [gameId]
    );
    return reply.send({ history: res.rows });
  });

  // GET /games/:gameId/policy-news?keyword=X — новости связанные с политикой
  fastify.get("/games/:gameId/policy-news", async (request, reply) => {
    const { gameId } = request.params;
    const { keyword } = request.query;
    const res = await db.query(
      `SELECT turn_n, item_type, source, text, created_at FROM newsfeed_items
       WHERE game_id = $1 AND ($2::text IS NULL OR text ILIKE $3 OR source ILIKE $3)
       ORDER BY turn_n DESC LIMIT 20`,
      [gameId, keyword || null, keyword ? `%${keyword}%` : null]
    );
    return reply.send({ items: res.rows });
  });

  // POST /games/:gameId/cancel-policy — отменить активную политику
  fastify.post("/games/:gameId/cancel-policy", async (request, reply) => {
    const { gameId } = request.params;
    const { policyTitle } = request.body || {};
    if (!policyTitle) return reply.code(400).send({ error: "policyTitle required" });

    const gsRes = await db.query(`SELECT policies, stats FROM game_state WHERE game_id = $1`, [gameId]);
    if (gsRes.rowCount === 0) return reply.code(404).send({ error: "Game not found" });

    const policies = gsRes.rows[0].policies || [];
    const target = policies.find(p => p.title === policyTitle);
    const updated = policies.map(p =>
      p.title === policyTitle ? { ...p, status: "cancelled" } : p
    );

    // Последствия отмены: индивидуальные для политики (cancel_penalty), иначе дефолт,
    // который масштабируется под реальный бюджетный эффект отменяемой политики — иначе
    // отмена доходной (например, защитной пошлины) политики выглядит как бесплатное действие,
    // хотя казна со следующего месяца теряет её budget_income.
    const income = Number(target?.budget_income) || 0;
    const upkeep = Number(target?.budget_upkeep) || 0;
    let penalty;
    if (target && target.cancel_penalty && typeof target.cancel_penalty === "object") {
      penalty = target.cancel_penalty;
    } else {
      penalty = { stability: -2, approval: -1 };
      // Доходная/протекционистская политика (пошлина, сбор и т.п.) — отмена бьёт по экономике
      // пропорционально потерянному доходу: рынок открывается, но бюджет теряет приток.
      if (income > 0) penalty.economy = -Math.min(6, Math.max(1, Math.round(income / 4)));
      // Крупная затратная программа (>8 содержания) — у неё были бенефициары, недовольные отменой.
      if (upkeep > 8) penalty.approval = (penalty.approval || 0) - Math.min(3, Math.round(upkeep / 10));
    }
    const stats = { ...gsRes.rows[0].stats };
    for (const [k, v] of Object.entries(penalty)) {
      if (typeof v === "number") stats[k] = Math.max(0, Math.min(100, (stats[k] ?? 50) + v));
    }

    await db.query(
      `UPDATE game_state SET policies = $1, stats = $2, updated_at = now() WHERE game_id = $3`,
      [JSON.stringify(updated), JSON.stringify(stats), gameId]
    );

    const gameRes = await db.query(`SELECT current_turn FROM games WHERE id = $1`, [gameId]);
    const turnN = gameRes.rows[0]?.current_turn || 0;
    const STAT_RU = { stability: "стабильность", approval: "рейтинг", economy: "экономика", military: "армия", diplomacy: "дипломатия", reserves: "резервы", inflation: "инфляция", middle_class: "средний класс", lower_class_mood: "настроения населения", social_tension: "напряжённость", army_morale: "боевой дух", readiness: "боеготовность", equipment: "оснащение", media_control: "контроль СМИ", employment: "занятость" };
    const penaltyText = Object.entries(penalty)
      .map(([k, v]) => `${STAT_RU[k] || k} ${v > 0 ? "+" : ""}${v}`).join(", ");
    const budgetBits = [];
    if (income > 0) budgetBits.push(`казна теряет ${income} пункт${income === 1 ? "" : income < 5 ? "а" : "ов"}/мес. дохода`);
    if (upkeep > 0) budgetBits.push(`казна экономит ${upkeep} пункт${upkeep === 1 ? "" : upkeep < 5 ? "а" : "ов"}/мес. на содержании`);
    const budgetText = budgetBits.length ? ` ${budgetBits.join(", ")}.` : "";
    await db.query(
      `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
      [gameId, turnN, "Кремль", `Политика «${policyTitle}» отменена. Последствия: ${penaltyText}.${budgetText}`]
    );

    return reply.send({ ok: true, statPenalty: penalty, lostIncome: income, savedUpkeep: upkeep });
  });
  // POST /games/:gameId/ukraine/respond — ответ на действие Украины из ленты
  // Применяет последствия выбранной стратегии реагирования.
  fastify.post("/games/:gameId/ukraine/respond", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { turnN, responseType } = request.body || {};
    if (!turnN || !["defend", "retaliate", "accept"].includes(responseType)) {
      return reply.code(400).send({ error: "turnN и responseType (defend|retaliate|accept) обязательны" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const gsRes = await client.query(
        `SELECT gs.stats, gs.relations, g.current_turn FROM game_state gs JOIN games g ON g.id = gs.game_id WHERE gs.game_id = $1 FOR UPDATE`,
        [gameId]
      );
      if (!gsRes.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...gsRes.rows[0].stats };
      // Проверяем: уже отвечали на это событие?
      const responded = newStats.ukraine_responses || {};
      if (responded[turnN]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "На это событие уже был дан ответ" });
      }

      // Эффекты по типу ответа
      const clamp = (v) => Math.max(0, Math.min(100, v));
      const RESPONSE_EFFECTS = {
        defend: {
          // Эффективное противодействие: укрепляет стабильность, стоит инициативы
          label: "Оборонительные меры приняты",
          statDelta: { stability: 2, approval: 2, army_morale: 1, initiative: -10 },
        },
        retaliate: {
          // Контрудар: поднимает боевой дух, но эскалирует
          label: "Контрудар нанесён",
          statDelta: { army_morale: 3, military: 1, peace_progress: -5, war_escalation_counter: 1, approval: 1, initiative: -20 },
        },
        accept: {
          // Принять потери: дёшево, но бьёт по авторитету
          label: "Потери приняты, ситуация взята под контроль",
          statDelta: { approval: -2, stability: -1 },
        },
      };
      const effect = RESPONSE_EFFECTS[responseType];
      for (const [k, v] of Object.entries(effect.statDelta)) {
        if (k === "initiative") {
          newStats.initiative = Math.max(0, (newStats.initiative ?? 100) + v);
        } else if (k === "war_escalation_counter") {
          newStats.war_escalation_counter = Math.min(5, (newStats.war_escalation_counter ?? 0) + v);
        } else if (k === "peace_progress") {
          newStats.peace_progress = Math.max(0, Math.min(100, (newStats.peace_progress ?? 0) + v));
        } else if (typeof newStats[k] === "number") {
          newStats[k] = clamp(newStats[k] + v);
        } else {
          newStats[k] = clamp(50 + v);
        }
      }

      // Помечаем что ответили
      newStats.ukraine_responses = { ...responded, [turnN]: responseType };

      await client.query(
        `UPDATE game_state SET stats = $1, updated_at = now() WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const currentTurn = gsRes.rows[0].current_turn || turnN;
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, currentTurn, "Штаб", `Ответ на действие противника (ход ${turnN}): ${effect.label}.`]
      );

      await client.query("COMMIT");
      return reply.send({ ok: true, label: effect.label, statDelta: effect.statDelta, newStats });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Respond failed" });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerTurnRoutes };
