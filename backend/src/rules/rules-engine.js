/**
 * rules-engine.js
 *
 * Детерминированное применение таблицы правил (docs/01-rules-table.md,
 * docs/04-cabinet-and-categories.md) к классификации хода, полученной
 * от ИИ-геймместера.
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
};

// Начальные значения субметрик — Россия 2026 (применяются если отсутствуют в stats)
const SUBSTAT_DEFAULTS = {
  // approval
  elite_satisfaction: 62,
  corruption: 68,
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
  // peace
  peace_progress: 12,
  // Украина — "полная симметрия" (2026-07-06): аддитивные новые статы, ua_army/ua_west_support/
  // ua_morale НЕ трогаем (существующие ключи, не переименовывать — риск для сейвов). Зеркалит
  // 5 базовых статов России (economy/military/diplomacy/stability/approval).
  ua_economy: 55,
  ua_diplomacy: 70,
  ua_stability: 60,
  // бюджет/казна (0–100 для баланса; на экране — ещё и в ₽ трлн). Может уходить в минус (дефицит).
  treasury: 52,
  // Нефть и валюта — РЕАЛЬНЫЕ единицы (не 0–100): $/баррель Brent и ₽/$.
  // Дрейфуют и реагируют на события помесячно в /turns/end-month, влияют на доход казны.
  oil_price: 85,
  usd_rub: 80,
  // Украина — собственное состояние противника (не 0-100 по смыслу «у игрока»,
  // а реальная сила Украины как актора). Обновляется помесячно в /turns/end-month.
  ua_army: 65,         // военная мощь ВСУ (растёт от западных поставок, падает от ударов)
  ua_west_support: 75, // поддержка Запада (падает от дипломатических успехов России)
  ua_morale: 65,       // боевой дух (зависит от военного баланса)
  // Петя, 2026-07-19: у России военный блок раскрыт на 4 подстата (army_morale/equipment/
  // readiness/veterans), у Украины было только 3 РАЗНЫХ по смыслу стата в сравнительной панели
  // "Силы сторон" (ua_army/ua_west_support/ua_morale) — не баг рендера, а реальный пробел модели
  // ("полная симметрия" 2026-07-06 зеркалила только 5 БАЗОВЫХ статов, не подстаты военного блока).
  // Добавляем недостающие 3 — та же механика, что уже двигает ua_army/ua_morale (см.
  // UA_IMPACT_FROM_PLAYER ниже), не новый слой. Снаряжение ниже дефолта ua_army (65) — под
  // давлением дефицита западных поставок; боеготовность и опыт войск — выше: ВСУ воюют 4-й год,
  // закалённая армия на реальных боевых позициях.
  ua_equipment: 55,
  ua_readiness: 72,
  ua_veterans: 75,
  // Башни Кремля (см. FACTION_DEFAULTS/computeFactionReactions ниже) + счётчик коалиционной
  // стабильности за выбор компромисса в карточках-дилеммах.
  // Петя, 2026-07-11 (третья правка старта подряд): плоский старт 55/55/55/55 всё ещё "все
  // счастливы" на экране, ПОТОМУ ЧТО фронтенд (FactionsTab) до 1-го хода читает статы через
  // СВОЙ собственный хардкод `?? 65` (см. App.jsx) — реальный SUBSTAT_DEFAULTS никогда не
  // попадал в game_state.stats ДО первого applyTurn, так что новая партия показывала старое
  // число 65 (выше порога 60 → бакет "довольны"). Плюс новый запрос: не ровный старт у всех,
  // а АСИММЕТРИЧНЫЙ — "силовики на подъёме, охранители тоже, а олигархат и технократы приуныли"
  // (реалистичная картина военной экономики: силовой/идеологический блок наверху, бизнес/
  // либеральный экономический блок под давлением санкций и госконтроля). Числа выбраны так,
  // чтобы обе высокие башни стартовали ВЫШE порога довольства (60), а обе низкие — НИЖЕ (значит
  // сразу получают реальный, а не только визуальный, дебафф 1-го уровня — санкционное давление
  // ощущается с первого хода, а не только когда игрок сам его создаст).
  faction_siloviki: 70,
  faction_tehnokraty: 40,
  faction_oligarhi: 42,
  faction_konservatory: 68,
  coalition_stability: 0,
  coalition_milestone_reached: 0, // 0/1 — флаг, ставится один раз при coalition_stability достигшей 5
  // Временные бонусы от карточек-дилемм (см. FACTION_DILEMMAS ниже). Счётчик ходов декрементируется
  // в /turns/end-month (turns.js) — оба эффекта по природе помесячные (скидка на действия, снижение
  // ПАССИВНОЙ ежемесячной утечки от коррупции), поэтому не имеет смысла тикать их внутри applyTurn,
  // который вызывается на каждое отдельное действие в мульти-режиме.
  perk_mil_initiative_discount_turns: 0,
  perk_corruption_audit_turns: 0,
  // Эскалация "западное вооружение" (см. checkWesternArmsEscalation выше) — streak считает
  // подряд идущие наступления с подавляющей армией и провальной контратакой ВСУ; shipments —
  // сколько раз эскалация уже случилась в этой партии (для нарратива/будущего масштабирования);
  // perk-счётчик тикает в /turns/end-month, эффект читается внутри computeTerritoryDelta.
  ua_failed_counterattack_streak: 0,
  ua_western_arms_shipments: 0,
  perk_ua_western_arms_turns: 0,
};

// Стоимость действий ДЕНЬГАМИ (из казны), отдельно от инициативы.
// Используется для указов (decree_*), crisis, regroup. Военные операции, дипломатия
// и шпионаж имеют СОБСТВЕННУЮ стоимость по конкретной категории — см. CATEGORY_COST.
const ACTION_BUDGET_COST = {
  military:        20, // фоллбэк, если категория почему-то не нашлась в CATEGORY_COST
  decree_program:  15,
  decree_reform:   8,
  decree_fast:     3,
  decree:          8,
  diplomacy_op:    5,  // фоллбэк
  intel:           5,  // фоллбэк
  crisis:          4,
  regroup:         2,
};
const TREASURY_MIN = -100; // жёсткий пол, чтобы дефицит не уходил в бесконечность
// БАЛАНС (2026-07-04): было 0.8 — при таком курсе месячный доход казны (~20 очков при
// экономике 50) отображался как ≈₽16 трлн/мес (≈₽192 трлн/год), что почти равно всему
// номинальному ВВП модели (₽190 трлн при экономике 50, см. GDP_NOMINAL_BASE_RUB_TRILLION
// во frontend/src/App.jsx) — то есть казна "изображала" сбор налогов в размере ~100% ВВП
// каждый год, при реальной доле доходов федерального бюджета РФ к ВВП ≈18-20%. Приведено
// к тому же курсу, что уже используется для резервов (ФНБ) — RESERVES_RUB_TRILLION_PER_POINT
// во App.jsx — потому что «конвертация ФНБ в казну» (treasury.js) двигает одни и те же
// рубли между двумя пулами очков и ДОЛЖНА использовать один курс для обоих, иначе конвертация
// физически создаёт или уничтожает деньги. Держать в синхроне с App.jsx (TREASURY_PER_TRILLION,
// мини-виджет «КАЗНА» с локальным T) — общего модуля между backend/frontend нет.
const TREASURY_PER_TRILLION = 0.13; // 1 пункт казны ≈ ₽0.13 трлн (для отображения)

// Стоимость инициативы по типу действия (фоллбэк для указов/crisis/regroup;
// военные/дипломатия/шпионаж переопределяются через CATEGORY_COST по конкретной категории)
const INITIATIVE_COST = {
  decree_fast:    20,
  decree_reform:  35,
  decree_program: 55,
  decree:         35, // совместимость со старым кодом
  intel:          20, // фоллбэк
  military:       55, // фоллбэк
  crisis:         15,
  diplomacy_op:   35, // фоллбэк
  regroup:         0, // перегруппировка: инициатива не тратится, а восстанавливается
};

// Стоимость по КОНКРЕТНОЙ категории — военные операции, дипломатия, шпионаж.
// Указы (econ_*/mil_admin_*/pol_*) сюда не входят — у них цена по тиру (decree_fast/reform/program),
// категория определяет только какие статы двигаются, не цену. См. docs/04-cabinet-and-categories.md §4.3.
const CATEGORY_COST = {
  // Военные операции (§2.1)
  mil_recon:                 { initiative: 15, treasury: 3 },
  mil_tactical:               { initiative: 30, treasury: 10 },
  mil_operational_offensive:  { initiative: 55, treasury: 25 },
  mil_operational_defensive:  { initiative: 45, treasury: 18 },
  mil_strategic_offensive:    { initiative: 80, treasury: 42 },
  mil_strategic_defensive:    { initiative: 60, treasury: 30 },
  mil_hybrid:                 { initiative: 40, treasury: 15 },
  // Дипломатия (§2.3)
  diplo_negotiate:    { initiative: 35, treasury: 5 },
  diplo_treaty:       { initiative: 50, treasury: 10 },
  diplo_pressure:     { initiative: 35, treasury: 3 },
  diplo_multilateral: { initiative: 45, treasury: 8 },
  diplo_soft_power:   { initiative: 25, treasury: 8 },
  diplo_peace:        { initiative: 30, treasury: 5 },
  // Шпионаж (§2.2)
  covert_disinfo:      { initiative: 20, treasury: 5 },
  covert_destabilize:  { initiative: 30, treasury: 8 },
  covert_sabotage:     { initiative: 40, treasury: 15 },
  covert_elimination:  { initiative: 60, treasury: 25 },
};

// Группы категорий — заменяют точечные сравнения строк ("=== 'military_offensive'")
// по всему бэкенду. Один источник правды: если категория переименовывается, достаточно
// поправить набор здесь, а не искать все места сравнения в коде.
const CATEGORY_GROUP = {
  // Наступательные военные операции: стрик/усталость, бонус разведки, толчок мирного трека
  military_offensive_like: new Set(["mil_tactical", "mil_operational_offensive", "mil_strategic_offensive", "mil_hybrid"]),
  // Любая боевая операция (без mil_recon) — потребляет разведбонус от mil_recon
  military_combat: new Set(["mil_tactical", "mil_operational_offensive", "mil_operational_defensive", "mil_strategic_offensive", "mil_strategic_defensive", "mil_hybrid"]),
  // Оборонительные операции — свой (положительный) эффект на мирный трек
  military_defensive_like: new Set(["mil_operational_defensive", "mil_strategic_defensive"]),
  // Все 7 категорий военного домена (включая mil_recon) — месячный лимит "1 военная
  // операция/мес" в turns.js. НЕ путать с mil_admin_* (указы, другой лимит/цена)
  military_operations: new Set(["mil_recon", "mil_tactical", "mil_operational_offensive", "mil_operational_defensive", "mil_strategic_offensive", "mil_strategic_defensive", "mil_hybrid"]),
  // Любая дипломатическая активность — не даёт мирному треку затухать (см. turns.js hadDiplomacyMove)
  diplomatic_activity: new Set(["diplo_negotiate", "diplo_treaty", "diplo_pressure", "diplo_multilateral", "diplo_soft_power", "diplo_peace"]),
  // Тайные операции — единственные, где применяется exposure_risk (см. turns.js)
  covert_ops: new Set(["covert_destabilize", "covert_sabotage", "covert_disinfo", "covert_elimination"]),
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

// Часть эффекта Реформы/Программы приходит не сразу, а позже — делает срок действия
// (DECREE_DURATION) реальным процессом, а не косметическим таймером (Петя, 2026-07-18:
// "может быть дать больше плюшек от реформ и программ... получу их в конце или в процессе?").
// Быстрый указ — весь эффект сразу, соответствует своему названию, не участвует здесь.
// Триггер — примерно середина срока действия: не размазываем эффект на каждый ход, потому что
// большинство дельт RULES_TABLE (обычно 1-4 пункта) слишком малы, чтобы пережить дробление на
// много частей без обнуления округлением — один заметный "довесок" вместо невидимой пыли.
const TIER_SPLIT = {
  decree_reform:  { immediateShare: 0.6, offsetTurns: Math.ceil(DECREE_DURATION.decree_reform / 2) },
  decree_program: { immediateShare: 0.5, offsetTurns: Math.ceil(DECREE_DURATION.decree_program / 2) },
};

// Бонус «разведка готовит почву»: mil_recon усиливает следующую боевую операцию.
const INTEL_BOOST_FACTOR = 1.3;

// МОДЕЛЬ ХОДА: true — несколько действий за месяц (инициатива = бюджет месяца,
// месяц/распад/дата продвигаются по «Завершить месяц»); false — 1 действие = 1 месяц (старая).
// Флаг для обратимости: если новая модель не зайдёт — ставим false.
const MULTI_ACTION_TURNS = true;

// МОДЕЛЬ УКРАИНЫ (Петя, 2026-07-06): true — полная симметрия с игроком (собственные 5 статов
// ua_economy/ua_army/ua_diplomacy/ua_stability/ua_morale, своя UA_RULES_TABLE с диапазонами
// дельт, ИИ свободно выбирает категорию+severity+пишет нарратив — см. ukraine-rules-engine.js
// и ukraine-action-v2.js); false — прежняя реактивная модель (UA_ACTIONS, 17 канонических
// событий, generateUkraineAction/scaleUaDeltas, построено в этой же сессии до полной симметрии).
// Флаг для обратимости: пробуем на паре партий — если не зайдёт, ставим false, старый код
// НЕ удалён и продолжает работать байт-в-байт как раньше.
const UKRAINE_FULL_SYMMETRY = true;

// Метрики, у которых РОСТ = ПЛОХО (инвертированные). Используются для цветокодирования.
const INVERTED_STATS = new Set(["corruption", "inflation", "isolation", "war_escalation_counter"]);

// Убывающая отдача от последовательных военных операций
const MILITARY_FATIGUE_THRESHOLD = 2; // после N военных ходов подряд — штраф

// Вероятность раскрытия тайной операции (covert_*) по декларируемому ИИ уровню риска.
// Бросок — seeded (см. seededFraction), не Math.random(), для честного сравнения партий.
const EXPOSURE_RISK_CHANCE = { low: 0.10, medium: 0.30, high: 0.55 };

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

// ПРЯМАЯ ЦЕНА ДЛЯ УКРАИНЫ ОТ КОНКРЕТНОГО УКАЗА ИГРОКА (Петя, 2026-07-09: "должно быть понятно,
// как военные/шпионские операции против Украины и союзников на неё повлияли") — ОТДЕЛЬНО от
// UA_RULES_TABLE в ukraine-rules-engine.js (та описывает СОБСТВЕННЫЙ ежемесячный ход Украины,
// симметричный игроку, никак не завязанный на то, что именно сделал игрок в этом же ходу).
// Этот блок даёт немедленную, видимую в statDeltas (превью/итоги хода) цену для ua_army/
// ua_morale/ua_stability от военных и тайных операций, нацеленных на Украину — раньше единственной
// связью было отложенное, недискриминирующее категорию пороговое изменение по абсолютному уровню
// статов России (см. блок с westDelta/armyDelta в /turns/regroup и runUkraineTurn).
// ua_equipment/ua_readiness/ua_veterans (добавлены 2026-07-19, см. комментарий у SUBSTAT_DEFAULTS)
// расширяют только те строки, что уже трогают ua_army — те же категории, тот же генеричный цикл
// ниже (for stat of Object.keys(uaImpactTable)), новой логики не требуется. Пропорции ориентированы
// на то, как те же action_type-строки в основном RULES_TABLE (~строка 518+) трогают РОССИЙСКИЕ
// equipment/readiness/veterans для тех же категорий — знак зеркальный (по Украине бьют), порядок
// величины сопоставим с уже существующим ua_morale в той же строке.
const UA_IMPACT_MAX_DELTA_PER_TURN = { ua_army: 10, ua_morale: 8, ua_stability: 6, ua_west_support: 5, ua_equipment: 10, ua_readiness: 8, ua_veterans: 8 };
const UA_IMPACT_FROM_PLAYER = {
  mil_tactical:               { ua_army: [-4, -2], ua_morale: [-2, -1], ua_equipment: [-2, -1], ua_readiness: [-2, -1], ua_veterans: [-1, 0] },
  mil_operational_offensive:  { ua_army: [-6, -3], ua_morale: [-4, -2], ua_equipment: [-3, -1], ua_readiness: [-3, -2], ua_veterans: [-2, -1] },
  mil_strategic_offensive:    { ua_army: [-9, -5], ua_morale: [-6, -3], ua_equipment: [-5, -2], ua_readiness: [-4, -2], ua_veterans: [-3, -2] },
  mil_hybrid:                 { ua_army: [-3, -1], ua_stability: [-2, -1], ua_equipment: [-1, 0], ua_readiness: [-2, -1] },
  covert_disinfo:             { ua_morale: [-2, -1] },
  covert_destabilize:         { ua_stability: [-4, -2] },
  covert_sabotage:            { ua_army: [-4, -2], ua_equipment: [-4, -2], ua_readiness: [-1, 0] },
  covert_elimination:         { ua_stability: [-5, -3], ua_morale: [-3, -1] },
  nuclear_strike:             { ua_army: [-10, -8], ua_morale: [-8, -6], ua_stability: [-8, -5], ua_equipment: [-8, -6], ua_readiness: [-6, -4], ua_veterans: [-6, -4] },
};
// Страны-союзники Украины (Запад) — удар по отношениям с ними бьёт по её западной поддержке
// (ua_west_support), даже когда указ сам по себе не военный (санкционный обход, давление и т.п.).
// Реиспользует affected_relations — тот же сигнал, который классификатор УЖЕ выдаёт для дельт
// отношений, новой ИИ-классификации не требуется.
const UA_ALLY_COUNTRIES = new Set(["США", "ЕС", "Великобритания", "Германия", "Франция", "Польша"]);

// БАШНИ КРЕМЛЯ (Петя, 2026-07-09): элиты как отдельный от Кабинета министров слой — министры
// исполняют, башни лоббируют. 4 башни, лояльность 0-100, начало нейтральное (55). НЕ заводим
// новую RULES_TABLE на 30 категорий × 4 башни (это ровно тот "перегруз", от которого ушли при
// удалении social_tension/media_control) — вместо этого башни реагируют на УЖЕ посчитанные в
// этом же ходу statDeltas (тот эффект, который категория и так дала на economy/military/
// diplomacy/stability/approval/corruption/isolation), т.е. переиспользуем существующие тюнинги
// RULES_TABLE, а не плодим новые числа.
const FACTION_KEYS = ["faction_siloviki", "faction_tehnokraty", "faction_oligarhi", "faction_konservatory"];
const FACTION_MAX_DELTA_PER_TURN = 14; // клэмп реакции башни за один ход (кроме карточек-дилемм, там свой клэмп)

// Явные стартовые значения башен — производные от SUBSTAT_DEFAULTS (единственный источник
// правды, числа не дублируются). Нужны отдельным экспортом, чтобы games.js мог замешать их в
// game_state.stats ПРИ СОЗДАНИИ партии, а не полагаться на то, что SUBSTAT_DEFAULTS применится
// только при первом applyTurn — раньше между созданием партии и первым ходом игрока
// game_state.stats.faction_* были буквально undefined, и фронтенд (FactionsTab) до первого хода
// показывал свой собственный устаревший хардкод-фолбэк (65), из-за чего новая партия выглядела
// "все довольны" независимо от реального SUBSTAT_DEFAULTS.
const FACTION_STARTING_STATS = Object.fromEntries(FACTION_KEYS.map(k => [k, SUBSTAT_DEFAULTS[k]]));

/**
 * Реакция каждой башни на statDeltas, УЖЕ посчитанные обычной RULES_TABLE в этом ходу.
 * Силовики — военные достижения, минус деэскалация/мирный трек. Технократы — экономика/рост,
 * минус коррупция/изоляция. Олигархи — экономика + терпимость к коррупции (для них это доступ
 * к схемам), минус изоляция (санкции режут каналы). Консерваторы — стабильность/одобрение
 * (патриотическая мобилизация), минус дипломатическая открытость (воспринимается как уступки).
 *
 * ДОВОЛЬСТВО ЭЛИТ — КОНЕЧНЫЙ РЕСУРС (Петя, 2026-07-10): раньше башни считались НЕЗАВИСИМО друг
 * от друга — редкий, но реальный ход мог понравиться сразу всем (см. econ_stimulus в 14-месячной
 * симуляции: Технократы и Консерваторы росли ОДНОВРЕМЕННО). Центрируем реакции вокруг нуля —
 * вычитаем среднее по всем 4 башням из "сырой" реакции каждой. Это НЕ убирает направленность
 * (относительная разница между башнями, т.е. кто выиграл больше/меньше — сохраняется, это и есть
 * дисперсия вокруг среднего), а гарантирует, что сумма реакций за ход ≈ 0: рост одной башни
 * математически идёт за счёт остальных. Всегда есть недовольный — ровно то, что просили.
 */
function computeFactionReactions(statDeltas) {
  const d = (k) => statDeltas[k] ?? 0;
  const raw = {
    faction_siloviki:     d("military") * 2.0 + d("army_morale") * 0.6 - d("diplomacy") * 0.6 - d("peace_progress") * 0.25,
    faction_tehnokraty:   d("economy") * 1.8 + d("gdp_growth") * 0.5 - d("corruption") * 0.5 - d("isolation") * 0.7,
    faction_oligarhi:     d("economy") * 1.4 + d("corruption") * 0.5 - d("isolation") * 0.9,
    faction_konservatory: d("stability") * 0.9 + d("approval") * 0.5 - d("diplomacy") * 0.5,
  };
  const mean = FACTION_KEYS.reduce((sum, k) => sum + raw[k], 0) / FACTION_KEYS.length;
  const out = {};
  for (const k of FACTION_KEYS) {
    const centered = raw[k] - mean;
    const rounded = Math.round(centered);
    out[k] = Math.max(-FACTION_MAX_DELTA_PER_TURN, Math.min(FACTION_MAX_DELTA_PER_TURN, rounded));
  }
  return out;
}

// ЛЕСТНИЦА ДЕБАФФОВ БАШЕН (Петя, 2026-07-10): "начиная с 60, по нарастающей — чем ниже, тем хуже
// и разнообразнее эффекты". Ниже 60 у КАЖДОЙ башни отдельно — 4 нарастающих уровня, эффекты не
// заменяют друг друга, а НАКАПЛИВАЮТСЯ (T2 = T1-эффект сильнее + новый, и т.д.), тематически под
// домен башни. Применяется ПОМЕСЯЧНО (turns.js end-month), не за каждое действие — это фоновое
// давление недовольства, а не реакция на конкретный указ (та — computeFactionReactions выше).
// Заменяет прежний точечный "саботаж экономблока" (oligarhi+tehnokraty<35) — при обоих <35 новая
// лестница даёт эффект НЕ СЛАБЕЕ старого (экономика −1 от каждой = −2, плюс остальные эффекты),
// так что старая отдельная проверка стала избыточной и удалена.
const FACTION_DEBUFF_LADDER = {
  faction_siloviki: [
    { below: 60, effects: { readiness: -1 } },
    { below: 45, effects: { readiness: -2, army_morale: -1 } },
    { below: 30, effects: { readiness: -3, army_morale: -2, military: -1 } },
    { below: 15, effects: { readiness: -4, army_morale: -3, military: -2, stability: -2 } },
  ],
  faction_tehnokraty: [
    { below: 60, effects: { gdp_growth: -1 } },
    { below: 45, effects: { gdp_growth: -2, inflation: 1 } },
    { below: 30, effects: { gdp_growth: -3, inflation: 2, economy: -1 } },
    { below: 15, effects: { gdp_growth: -4, inflation: 3, economy: -2, reserves: -2 } },
  ],
  faction_oligarhi: [
    { below: 60, effects: { treasury: -1 } },
    { below: 45, effects: { treasury: -2, corruption: 1 } },
    { below: 30, effects: { treasury: -3, corruption: 2, economy: -1 } },
    { below: 15, effects: { treasury: -4, corruption: 3, economy: -2, isolation: 1 } },
  ],
  faction_konservatory: [
    { below: 60, effects: { approval: -1 } },
    { below: 45, effects: { approval: -2, stability: -1 } },
    { below: 30, effects: { approval: -3, stability: -2, elite_satisfaction: -1 } },
    { below: 15, effects: { approval: -4, stability: -3, elite_satisfaction: -2 } },
  ],
};
const FACTION_DEBUFF_LABELS = {
  faction_siloviki: "Силовики недовольны", faction_tehnokraty: "Технократы недовольны",
  faction_oligarhi: "Олигархи недовольны", faction_konservatory: "Консерваторы недовольны",
};

/**
 * Считает суммарный эффект лестницы дебаффов по ВСЕМ 4 башням для текущего состояния (вызывать
 * раз в месяц, не за каждое действие). Возвращает { deltas: {stat: -N, ...}, notes: [{faction, tier, label}] }
 * — notes нужны для новостной ленты (объяснить игроку, откуда взялась просадка).
 */
function computeFactionDebuffs(stats) {
  const deltas = {};
  const notes = [];
  for (const faction of FACTION_KEYS) {
    const value = stats[faction] ?? 55;
    const ladder = FACTION_DEBUFF_LADDER[faction];
    // Находим САМЫЙ ГЛУБОКИЙ применимый уровень — его effects уже включают эффекты предыдущих
    // уровней в усиленном виде (лестница написана как кумулятивные снапшоты, не приросты).
    let applicable = null;
    for (const tier of ladder) {
      if (value < tier.below) applicable = tier;
    }
    if (!applicable) continue;
    const tierIndex = ladder.indexOf(applicable) + 1;
    for (const [stat, delta] of Object.entries(applicable.effects)) {
      deltas[stat] = (deltas[stat] ?? 0) + delta;
    }
    notes.push({ faction, tier: tierIndex, label: FACTION_DEBUFF_LABELS[faction], value });
  }
  return { deltas, notes };
}

// ЛЕСТНИЦА БАФФОВ БАШЕН (Петя, 2026-07-11: "при большом плюсе давать постоянные бафы у башни" —
// раньше высокое довольство было ЧИСТО отсутствием наказания, без награды, см. describeFactionBuffs
// в advisors.js до этой правки). Зеркалит FACTION_DEBUFF_LADDER по структуре и тематике домена
// (силовики → readiness/army_morale, технократы → gdp_growth/economy, олигархи → treasury/economy,
// консерваторы → approval/stability), но с положительными эффектами выше 75/90. Применяется
// ПОМЕСЯЧНО (turns.js end-month), тем же местом, что и computeFactionDebuffs.
const FACTION_BUFF_LADDER = {
  faction_siloviki: [
    { above: 75, effects: { readiness: 1 } },
    { above: 90, effects: { readiness: 2, army_morale: 1 } },
  ],
  faction_tehnokraty: [
    { above: 75, effects: { gdp_growth: 1 } },
    { above: 90, effects: { gdp_growth: 2, economy: 1 } },
  ],
  faction_oligarhi: [
    { above: 75, effects: { treasury: 1 } },
    { above: 90, effects: { treasury: 2, economy: 1 } },
  ],
  faction_konservatory: [
    { above: 75, effects: { approval: 1 } },
    { above: 90, effects: { approval: 2, stability: 1 } },
  ],
};
const FACTION_BUFF_LABELS = {
  faction_siloviki: "Силовики довольны", faction_tehnokraty: "Технократы довольны",
  faction_oligarhi: "Олигархи довольны", faction_konservatory: "Консерваторы довольны",
};

/**
 * Зеркало computeFactionDebuffs для положительной стороны — постоянный помесячный бафф, пока
 * башня держится выше порога. Вызывать раз в месяц (end-month) рядом с computeFactionDebuffs.
 */
function computeFactionBuffs(stats) {
  const deltas = {};
  const notes = [];
  for (const faction of FACTION_KEYS) {
    const value = stats[faction] ?? 55;
    const ladder = FACTION_BUFF_LADDER[faction];
    // Как и в дебафф-лестнице — берём САМЫЙ ВЫСОКИЙ применимый уровень (кумулятивный снапшот).
    let applicable = null;
    for (const tier of ladder) {
      if (value >= tier.above) applicable = tier;
    }
    if (!applicable) continue;
    const tierIndex = ladder.indexOf(applicable) + 1;
    for (const [stat, delta] of Object.entries(applicable.effects)) {
      deltas[stat] = (deltas[stat] ?? 0) + delta;
    }
    notes.push({ faction, tier: tierIndex, label: FACTION_BUFF_LABELS[faction], value });
  }
  return { deltas, notes };
}

// Диапазоны [min, max] для каждой категории x показателя.
// Субметрики: elite_satisfaction (0=элиты против, 100=за), corruption (0=чисто, 100=коррупция),
//             middle_class (0=нет среднего класса, 100=большой и довольный),
//             lower_class_mood (0=народ взбунтовался, 100=доволен)
//
// Домены (см. docs/04-cabinet-and-categories.md):
//   Военные операции (7): mil_recon, mil_tactical, mil_operational_offensive/defensive,
//     mil_strategic_offensive/defensive, mil_hybrid
//   Шпионаж (4): covert_destabilize, covert_sabotage, covert_disinfo, covert_elimination
//   Дипломатия (6): diplo_negotiate, diplo_treaty, diplo_pressure, diplo_multilateral,
//     diplo_soft_power, diplo_peace
//   Указы — экономические (5): econ_stimulus, econ_austerity, econ_sanctions_counter,
//     econ_infrastructure, econ_tech
//   Указы — военно-административные (3): mil_admin_budget, mil_admin_mobilization, mil_admin_doctrine
//   Указы — политические (4): pol_repression, pol_liberalization, pol_elite_consolidation, pol_social
//   Указы — информационные (1): pol_propaganda
//   Вне сетки: military_regroup, null_action, nuclear_strike (без изменений)
//
// ЭКОНОМИКА КАК ИНДИКАТОР, НЕ РЕСУРС: у военных операций, дипломатии, шпионажа,
// военно-административных и политических указов (кроме econ_*) колонка economy зафиксирована
// на [0,0] — эти действия и так платят казной (CATEGORY_COST) за военный/дипломатический эффект,
// а их РЕАЛЬНОЕ влияние на экономику идёт через то, что они уже двигают: gdp_growth, inflation,
// employment, reserves. Экономика в конце месяца компаундится из этих субметрик (см. turns.js,
// секция «РОСТ ВВП → ЭКОНОМИКА» и «ЗАНЯТОСТЬ → ЭКОНОМИКА») — то есть война бьёт по экономике
// не мгновенным штрафом в этой таблице, а с лагом, через реальные причины (инфляция военных
// расходов, отвлечение рабочей силы). Экономические указы (econ_*) — исключение: их прямая цель —
// управление экономикой, поэтому у них законно остаётся прямая колонка economy. Прямые пробои
// также остаются у нарративных шоков вне этой таблицы (кризисы, санкции, разоблачение шпионажа —
// см. turns.js) и у null_action/nuclear_strike здесь — это одноразовые события, а не рычаг,
// доступный игроку каждый ход.
//
// ЦЕНА ВОЙНЫ ОКАЗАЛАСЬ СЛИШКОМ МЯГКОЙ (2026-07-04): численная проверка честной "разумной" партии
// (5 наступлений + 2 econ_stimulus за 7 месяцев) показала economy 52→56 — РОСТ, несмотря на войну.
// Причина: gdp_growth у mil_operational_offensive двигался всего на -1/ход, а один econ_stimulus
// (+4) перекрывал урон от четырёх таких операций разом. Военные gdp_growth/employment штрафы
// углублены (примерно вдвое) и CATEGORY_COST.treasury у военных операций поднят (~20-25%) —
// теперь казна чаще проседает и подключает существующую спираль казна→экономика. Экономические
// указы и делители (/8, /10) не трогали — раньше это симметрично усилило бы обе стороны и не
// исправило бы само соотношение война/лечение.
//
// ПРЯМОЙ ECONOMY У ЭКОНОМИЧЕСКИХ УКАЗОВ (2026-07-04): econ_stimulus/austerity/infrastructure/
// tech были единственными 4 категориями во всей таблице, где economy двигалась НАПРЯМУЮ (везде
// остальное — economy:[0,0]) — нарушение собственного принципа "экономика — индикатор", который
// уже применён ко всем военным/дипломатическим/шпионским категориям. На практике это давало
// прямой эксплойт: 2 указа econ_stimulus за один месяц (не ограничены помесячным флагом) = +8
// экономики мгновенно, независимо от войны/санкций — игрок заметил это живьём. Обнулено — теперь
// экономические указы двигают economy ТОЛЬКО через уже существующий честный канал (gdp_growth/
// employment, компаундится в economy в /turns/end-month с задержкой на 1-3 хода устойчивого
// тренда, см. комментарий "РОСТ ВВП → ЭКОНОМИКА" в turns.js) — как и предлагал игрок: эффект
// накапливается постепенно, а не бьёт по economy мгновенно при подтверждении указа.
const RULES_TABLE = {
  // ---------- ВОЕННЫЕ ОПЕРАЦИИ ----------
  mil_recon:                  { economy:[0,0],   military:[0,1],  stability:[0,0],  diplomacy:[0,0],  approval:[0,0],   elite_satisfaction:[0,0],  corruption:[0,0],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,1],  equipment:[0,0],  readiness:[1,2],  veterans:[0,0],  ally_trust:[0,0],  isolation:[0,0]  },
  mil_tactical:                { economy:[0,0],   military:[1,3],  stability:[-1,0], diplomacy:[-1,0], approval:[-1,1],  elite_satisfaction:[0,2],  corruption:[0,1],  middle_class:[-1,0], lower_class_mood:[-1,1],  gdp_growth:[-2,0], inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[1,2],  equipment:[0,1],  readiness:[1,2],  veterans:[0,1],  ally_trust:[0,0],  isolation:[0,1]  },
  mil_operational_offensive:   { economy:[0,0],   military:[1,5],  stability:[-2,0], diplomacy:[-3,0], approval:[-1,2],  elite_satisfaction:[1,3],  corruption:[0,1],  middle_class:[-2,0], lower_class_mood:[-2,1],  gdp_growth:[-4,-1],inflation:[1,3],  employment:[-2,-1],reserves:[-2,0], army_morale:[1,4],  equipment:[-1,1], readiness:[2,4],  veterans:[1,3],  ally_trust:[-1,0], isolation:[1,3] },
  mil_operational_defensive:   { economy:[0,0],   military:[0,3],  stability:[1,3],  diplomacy:[0,1],  approval:[1,3],   elite_satisfaction:[0,2],  corruption:[0,0],  middle_class:[0,1],  lower_class_mood:[1,3],   gdp_growth:[-2,0], inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[2,4],  equipment:[0,2],  readiness:[2,4],  veterans:[0,2],  ally_trust:[0,2],  isolation:[-1,0]  },
  mil_strategic_offensive:     { economy:[0,0],   military:[3,6],  stability:[-3,-1],diplomacy:[-4,-2],approval:[-2,3],  elite_satisfaction:[1,4],  corruption:[0,2],  middle_class:[-3,-1],lower_class_mood:[-3,1],  gdp_growth:[-6,-3],inflation:[2,4],  employment:[-4,-2],reserves:[-3,-1],army_morale:[1,5],  equipment:[-2,1], readiness:[3,5],  veterans:[2,4],  ally_trust:[-2,-1],isolation:[2,4]},
  mil_strategic_defensive:     { economy:[0,0],   military:[2,5],  stability:[2,4],  diplomacy:[0,2],  approval:[1,4],   elite_satisfaction:[1,3],  corruption:[0,0],  middle_class:[0,2],  lower_class_mood:[1,4],   gdp_growth:[-2,-1],inflation:[0,2],  employment:[0,1],  reserves:[-2,-1],army_morale:[2,5],  equipment:[1,3],  readiness:[3,5],  veterans:[1,3],  ally_trust:[1,3],  isolation:[-1,0]  },
  mil_hybrid:                  { economy:[0,0],   military:[1,3],  stability:[0,1],  diplomacy:[-2,0], approval:[0,1],   elite_satisfaction:[0,1],  corruption:[1,2],  middle_class:[0,0],  lower_class_mood:[0,1],   gdp_growth:[-1,0], inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[1,3],  equipment:[0,1],  readiness:[1,2],  veterans:[0,1],  ally_trust:[-1,0], isolation:[1,3]  },

  // ---------- ШПИОНАЖ ----------
  covert_disinfo:              { economy:[0,0],   military:[0,0],  stability:[0,1],  diplomacy:[-1,1], approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[0,1],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[-1,0], isolation:[0,1]  },
  covert_destabilize:          { economy:[0,0],   military:[0,1],  stability:[0,1],  diplomacy:[-3,0], approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,2],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[-1,0], army_morale:[0,1],  equipment:[0,0],  readiness:[0,1],  veterans:[0,0],  ally_trust:[-1,0], isolation:[1,2]  },
  covert_sabotage:              { economy:[0,0],   military:[1,3],  stability:[0,0],  diplomacy:[-3,-1],approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,1],  employment:[0,0],  reserves:[-1,0], army_morale:[1,2],  equipment:[0,1],  readiness:[0,1],  veterans:[0,0],  ally_trust:[-2,-1],isolation:[2,3]  },
  covert_elimination:          { economy:[0,0],   military:[1,2],  stability:[-1,1], diplomacy:[-5,-2],approval:[-3,0],  elite_satisfaction:[0,2],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[-1,1],  gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[1,3],  equipment:[0,0],  readiness:[0,1],  veterans:[0,0],  ally_trust:[-2,-1],isolation:[3,5]  },

  // ---------- ДИПЛОМАТИЯ ----------
  diplo_negotiate:             { economy:[0,0],   military:[0,0],  stability:[0,1],  diplomacy:[2,5],  approval:[0,1],   elite_satisfaction:[1,3],  corruption:[-1,0], middle_class:[1,2],  lower_class_mood:[0,1],   gdp_growth:[0,2],  inflation:[-1,0], employment:[0,1],  reserves:[0,1],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[2,4],  isolation:[-2,-1]  },
  diplo_treaty:                 { economy:[0,0],   military:[0,1],  stability:[1,2],  diplomacy:[3,6],  approval:[1,2],   elite_satisfaction:[1,3],  corruption:[-1,0], middle_class:[1,3],  lower_class_mood:[1,2],   gdp_growth:[1,3],  inflation:[-1,0], employment:[1,2],  reserves:[1,2],  army_morale:[0,0],  equipment:[0,1],  readiness:[0,0],  veterans:[0,0],  ally_trust:[3,5],  isolation:[-3,-1]  },
  diplo_pressure:               { economy:[0,0],  military:[0,0],  stability:[-1,0], diplomacy:[-4,-1],approval:[-1,2],  elite_satisfaction:[-2,1], corruption:[0,1],  middle_class:[-1,0], lower_class_mood:[-1,1],  gdp_growth:[-2,0], inflation:[1,2],  employment:[-1,0], reserves:[-1,0], army_morale:[0,2],  equipment:[0,0],  readiness:[1,2],  veterans:[0,0],  ally_trust:[-2,0], isolation:[2,3] },
  diplo_multilateral:           { economy:[0,0],   military:[0,0],  stability:[0,1],  diplomacy:[3,5],  approval:[0,2],   elite_satisfaction:[0,2],  corruption:[0,0],  middle_class:[0,1],  lower_class_mood:[0,1],   gdp_growth:[0,1],  inflation:[0,0],  employment:[0,1],  reserves:[0,1],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[2,4],  isolation:[-2,-1]  },
  diplo_soft_power:             { economy:[0,0],   military:[0,0],  stability:[0,1],  diplomacy:[1,3],  approval:[1,2],   elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[0,1],  lower_class_mood:[1,2],   gdp_growth:[0,1],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[1,2],  isolation:[-1,0]  },
  diplo_peace:                   { economy:[0,0],   military:[-1,0], stability:[1,2],  diplomacy:[2,4],  approval:[1,3],   elite_satisfaction:[-1,1], corruption:[-1,0], middle_class:[1,3],  lower_class_mood:[2,4],   gdp_growth:[1,3],  inflation:[-1,0], employment:[0,2],  reserves:[0,2],  army_morale:[-2,0], equipment:[-1,0], readiness:[-1,1], veterans:[0,1],  ally_trust:[2,4],  isolation:[-3,-1]  },

  // ---------- УКАЗЫ: ЭКОНОМИЧЕСКИЕ ----------
  econ_stimulus:                { economy:[0,0],   military:[0,0],  stability:[1,2],  diplomacy:[0,0],  approval:[1,3],   elite_satisfaction:[-1,2], corruption:[-2,0], middle_class:[2,4],  lower_class_mood:[2,4],   gdp_growth:[2,5],  inflation:[1,3],  employment:[1,3],  reserves:[-2,-1],army_morale:[0,1],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,1],  isolation:[-1,0]  },
  econ_austerity:                { economy:[0,0],   military:[0,0],  stability:[-3,-1],diplomacy:[0,0],  approval:[-5,-2], elite_satisfaction:[2,4],  corruption:[-3,-1],middle_class:[-3,-1],lower_class_mood:[-4,-2], gdp_growth:[0,2],  inflation:[-3,-1],employment:[-2,-1],reserves:[2,4],  army_morale:[-1,0], equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,1],  isolation:[0,1] },
  econ_sanctions_counter:       { economy:[0,0],   military:[0,0],  stability:[0,1],  diplomacy:[-2,0], approval:[0,1],   elite_satisfaction:[1,2],  corruption:[1,2],  middle_class:[0,1],  lower_class_mood:[0,1],   gdp_growth:[0,2],  inflation:[0,1],  employment:[0,1],  reserves:[0,1],  army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[-1,0], isolation:[1,2]  },
  econ_infrastructure:          { economy:[0,0],  military:[0,1],  stability:[1,2],  diplomacy:[0,1],  approval:[1,2],   elite_satisfaction:[0,1],  corruption:[0,1],  middle_class:[1,2],  lower_class_mood:[1,2],   gdp_growth:[1,2],  inflation:[0,1],  employment:[1,2],  reserves:[-1,0], army_morale:[0,0],  equipment:[0,1],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,0],  isolation:[0,0]  },
  econ_tech:                     { economy:[0,0],  military:[0,1],  stability:[0,1],  diplomacy:[0,1],  approval:[0,2],   elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[0,1],  lower_class_mood:[0,1],   gdp_growth:[2,4],  inflation:[0,0],  employment:[0,1],  reserves:[-1,0], army_morale:[0,0],  equipment:[0,1],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,1],  isolation:[0,0]  },

  // ---------- УКАЗЫ: ВОЕННО-АДМИНИСТРАТИВНЫЕ (бюджет/мобилизация/доктрина — НЕ боевые операции) ----------
  mil_admin_budget:             { economy:[0,0],  military:[1,2],  stability:[0,1],  diplomacy:[0,0],  approval:[-1,1],  elite_satisfaction:[1,2],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,1],  employment:[0,1],  reserves:[-1,0], army_morale:[0,1],  equipment:[1,3],  readiness:[0,1],  veterans:[0,0],  ally_trust:[0,0],  isolation:[0,1]  },
  mil_admin_mobilization:       { economy:[0,0],  military:[2,4],  stability:[-2,0], diplomacy:[0,0],  approval:[-5,-2], elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[-1,0], lower_class_mood:[-3,-1], gdp_growth:[-1,0], inflation:[0,1],  employment:[-1,0], reserves:[0,0],  army_morale:[0,1],  equipment:[1,2],  readiness:[1,3],  veterans:[0,1],  ally_trust:[0,0],  isolation:[0,1]  },
  mil_admin_doctrine:           { economy:[0,0],   military:[1,2],  stability:[0,1],  diplomacy:[-1,0], approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[0,0],  lower_class_mood:[0,0],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[1,2],  equipment:[0,1],  readiness:[1,2],  veterans:[0,1],  ally_trust:[0,0],  isolation:[0,1]  },

  // ---------- УКАЗЫ: ПОЛИТИЧЕСКИЕ ----------
  pol_repression:                { economy:[0,0],   military:[0,1],  stability:[1,3],  diplomacy:[-2,0], approval:[-5,-2], elite_satisfaction:[2,4],  corruption:[1,3],  middle_class:[-2,0], lower_class_mood:[-3,-1], gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[1,2],  equipment:[0,0],  readiness:[1,2],  veterans:[0,0],  ally_trust:[-2,-1],isolation:[2,3]  },
  pol_liberalization:            { economy:[0,0],   military:[0,0],  stability:[-1,2], diplomacy:[1,2],  approval:[-1,3],  elite_satisfaction:[-3,0], corruption:[-2,0], middle_class:[2,4],  lower_class_mood:[2,4],   gdp_growth:[0,2],  inflation:[-1,0], employment:[1,2],  reserves:[0,0],  army_morale:[-1,0], equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[1,3],  isolation:[-2,-1]  },
  pol_elite_consolidation:       { economy:[0,0],   military:[0,1],  stability:[1,2],  diplomacy:[0,0],  approval:[-2,0],  elite_satisfaction:[2,4],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[-1,0],  gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,1],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,0],  isolation:[0,0]  },
  pol_social:                    { economy:[0,0],  military:[0,0],  stability:[1,3],  diplomacy:[0,0],  approval:[2,4],   elite_satisfaction:[-1,1], corruption:[0,0],  middle_class:[1,3],  lower_class_mood:[2,4],   gdp_growth:[0,1],  inflation:[0,1],  employment:[0,1],  reserves:[-1,0], army_morale:[0,0],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[0,0],  isolation:[0,0]  },

  // ---------- УКАЗЫ: ИНФОРМАЦИОННЫЕ ----------
  pol_propaganda:                 { economy:[0,0],   military:[0,0],  stability:[0,2],  diplomacy:[-1,2], approval:[1,3],   elite_satisfaction:[0,1],  corruption:[0,1],  middle_class:[0,0],  lower_class_mood:[1,3],   gdp_growth:[0,0],  inflation:[0,0],  employment:[0,0],  reserves:[0,0],  army_morale:[0,2],  equipment:[0,0],  readiness:[0,0],  veterans:[0,0],  ally_trust:[-1,1], isolation:[0,1]  },

  // ---------- ВНЕ ДОМЕННОЙ СЕТКИ (без изменений) ----------
  military_regroup:            { economy:[0,0],   military:[0,1],  stability:[1,2],  diplomacy:[0,0],  approval:[0,1],   elite_satisfaction:[0,1],  corruption:[0,0],  middle_class:[0,0],  lower_class_mood:[0,1],   gdp_growth:[0,1],  inflation:[-1,0], employment:[0,0],  reserves:[0,1],  army_morale:[3,5],  equipment:[1,3],  readiness:[2,4],  veterans:[1,2],  ally_trust:[0,0],  isolation:[0,0]  },
  null_action:                  { economy:[-3,-1], military:[-2,-1],stability:[-2,-1],diplomacy:[-1,0], approval:[-3,-1], elite_satisfaction:[-2,-1],corruption:[0,2],  middle_class:[-2,-1],lower_class_mood:[-2,-1], gdp_growth:[-2,-1],inflation:[0,2],  employment:[-2,-1],reserves:[-2,-1],army_morale:[-2,-1],equipment:[-2,-1],readiness:[-2,-1],veterans:[0,0],  ally_trust:[-2,-1],isolation:[0,2]},
  nuclear_strike:               { economy:[-25,-20],military:[3,8],stability:[-30,-25],diplomacy:[-40,-35],approval:[-20,-15],elite_satisfaction:[-15,-10],corruption:[5,10],middle_class:[-20,-15],lower_class_mood:[-25,-20], gdp_growth:[-25,-20],inflation:[15,25],employment:[-20,-15],reserves:[-20,-15],army_morale:[5,10],equipment:[-5,-2],readiness:[5,10],veterans:[-5,-2],ally_trust:[-30,-25],isolation:[25,35]},
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
// Параметризовано таблицей/лимитами (Петя, 2026-07-06: "полная симметрия для Украины" — второй
// актор нуждается в своей таблице категорий, но с той же самой детерминированной формулой).
// computeStatDelta ниже — тонкая обёртка с ТЕМИ ЖЕ аргументами, что и раньше: оба существующих
// вызова в этом файле не тронуты, поведение идентично (см. regression guard в HANDOFF.md).
function computeStatDeltaFromTable(table, { category, stat, severity, seed }, maxDeltaTable = MAX_DELTA_PER_TURN) {
  const range = table[category]?.[stat];
  if (!range) return 0;
  const [min, max] = range;
  if (min === 0 && max === 0) return 0;

  const baseMultiplier = SEVERITY_MULTIPLIER[severity];
  // Небольшой детерминированный сдвиг ±0.1 вокруг базового множителя
  const jitter = (seededFraction(seed + stat) - 0.5) * 0.2;
  const effectiveMultiplier = Math.min(1, Math.max(0, baseMultiplier + jitter));

  const raw = min + (max - min) * effectiveMultiplier;
  const capped = Math.max(-maxDeltaTable[stat], Math.min(maxDeltaTable[stat], raw));
  return Math.round(capped);
}
function computeStatDelta(args) {
  return computeStatDeltaFromTable(RULES_TABLE, args, MAX_DELTA_PER_TURN);
}

/**
 * Применяет дельту к одному показателю с зажимом в [0, 100].
 */
function applyClamped(currentValue, delta) {
  return Math.max(0, Math.min(100, currentValue + delta));
}

/**
 * Бросок раскрытия тайной операции (covert_*). Seeded — детерминированный,
 * НЕ Math.random(). Возвращает true, если операция раскрыта.
 */
function rollExposure({ exposureRisk, gameId, turnNumber, actionType }) {
  const chance = EXPOSURE_RISK_CHANCE[exposureRisk] ?? EXPOSURE_RISK_CHANCE.medium;
  const seed = `${gameId}:${turnNumber}:${actionType}:exposure`;
  return seededFraction(seed) < chance;
}

/**
 * Вычисляет изменение peace_progress на основе типа действия.
 * Военное наступление ВСЕГДА откатывает мирный трек — независимо от силы армии.
 */
function computePeaceProgressDelta({ action_type, severity, armyValue, seed }) {
  const sevMultiplier = { 1: 0.5, 2: 0.8, 3: 1.0 }[severity] || 0.8;
  const jitter = (seededFraction(seed + "peace") - 0.5) * 0.3;
  const eff = Math.min(1, Math.max(0, sevMultiplier + jitter));

  if (action_type === "diplo_peace") return Math.round(10 + 10 * eff); // +10..+20
  if (action_type === "diplo_negotiate") return Math.round(4 + 4 * eff); // +4..+8
  if (CATEGORY_GROUP.military_offensive_like.has(action_type)) {
    return -Math.round(5 + 7 * eff); // -5..-12
  }
  if (CATEGORY_GROUP.military_defensive_like.has(action_type)) return Math.round(1 + 2 * eff); // +1..+3
  if (action_type === "diplo_pressure") return Math.round(-(3 + 4 * eff)); // -3..-7
  if (action_type === "pol_repression") return Math.round(-(2 + 3 * eff)); // -2..-5
  if (action_type === "nuclear_strike") return -40;
  if (action_type === "null_action") return -2;
  return 0;
}

const TERRITORY_KEYS = ["donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"];
const TERRITORY_HARDNESS = { donetsk: 1.0, luhansk: 0.6, zaporizhzhia: 1.2, kherson: 1.3, kharkiv: 1.5 };

/**
 * Территориальный контроль (захват/откат фронта) — раньше жил только внутри /turns/confirm
 * в turns.js и использовал Math.random(), поэтому /turns/preview не мог его посчитать: тот же
 * бросок кубика дал бы ДРУГОЕ число при подтверждении, честного превью не получилось бы (см.
 * принцип "то, что видит игрок в превью, должно совпадать 1:1 с confirm" — applyTurn выше).
 * Вынесено сюда и переведено на seededFraction (сид = gameId:turnNumber:action_type:territory) —
 * теперь preview и confirm с одинаковым сидом дают одинаковый результат. Не мутирует stats,
 * возвращает { deltas, moraleDelta }.
 */
function computeTerritoryDelta({ stats, action_type, severity, actionMode, gameId, turnNumber, aiCounterattack }) {
  const seed = `${gameId}:${turnNumber}:${action_type}:territory`;
  const sev = severity || 2;
  const next = {}; // key -> уже посчитанное новое значение в рамках этого вызова
  const get = (key, fallback) => (next[key] !== undefined ? next[key] : (stats[key] ?? fallback));

  const isOffensiveLike = CATEGORY_GROUP.military_offensive_like.has(action_type);
  const isDefensiveLike = CATEGORY_GROUP.military_defensive_like.has(action_type);
  const isDiplomaticLike = CATEGORY_GROUP.diplomatic_activity.has(action_type) || actionMode === "diplomacy_op";

  if (isOffensiveLike) {
    // Прогресс зависит от армии и severity. Опыт войск (veterans) — обстрелянные части
    // эффективнее берут территорию независимо от текущего духа/техники.
    const armyQuality = ((stats.army_morale ?? 50) + (stats.readiness ?? 50) + (stats.equipment ?? 50) + (stats.veterans ?? 50)) / 4;
    const baseGain = sev * 3 + Math.max(0, (armyQuality - 60) / 5); // 3-12 pts
    for (const key of TERRITORY_KEYS) {
      const regionName = key.replace("_control", "");
      const hardness = TERRITORY_HARDNESS[regionName] || 1.0;
      const current = get(key, 50);
      if (current < 100) {
        // Труднее брать уже занятые территории и более укреплённые
        const effectiveness = Math.max(0.1, 1 - (current / 100) * 0.5);
        const gain = Math.round((baseGain / hardness) * effectiveness);
        next[key] = Math.min(100, current + Math.max(1, gain));
      }
    }
  } else if (isDefensiveLike) {
    // Оборона — удержание. Небольшое восстановление потерянных позиций
    for (const key of TERRITORY_KEYS) {
      const current = get(key, 50);
      if (current < 60 && current > 0) {
        next[key] = Math.min(60, current + 2);
      }
    }
  } else if (isDiplomaticLike) {
    // Мирный/дипломатический трек — небольшие уступки на спорных территориях
    const concession = sev === 3 ? 4 : sev === 2 ? 2 : 1;
    for (const key of ["kharkiv_control", "kherson_control"]) {
      const current = get(key, 50);
      // Уступаем только спорное — не более 20 пунктов за всю игру
      if (current > 5) {
        next[key] = Math.max(5, current - concession);
      }
    }
  } else if (action_type === "diplo_pressure") {
    // Жёсткая риторика — обострение, мелкие тактические потери
    const current = get("kharkiv_control", 12);
    next.kharkiv_control = Math.max(0, current - 3);
  } else if (action_type === "null_action") {
    // Бездействие — контрнаступление Украины на спорных направлениях
    for (const key of ["kharkiv_control", "kherson_control"]) {
      const current = get(key, 50);
      next[key] = Math.max(0, current - 3);
    }
    next.zaporizhzhia_control = Math.max(0, get("zaporizhzhia_control", 68) - 1);
  }

  // --- Украинское сопротивление при наступлении ---
  // Каждый offensive — ВСУ и союзники контратакуют: случайный откат 1-3 территорий
  let moraleDelta = 0;
  let counterattack = null;
  if (isOffensiveLike) {
    // Опытные части лучше держат удар при контратаке — тоже снижает интенсивность отката.
    const armyQuality = ((stats.army_morale ?? 50) + (stats.readiness ?? 50) + (stats.veterans ?? 50)) / 3;
    // Интенсивность ответа зависит от западной поддержки (diplomacy_vs_west прокси = relations с США/ЕС)
    const baseResistanceIntensity = Math.max(1, Math.round(3 - (armyQuality - 50) / 20));
    // Эскалация "западное вооружение" (2026-07-11, Петя: "усложнить добычу военной победы" —
    // см. checkWesternArmsEscalation) — пока действует perk_ua_western_arms_turns, ВСУ
    // контратакует ощутимо жёстче поверх обычной формулы, а не просто "тем же слабым откатом
    // на постоянно подавляющую армию". Отдельная переменная (не смешана с базовой формулой),
    // чтобы MAX_RESISTANCE ниже мог явно показать игроку, что сейчас действует бафф.
    const westernArmsBonus = (stats.perk_ua_western_arms_turns ?? 0) > 0 ? 1 : 0;
    const maxResistanceIntensity = 3 + (westernArmsBonus > 0 ? 1 : 0);
    const resistanceIntensity = Math.min(maxResistanceIntensity, baseResistanceIntensity + westernArmsBonus);
    // БАЛАНС (2026-07-04): раньше контратака могла зацепить только Харьков/Херсон/Запорожье —
    // Донецк и Луганск (основная ось наступления) не встречали сопротивления НИКОГДА, независимо
    // от интенсивности боёв, из-за чего наступление там ощущалось как беспрепятственное. Теперь
    // ВСУ может контратаковать на любом фронте.
    const contestedKeys = TERRITORY_KEYS;
    // Экспериментальный ИИ-противник (2026-07-11, Петя: "хочу для теста посмотреть, как будет
    // ощущаться живой противник" — см. ai/ukraine-counterattack-ai.js, тумблер
    // UKRAINE_AI_COUNTERATTACK_ENABLED). aiCounterattack уже провалидирован/зажат вызывающим
    // кодом (turns.js) ДО этого вызова — здесь просто используем готовые значения вместо
    // детерминированной перетасовки. Если параметр не передан (тумблер выключен или ИИ-вызов не
    // удался — трёхуровневый fallback тот же принцип, что у generateUkraineActionV2), поведение
    // ПОЛНОСТЬЮ идентично прежнему детерминированному расчёту.
    let shuffled, pushbackByKey;
    if (aiCounterattack) {
      shuffled = aiCounterattack.contestedKeys;
      pushbackByKey = aiCounterattack.pushbackByKey;
    } else {
      const numContested = Math.min(contestedKeys.length, 1 + Math.floor(seededFraction(seed + ":count") * resistanceIntensity));
      // Детерминированная "перетасовка": сортируем по сидованному скору вместо Math.random()+sort.
      shuffled = contestedKeys
        .map(k => ({ k, score: seededFraction(seed + ":shuffle:" + k) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, numContested)
        .map(x => x.k);
      pushbackByKey = {};
      for (const key of shuffled) {
        pushbackByKey[key] = Math.round(1 + seededFraction(seed + ":pushback:" + key) * resistanceIntensity);
      }
    }
    // Пушбэк по каждому ключу считаем ДО того как он смешается с наступательным приростом того
    // же ключа в next[] — иначе игрок видит только НЕТТО-число (прирост минус откат) и не может
    // понять, что армия вообще отбивала контратаку (Петя, 2026-07-11: "должно быть окно о том,
    // что она контратакует, но вследствие моей мощной армии ВСУ обламываются — чтоб я получал
    // отдачу от укрепления армии").
    for (const key of shuffled) {
      const current = get(key, 0);
      next[key] = Math.max(0, current - pushbackByKey[key]);
    }
    // Потери от боёв: армейский моральный откат
    moraleDelta = -Math.round(1 + seededFraction(seed + ":morale") * 3);
    counterattack = {
      armyQuality: Math.round(armyQuality),
      resistanceIntensity,
      maxResistanceIntensity,
      westernArmsActive: westernArmsBonus > 0,
      pushbackByKey,
      totalPushback: Object.values(pushbackByKey).reduce((a, b) => a + b, 0),
      aiDriven: !!aiCounterattack,
      aiNarrative: aiCounterattack?.narrative || null,
    };
  }

  const deltas = {};
  for (const [key, val] of Object.entries(next)) {
    const before = stats[key] ?? 50;
    if (val !== before) deltas[key] = val - before;
  }
  return { deltas, moraleDelta, counterattack };
}

// Эскалация "западное вооружение" (2026-07-11, Петя: "усложнить добычу военной победы" — если
// армия игрока подавляющая (~100) и контратака ВСУ раз за разом безуспешна, Запад поставляет
// новое вооружение). Чисто детерминированная лестница-триггер — тот же принцип, что уже работает
// для дебаффов Башен Кремля (FACTION_DEBUFF_LADDER), без ИИ-звонков.
const WESTERN_ARMS_ARMY_QUALITY_THRESHOLD = 85; // та же armyQuality, что определяет resistanceIntensity выше
const WESTERN_ARMS_WEAK_PUSHBACK_THRESHOLD = 2; // суммарный откат ≤ этого — контратака "провалилась"
const WESTERN_ARMS_STREAK_TRIGGER = 2;          // столько подряд провальных контратак — триггер
const WESTERN_ARMS_PERK_TURNS = 6;              // на сколько ходов усиливается контратака ВСУ
const WESTERN_ARMS_ARMY_BOOST = 15;
const WESTERN_ARMS_SUPPORT_BOOST = 10;

// Вызывается ПОСЛЕ computeTerritoryDelta, только когда был offensive-ход (counterattack != null).
// Чисто функция — читает streak из stats, возвращает решение, мутацию стата делает вызывающий
// код (turns.js), как и везде в этом модуле.
function checkWesternArmsEscalation(stats, counterattack) {
  if (!counterattack) return null;
  const dominant = counterattack.armyQuality >= WESTERN_ARMS_ARMY_QUALITY_THRESHOLD;
  const weakPushback = counterattack.totalPushback <= WESTERN_ARMS_WEAK_PUSHBACK_THRESHOLD;
  const prevStreak = stats.ua_failed_counterattack_streak ?? 0;
  const newStreak = (dominant && weakPushback) ? prevStreak + 1 : 0;

  if (newStreak < WESTERN_ARMS_STREAK_TRIGGER) {
    return { newStreak, triggered: false };
  }
  return {
    newStreak: 0, // сброс — эскалация может повториться позже, если давление продолжится
    triggered: true,
    shipmentNumber: (stats.ua_western_arms_shipments ?? 0) + 1,
  };
}

/**
 * Основная функция: берёт текущий state, классификацию от ИИ,
 * возвращает новый state + объект дельт (для отображения игроку).
 */
function applyTurn({ state, gmClassification, gameId, turnNumber, actionMode = "decree", crisisMode = false, regenInitiative = true, revealCovertOutcome = true }) {
  const { action_type, severity } = gmClassification;
  const seed = `${gameId}:${turnNumber}:${action_type}`;

  const statDeltas = {};
  // Часть эффекта Реформы/Программы, отложенная на потом — см. TIER_SPLIT. Заполняется в
  // основном цикле по RULES_TABLE ниже, возвращается вызывающему коду (turns.js), который
  // сохраняет их в тот же delayed_effects, что уже используют "эхо"-эффекты от ИИ.
  const tierDelayedEffects = [];
  // Инициализируем субметрики дефолтами если отсутствуют
  const newStats = { ...SUBSTAT_DEFAULTS, ...state.stats };

  // Инициатива: регенерация → трата.
  // В мульти-режиме (несколько действий за месяц) регенерация НЕ применяется здесь —
  // инициатива работает как бюджет месяца и восстанавливается только в конце месяца.
  const currentInitiative = typeof newStats.initiative === "number" ? newStats.initiative : INITIATIVE_MAX;
  const regen = regenInitiative ? (crisisMode ? INITIATIVE_REGEN_CRISIS : INITIATIVE_REGEN_PER_TURN) : 0;
  // Carryover-бонус может поднять инициативу выше 100 (до 130) — не срезаем её при regen=0.
  // Срезаем только при рефилле (regen > 0) чтобы не превысить INITIATIVE_MAX в одиночном режиме.
  const regenedInitiative = regen > 0 ? Math.min(INITIATIVE_MAX, currentInitiative + regen) : currentInitiative;
  // Стоимость по конкретной категории (военные/дипломатия/шпионаж) приоритетнее стоимости по режиму
  // (указы/crisis/regroup) — см. CATEGORY_COST.
  const categoryCost = CATEGORY_COST[action_type];
  let cost = categoryCost ? categoryCost.initiative : (INITIATIVE_COST[actionMode] ?? INITIATIVE_COST.decree);
  // Бафф карточки-дилеммы «встать на сторону Силовиков» (см. FACTION_DILEMMAS) — силовики берут
  // оргнагрузку на себя, военные категории временно дешевле по инициативе.
  if ((newStats.perk_mil_initiative_discount_turns ?? 0) > 0 && CATEGORY_GROUP.military_operations.has(action_type)) {
    cost = Math.round(cost * 0.7);
  }
  newStats.initiative = Math.max(0, regenedInitiative - cost);
  statDeltas.initiative = newStats.initiative - currentInitiative;

  // Казна: списываем стоимость действия деньгами (может уходить в дефицит).
  // + КОРРУПЦИОННАЯ УТЕЧКА: часть средств разворовывается пропорционально уровню коррупции.
  const budgetCost = categoryCost ? categoryCost.treasury : (ACTION_BUDGET_COST[actionMode] ?? 0);
  let corruptionLeakAmount = 0;
  if (budgetCost) {
    const currentTreasury = typeof newStats.treasury === "number" ? newStats.treasury : 52;
    const corruptionLevel = (newStats.corruption ?? 68) / 100;
    // Утечка: от 0% (коррупция 0) до 30% (коррупция 100). Только для дорогих действий.
    if (budgetCost >= 5) {
      corruptionLeakAmount = Math.floor(budgetCost * corruptionLevel * 0.3);
    }
    newStats.treasury = Math.max(TREASURY_MIN, currentTreasury - budgetCost - corruptionLeakAmount);
    statDeltas.treasury = newStats.treasury - currentTreasury;
  }

  // ВОЕННЫЙ СТРИК: убывающая отдача от повторных наступательных операций
  const isMilitaryOffensiveLike = CATEGORY_GROUP.military_offensive_like.has(action_type);
  const prevStreak = typeof newStats.military_streak === "number" ? newStats.military_streak : 0;
  if (isMilitaryOffensiveLike) {
    newStats.military_streak = prevStreak + 1;
  } else if (action_type !== "military_regroup") {
    // Любое не-наступательное действие (кроме перегруппировки) сбрасывает стрик
    newStats.military_streak = 0;
  }
  // Штраф за усталость: начиная со 2-й наступательной операции подряд
  let militaryFatiguePenalty = 0;
  if (isMilitaryOffensiveLike && prevStreak >= MILITARY_FATIGUE_THRESHOLD) {
    militaryFatiguePenalty = prevStreak - MILITARY_FATIGUE_THRESHOLD + 1; // +1 за каждую лишнюю
  }

  // Peace progress — отдельная механика мирного трека
  const currentPeaceProgress = typeof state.stats.peace_progress === "number" ? state.stats.peace_progress : 0;
  const peaceArmyValue = newStats.military ?? 50;
  const peaceDelta = computePeaceProgressDelta({ action_type, severity, armyValue: peaceArmyValue, seed });
  const newPeaceProgress = Math.max(0, Math.min(100, currentPeaceProgress + peaceDelta));
  newStats.peace_progress = newPeaceProgress;
  statDeltas.peace_progress = peaceDelta;

  // Множитель силы по тиру указа (fast<reform<program); для прочих режимов = 1.
  const tierMult = TIER_MULTIPLIER[actionMode] ?? 1.0;
  // Разведбонус: mil_recon усиливает ПОЛОЖИТЕЛЬНЫЕ эффекты следующей боевой операции
  // (не любого хода вообще — конкретно военной). Бонус разовый — расходуется здесь.
  const isMilRecon = action_type === "mil_recon";
  const isMilitaryCombat = CATEGORY_GROUP.military_combat.has(action_type);
  const intelBoostActive = (state.stats.next_action_boost ?? 0) > 0 && isMilitaryCombat;
  const effMult = (delta) => {
    let d = delta * tierMult;
    if (intelBoostActive && delta > 0) d *= INTEL_BOOST_FACTOR;
    return Math.round(d);
  };

  // Коррупционный штраф на позитивные эффекты указов/реформ
  const corruptionPenalty = (newStats.corruption ?? 68) / 100 * 0.12; // до 12% потерь при max коррупции

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
      let delta = (tierMult !== 1.0 || intelBoostActive) ? effMult(baseDelta) : baseDelta;

      // Штраф военной усталости: уменьшает положительные эффекты наступательных операций
      if (isMilitaryOffensiveLike && militaryFatiguePenalty > 0 && delta > 0) {
        const fatigueReduction = Math.min(0.45, militaryFatiguePenalty * 0.15); // -15% за каждую лишнюю операцию, макс -45%
        delta = Math.round(delta * (1 - fatigueReduction));
      }
      // Усталость сверх порога: армия получает прямые штрафы
      if (isMilitaryOffensiveLike && prevStreak >= MILITARY_FATIGUE_THRESHOLD + 1) {
        if (stat === "army_morale") delta = Math.min(delta, -3);
        if (stat === "readiness") delta = Math.min(delta, -2);
      }

      // Коррупция снижает позитивные эффекты указов/реформ (не военных)
      if (!isMilitaryOffensiveLike && delta > 0 && corruptionPenalty > 0 &&
          ["decree_fast","decree_reform","decree_program","diplomacy_op"].includes(actionMode)) {
        delta = Math.round(delta * (1 - corruptionPenalty));
      }

      statDeltas[stat] = delta;
      newStats[stat] = applyClamped(state.stats[stat], delta);
    }
  }

  // Реформа/Программа: часть эффекта откладывается на потом — см. TIER_SPLIT выше. Работает
  // ПОСЛЕ основного цикла (не внутри него), чтобы взять только 3 самых заметных стата вместо
  // всех подряд — тот же порог заметности (|delta|>=2, топ-3 по модулю), что уже использует
  // "Цена вопроса" в советах (describeSideEffects, advisors.js) — иначе на одну реформу
  // приходилось бы по 6-8 отдельных будущих анонсов в Ленте, а не понятный один-два.
  const tierSplit = TIER_SPLIT[actionMode];
  if (tierSplit) {
    const candidates = Object.keys(MAX_DELTA_PER_TURN)
      .filter(stat => stat !== "peace_progress" && Math.abs(statDeltas[stat] ?? 0) >= 2)
      .sort((a, b) => Math.abs(statDeltas[b]) - Math.abs(statDeltas[a]))
      .slice(0, 3);
    for (const stat of candidates) {
      const delta = statDeltas[stat];
      const immediateDelta = Math.round(delta * tierSplit.immediateShare);
      const delayedDelta = delta - immediateDelta;
      if (delayedDelta === 0) continue;
      statDeltas[stat] = immediateDelta;
      newStats[stat] = applyClamped(state.stats[stat], immediateDelta);
      tierDelayedEffects.push({ stat, delta: delayedDelta, trigger_turn: turnNumber + tierSplit.offsetTurns });
    }
  }

  // ВТОРИЧНАЯ КАТЕГОРИЯ: ИИ иногда распознаёт, что ход несёт доп. характер сверх основной
  // категории (напр. дипломатический ультиматум Украине с реальной военной угрозой —
  // action_type=diplo_pressure, secondary_category=mil_strategic_offensive), но раньше это
  // поле нигде не влияло на статы — только на текст нарратива (Петя: "усиль эффект"). Теперь
  // накладываем ослабленную (35%) дельту вторичной категории поверх основной — независимый
  // детерминированный бросок (свой сид), без штрафов усталости/коррупции основного цикла
  // (это лёгкий довесок, не полноценное второе действие).
  const secondaryCategory = gmClassification.secondary_category;
  if (secondaryCategory && secondaryCategory !== action_type && action_type !== "nuclear_strike" && RULES_TABLE[secondaryCategory]) {
    const SECONDARY_WEIGHT = 0.35;
    const secondarySeed = `${seed}:secondary`;
    for (const stat of Object.keys(MAX_DELTA_PER_TURN)) {
      if (stat === "peace_progress") continue;
      const secDelta = Math.round(computeStatDelta({ category: secondaryCategory, stat, severity, seed: secondarySeed }) * SECONDARY_WEIGHT);
      if (!secDelta) continue;
      statDeltas[stat] = (statDeltas[stat] ?? 0) + secDelta;
      newStats[stat] = applyClamped(newStats[stat], secDelta);
    }
  }

  // ШПИОНАЖ: exposure_risk — раскрытие тайной операции (covert_*). Обычные дельты выше
  // уже применены как «операция состоялась» — здесь добавляется ШТРАФ ПОВЕРХ них,
  // если бросок (seeded) попал в диапазон риска, заявленного ИИ.
  // revealCovertOutcome=false в preview: игрок НЕ должен видеть исход раскрытия ДО подписи
  // приказа — иначе можно отменить ход и переформулировать, зная заранее, что операцию
  // «спалят» (та же дыра, что была у старого intel_success/failure — он писал исход
  // прямо в narrative preview, это был читерский reroll). Раскрытие считается и
  // применяется ТОЛЬКО при confirm, один раз, без возможности отмены после решения.
  if (CATEGORY_GROUP.covert_ops.has(action_type) && revealCovertOutcome) {
    const exposed = rollExposure({
      exposureRisk: gmClassification.exposure_risk || "medium",
      gameId, turnNumber, actionType: action_type,
    });
    statDeltas.exposed = exposed;
    if (exposed) {
      const diploPenalty = -3;
      const stabPenalty = -1;
      newStats.diplomacy = applyClamped(newStats.diplomacy, diploPenalty);
      newStats.stability = applyClamped(newStats.stability, stabPenalty);
      statDeltas.diplomacy = (statDeltas.diplomacy ?? 0) + diploPenalty;
      statDeltas.stability = (statDeltas.stability ?? 0) + stabPenalty;
    }
  }

  // Записываем размер утечки для отображения в UI и в statDeltas (для preview)
  if (corruptionLeakAmount > 0) {
    newStats._corruption_leak = corruptionLeakAmount;
    statDeltas._corruption_leak = corruptionLeakAmount;
  } else {
    delete newStats._corruption_leak;
  }
  // Пишем текущий стрик в statDeltas чтобы preview мог показать предупреждение
  statDeltas.military_streak = newStats.military_streak ?? 0;

  // Флаг: действие снизило коррупцию → пассивный рост в end-month отменяется.
  if ((statDeltas.corruption ?? 0) < 0) {
    newStats.anti_corruption_this_month = true;
  }

  // Учёт разведбонуса: mil_recon ставит бонус на следующую боевую операцию; сама боевая
  // операция (не recon) — расходует.
  if (isMilRecon) {
    newStats.next_action_boost = 1;
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

  // ПРЯМАЯ ЦЕНА ДЛЯ УКРАИНЫ от этого конкретного указа (см. комментарий у UA_IMPACT_FROM_PLAYER
  // выше) — военные/тайные операции против Украины напрямую бьют по ua_army/ua_morale/
  // ua_stability, видимо сразу в statDeltas этого хода.
  const uaImpactTable = UA_IMPACT_FROM_PLAYER[action_type];
  if (uaImpactTable) {
    for (const stat of Object.keys(uaImpactTable)) {
      const delta = computeStatDeltaFromTable(
        { [action_type]: uaImpactTable },
        { category: action_type, stat, severity, seed: seed + ":ua" },
        UA_IMPACT_MAX_DELTA_PER_TURN
      );
      if (delta) {
        const before = newStats[stat] ?? SUBSTAT_DEFAULTS[stat] ?? 50;
        newStats[stat] = Math.max(0, Math.min(100, before + delta));
        statDeltas[stat] = (statDeltas[stat] ?? 0) + delta;
      }
    }
  }
  // Удар по союзникам Украины (санкционный обход, дипломатическое давление и т.п.) частично
  // размывает её западную поддержку — переиспользует уже посчитанные relationDeltas выше.
  for (const rd of relationDeltas) {
    if (rd.delta < 0 && UA_ALLY_COUNTRIES.has(rd.country)) {
      const westHit = Math.round(rd.delta * 0.4); // 40% удара по союзнику долетает до ua_west_support
      if (westHit) {
        const cappedHit = Math.max(-UA_IMPACT_MAX_DELTA_PER_TURN.ua_west_support, westHit);
        const before = newStats.ua_west_support ?? SUBSTAT_DEFAULTS.ua_west_support ?? 75;
        newStats.ua_west_support = Math.max(0, Math.min(100, before + cappedHit));
        statDeltas.ua_west_support = (statDeltas.ua_west_support ?? 0) + cappedHit;
      }
    }
  }

  // Башни Кремля: реакция на statDeltas, посчитанные этим же ходом (см. computeFactionReactions
  // выше) — считается ПОСЛЕДНЕЙ, чтобы видеть полную картину дельт хода, включая цену для Украины.
  {
    const reactions = computeFactionReactions(statDeltas);
    for (const k of FACTION_KEYS) {
      const delta = reactions[k];
      if (!delta) continue;
      const before = typeof newStats[k] === "number" ? newStats[k] : SUBSTAT_DEFAULTS[k];
      newStats[k] = Math.max(0, Math.min(100, before + delta));
      statDeltas[k] = newStats[k] - before;
    }
  }

  // Заголовок политики (если ИИ зарегистрировал новую — почти всегда так для decree_reform/
  // decree_program) как текст для будущего анонса в Ленте, когда tierDelayedEffects сработают
  // (см. turns.js) — тот же принцип, что уже есть у "эхо"-эффектов ИИ (у них есть свой reason).
  if (tierDelayedEffects.length > 0) {
    const policyTitle = gmClassification.policy_update?.title || null;
    for (const e of tierDelayedEffects) e.reason = policyTitle;
  }

  return {
    newStats,
    newRelations,
    statDeltas,
    relationDeltas,
    tierDelayedEffects,
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

// --- ОТВЕТ НА ДЕЙСТВИЕ УКРАИНЫ (defend/retaliate/accept) ---
// БАЛАНС (2026-07-04): раньше два независимых бэкенд-пути реализовывали ОДНО И ТО ЖЕ решение
// по-разному: backend/src/routes/games.js (POST /games/:gameId/ukraine-response, вызывается
// полноэкранным UkraineResponseScreen после конца месяца) — 3-уровневый вероятностный ролл,
// БЕЗ цены инициативы и БЕЗ риска войны-эскалации; backend/src/routes/turns.js (POST
// /turns/ukraine/respond, вызывается инлайн-карточкой в Ленте) — фиксированный (не
// вероятностный) эффект, СТОИТ инициативы (defend −10, retaliate −20) и двигает
// war_escalation_counter при retaliate (счётчик, триггерящий defeat_war на 3). Итог: одно и то
// же решение ("нанести ответный удар") было строго безопаснее через один экран, чем через
// другой — рассинхрон маршрута, а не осознанный выбор игрока. Общая функция ниже — единственный
// источник истины для ОБОИХ путей: вероятностный разброс (интереснее фиксированного) + цена
// инициативы/риск войны (реальные последствия, независимо от того, каким экраном отвечаешь).
const UA_RESPONSE_TIERS = {
  defend: {
    initiativeCost: 10,
    tiers: [
      { prob: 0.55, delta: { economy: 0, stability: 1 }, outcome: "positive", text: "Оборонные меры сработали — часть ущерба нейтрализована." },
      { prob: 0.30, delta: { economy: -1, military: -1 }, outcome: "mixed", text: "Оборонные меры частично снизили ущерб." },
      { prob: 0.15, delta: { economy: -1, approval: -1 }, outcome: "negative", text: "Оборонные меры не дали результата — население разочаровано." },
    ],
  },
  retaliate: {
    initiativeCost: 20,
    warEscalationDelta: 1,
    tiers: [
      { prob: 0.35, delta: { military: 2, approval: 2, army_morale: 2 }, outcome: "positive", text: "Ответный удар достиг целей — армия воодушевлена, рейтинг вырос." },
      { prob: 0.30, delta: { military: 1, diplomacy: -2 }, outcome: "mixed", text: "Удар нанесён, но международная реакция ухудшила дипломатический климат." },
      { prob: 0.35, delta: { diplomacy: -3, stability: -1, peace_progress: -5 }, outcome: "negative", text: "Ответный удар спровоцировал эскалацию — западные партнёры заморозили контакты." },
    ],
  },
  accept: {
    initiativeCost: 0,
    tiers: [
      { prob: 0.25, delta: { approval: -1 }, outcome: "negative", text: "Бездействие замечено — рейтинг слегка просел." },
      { prob: 0.75, delta: {}, outcome: "neutral", text: "Ситуация стабилизируется сама по себе." },
    ],
  },
};
// БАЛАНС (2026-07-04): раньше бросок здесь был Math.random() — единственное место в модуле,
// нарушавшее собственный же принцип детерминизма (см. комментарий к seededFraction выше):
// один и тот же (responseType, seed) должен давать один и тот же результат для честного
// сравнения партий, а не зависеть от того, в какой момент вызван Math.random(). seed передаёт
// вызывающий код (gameId:turnN:responseType) — он же используется остальными seeded-функциями.
function resolveUkraineResponse(responseType, seed) {
  if (!seed) {
    // Раньше здесь был молчаливый fallback на Math.random() — он нарушал бы детерминизм
    // без единого предупреждения, если вызывающий код когда-нибудь забудет передать seed.
    throw new Error("resolveUkraineResponse: seed is required (детерминизм: gameId:turnN:responseType)");
  }
  const config = UA_RESPONSE_TIERS[responseType] || UA_RESPONSE_TIERS.accept;
  const roll = seededFraction(`${seed}:uaResponse`);
  let cumulative = 0;
  let picked = config.tiers[config.tiers.length - 1];
  for (const tier of config.tiers) {
    cumulative += tier.prob;
    if (roll < cumulative) { picked = tier; break; }
  }
  return {
    delta: { ...picked.delta },
    outcome: picked.outcome,
    outcomeText: picked.text,
    initiativeCost: config.initiativeCost || 0,
    warEscalationDelta: config.warEscalationDelta || 0,
  };
}

// БАШНИ КРЕМЛЯ: карточки-дилеммы ("Придворная интрига"). Детерминированный, НЕ ИИ-генерируемый
// пул — 4 конфликта, покрывающие все 6 попарных сочетаний 4 башен минус самые редко
// конфликтующие пары (Силовики/Консерваторы обычно на одной стороне, отдельный конфликт для
// них не заводим, чтобы не плодить контент без реальной ролевой разницы).
// Каждая дилемма: optionA/optionB — "встать на сторону" (вероятностные тиры, сильный крен
// лояльности + уникальный бафф той башни), compromise — гарантированный слабый эффект +
// небольшой равномерный крен лояльности + бонус к стабильности + вклад в coalition_stability.
const FACTION_DILEMMAS = {
  budget_standoff: {
    factions: ["faction_siloviki", "faction_tehnokraty"],
    optionA: {
      tiers: [
        { prob: 0.7, delta: { military: 4, stability: -2, approval: -2 } },
        { prob: 0.3, delta: { military: 2, stability: -3, approval: -3 } },
      ],
      loyalty: { faction_siloviki: 18, faction_tehnokraty: -16, faction_oligarhi: -6 },
      perk: { perk_mil_initiative_discount_turns: 2 },
    },
    optionB: {
      tiers: [
        { prob: 0.7, delta: { economy: 3, readiness: -1 } },
        { prob: 0.3, delta: { economy: 1, military: -2, readiness: -3 } },
      ],
      loyalty: { faction_tehnokraty: 18, faction_siloviki: -16, faction_oligarhi: 4 },
      perk: { perk_corruption_audit_turns: 2 },
    },
    compromise: {
      delta: { military: 1, economy: 1, stability: 2 },
      loyalty: { faction_siloviki: 4, faction_tehnokraty: 4, faction_oligarhi: 2 },
    },
  },
  sanctions_relief: {
    factions: ["faction_oligarhi", "faction_konservatory"],
    optionA: { // встать на сторону Олигархов — зондаж по снятию санкций
      tiers: [
        { prob: 0.6, delta: { isolation: -4, economy: 2 } },
        { prob: 0.4, delta: { isolation: -1, approval: -2 } },
      ],
      loyalty: { faction_oligarhi: 18, faction_konservatory: -16, faction_siloviki: -4 },
      perk: {},
    },
    optionB: { // встать на сторону Консерваторов — жёсткая линия, никаких переговоров с Западом
      tiers: [
        { prob: 0.7, delta: { stability: 3, approval: 2 } },
        { prob: 0.3, delta: { stability: 1, isolation: 2 } },
      ],
      loyalty: { faction_konservatory: 18, faction_oligarhi: -16, faction_siloviki: 4 },
      perk: {},
    },
    compromise: {
      delta: { isolation: -1, stability: 1 },
      loyalty: { faction_oligarhi: 4, faction_konservatory: 4, faction_siloviki: 1 },
    },
  },
  anticorruption_purge: {
    factions: ["faction_tehnokraty", "faction_oligarhi"],
    optionA: { // встать на сторону Технократов — реальный аудит
      tiers: [
        { prob: 0.65, delta: { corruption: -4, approval: 2 } },
        { prob: 0.35, delta: { corruption: -2, stability: -1 } },
      ],
      loyalty: { faction_tehnokraty: 18, faction_oligarhi: -16, faction_konservatory: -2 },
      perk: { perk_corruption_audit_turns: 2 },
    },
    optionB: { // встать на сторону Олигархов — реформу спустить на тормозах
      tiers: [
        { prob: 0.7, delta: { economy: 2, corruption: 2 } },
        { prob: 0.3, delta: { economy: 1, approval: -2 } },
      ],
      loyalty: { faction_oligarhi: 18, faction_tehnokraty: -16, faction_konservatory: 2 },
      perk: {},
    },
    compromise: {
      delta: { corruption: -1, economy: 1 },
      loyalty: { faction_tehnokraty: 4, faction_oligarhi: 4 },
    },
  },
  media_control: {
    factions: ["faction_konservatory", "faction_tehnokraty"],
    optionA: { // встать на сторону Консерваторов — закрутить гайки
      tiers: [
        { prob: 0.7, delta: { stability: 3, diplomacy: -2 } },
        { prob: 0.3, delta: { stability: 1, isolation: 2 } },
      ],
      loyalty: { faction_konservatory: 18, faction_tehnokraty: -16, faction_siloviki: 4 },
      perk: {},
    },
    optionB: { // встать на сторону Технократов — либерализация под инвестиции
      tiers: [
        { prob: 0.65, delta: { diplomacy: 3, isolation: -2 } },
        { prob: 0.35, delta: { diplomacy: 1, stability: -2 } },
      ],
      loyalty: { faction_tehnokraty: 18, faction_konservatory: -16, faction_siloviki: -4 },
      perk: {},
    },
    compromise: {
      delta: { stability: 1, diplomacy: 1 },
      loyalty: { faction_konservatory: 4, faction_tehnokraty: 4 },
    },
  },
};
const FACTION_DILEMMA_MAX_DELTA = { military: 10, economy: 10, stability: 10, diplomacy: 10, approval: 10, isolation: 10, corruption: 10, readiness: 10 };
const COALITION_STABILITY_MAX = 5;

/**
 * Есть ли повод выкатить карточку-дилемму СЕЙЧАС — детерминированно (seed = gameId:turnN),
 * не через ИИ. Триггерится, если хотя бы одна пара башен из пула ощутимо разошлась (одна
 * заметно выше средней, другая заметно ниже) — тогда несогласие уже назрело и есть что
 * арбитрировать. Не чаще примерно раза в несколько ходов — сглаживаем вероятностью, а не
 * жёстким расписанием, чтобы не ощущалось как метроном.
 */
function checkFactionDilemmaTrigger(stats, gameId, turnNumber) {
  // Бага (Петя, 2026-07-12: "Придворная интрига сразу появляется — это не норма"): АСИММЕТРИЧНЫЙ
  // старт башен (FACTION_STARTING_STATS выше — силовики 70/консерваторы 68 против технократов 40/
  // олигархов 42, разница 26-30) сам по себе даёт tension далеко за порог 15 уже на turnNumber=0
  // (свежесозданная партия, ни один ход ещё не завершён) — при такой tension вероятность срабатывания
  // ≈60-75%. Полноэкранный интерфейс-прерывание выпадало ДО того, как игрок вообще успевал увидеть
  // партию хоть раз. Это не противоречит асимметричному старту как таковому (Петя его и просил) —
  // просто первый ход должен пройти спокойно, дальше вероятность/напряжение работают как и раньше.
  if (!turnNumber || turnNumber < 1) return null;
  const seed = `${gameId}:${turnNumber}:factionDilemma`;
  const candidates = [];
  for (const [id, def] of Object.entries(FACTION_DILEMMAS)) {
    const [a, b] = def.factions;
    const va = stats[a] ?? 65;
    const vb = stats[b] ?? 65;
    const tension = Math.abs(va - vb);
    if (tension >= 15) candidates.push({ id, tension });
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.tension - x.tension);
  // Вероятность растёт с напряжением: 15 → ~30%, 35+ → ~75% (клэмп), проверяется одной ролью.
  // Пороги снижены и вероятность поднята (Петя, 2026-07-10: "сделаем так, чтоб было больше
  // интриг") — вместе с усилением computeFactionReactions выше это даёт заметно более частые
  // и раньше начинающиеся дилеммы за партию.
  const top = candidates[0];
  const prob = Math.min(0.75, 0.3 + (top.tension - 15) * 0.0225);
  if (seededFraction(seed) >= prob) return null;
  return top.id;
}

/**
 * Разрешает выбор игрока по карточке-дилемме. choice: "optionA" | "optionB" | "compromise".
 * seed обязателен (детерминизм, как и у resolveUkraineResponse) — формат "gameId:turnN:dilemmaId".
 */
function resolveFactionDilemma(stats, dilemmaId, choice, seed) {
  if (!seed) throw new Error("resolveFactionDilemma: seed is required");
  const def = FACTION_DILEMMAS[dilemmaId];
  if (!def) throw new Error(`resolveFactionDilemma: unknown dilemmaId "${dilemmaId}"`);

  const newStats = { ...SUBSTAT_DEFAULTS, ...stats };
  const statDeltas = {};

  function applyDelta(stat, delta) {
    if (!delta) return;
    const max = FACTION_DILEMMA_MAX_DELTA[stat] ?? 10;
    const capped = Math.max(-max, Math.min(max, delta));
    const before = newStats[stat] ?? 50;
    newStats[stat] = Math.max(0, Math.min(100, before + capped));
    statDeltas[stat] = (statDeltas[stat] ?? 0) + (newStats[stat] - before);
  }
  function applyLoyalty(loyaltyMap) {
    for (const [k, delta] of Object.entries(loyaltyMap || {})) {
      const before = newStats[k] ?? 65;
      newStats[k] = Math.max(0, Math.min(100, before + delta));
      statDeltas[k] = (statDeltas[k] ?? 0) + (newStats[k] - before);
    }
  }

  if (choice === "compromise") {
    const c = def.compromise;
    for (const [stat, delta] of Object.entries(c.delta || {})) applyDelta(stat, delta);
    applyLoyalty(c.loyalty);
    const beforeCoalition = newStats.coalition_stability ?? 0;
    newStats.coalition_stability = Math.min(COALITION_STABILITY_MAX, beforeCoalition + 1);
    statDeltas.coalition_stability = newStats.coalition_stability - beforeCoalition;
    if (newStats.coalition_stability >= COALITION_STABILITY_MAX && !newStats.coalition_milestone_reached) {
      newStats.coalition_milestone_reached = 1;
      statDeltas.coalition_milestone_reached = 1;
    }
    return { newStats, statDeltas, outcome: "compromise" };
  }

  const option = choice === "optionA" ? def.optionA : choice === "optionB" ? def.optionB : null;
  if (!option) throw new Error(`resolveFactionDilemma: invalid choice "${choice}"`);

  const roll = seededFraction(`${seed}:${choice}`);
  let cumulative = 0;
  let picked = option.tiers[option.tiers.length - 1];
  for (const tier of option.tiers) {
    cumulative += tier.prob;
    if (roll < cumulative) { picked = tier; break; }
  }
  for (const [stat, delta] of Object.entries(picked.delta || {})) applyDelta(stat, delta);
  applyLoyalty(option.loyalty);
  for (const [k, delta] of Object.entries(option.perk || {})) {
    const before = newStats[k] ?? 0;
    newStats[k] = Math.max(0, before + delta);
    statDeltas[k] = (statDeltas[k] ?? 0) + (newStats[k] - before);
  }

  return { newStats, statDeltas, outcome: choice };
}

module.exports = {
  RULES_TABLE,
  CATEGORY_GROUP,
  CATEGORY_COST,
  EXPOSURE_RISK_CHANCE,
  computePeaceProgressDelta,
  computeTerritoryDelta,
  checkWesternArmsEscalation,
  WESTERN_ARMS_ARMY_BOOST,
  WESTERN_ARMS_SUPPORT_BOOST,
  WESTERN_ARMS_PERK_TURNS,
  TERRITORY_KEYS,
  resolveUkraineResponse,
  rollExposure,
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
  computeStatDeltaFromTable,
  computeDelayedEffectDelta,
  applyClamped,
  applyTurn,
  seededFraction,
  MULTI_ACTION_TURNS,
  ACTION_BUDGET_COST,
  TREASURY_MIN,
  TREASURY_PER_TRILLION,
  INVERTED_STATS,
  MILITARY_FATIGUE_THRESHOLD,
  SEVERITY_MULTIPLIER,
  TERRITORY_KEYS,
  TERRITORY_HARDNESS,
  UKRAINE_FULL_SYMMETRY,
  FACTION_KEYS,
  FACTION_STARTING_STATS,
  FACTION_DILEMMAS,
  checkFactionDilemmaTrigger,
  resolveFactionDilemma,
  COALITION_STABILITY_MAX,
  computeFactionDebuffs,
  computeFactionBuffs,
  TIER_MULTIPLIER,
  TIER_SPLIT,
};
