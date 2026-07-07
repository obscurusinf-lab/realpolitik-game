import React, { useState, useEffect } from "react";

// Фаза 1 перевода игры (ru/en) — Петя, 2026-07-07: "переведем игру на английский, чтоб можно
// было переключиться и в начальном экране, на этапе регистрации, и в самой игре".
//
// Свой словарь + t(key), без новых npm-зависимостей (react-i18next осознанно отклонён —
// в кодовой базе нет ни одного React Context, всё на хуках/пропсах, не хотим ломать стиль ради
// одной фичи). currentLang — модульная переменная (не React state) с ручным pub-sub, чтобы t()
// можно было звать где угодно (внутри JSX, внутри объектов стилей, вне компонентов), а useLang()
// давало ре-рендер только тем немногим местам, которым он реально нужен (сам переключатель +
// видимый на этом же экране текст).
//
// ВАЖНО (см. план C:\Users\Peter\.claude\plans\replicated-seeking-russell.md, Фаза 1): это
// покрывает только стартовый экран/регистрацию (main.jsx) и шапку/таб-бар/WelcomeModal игры
// (App.jsx). Содержимое геймплейных вкладок (Казна/Показатели/Башни Кремля и т.д.),
// ИИ-генерируемый контент (указы/лента/советники/Украина) и seed-данные стран — НЕ переведены,
// это следующие фазы. t() возвращает сам ключ, если перевода нет — частично переведённые экраны
// не ломаются и не показывают пустоту.

const RU = {
  // ---- Общее ----
  "brand.tagline": "геополитическая стратегия",
  "brand.classified": "СОВЕРШЕННО СЕКРЕТНО",

  // ---- StartScreen: интро ----
  "start.hook": "Устал от бессилия, что не можешь ни на что повлиять?",
  "start.pitch": "REALPOLITIK даёт тебе шанс сделать всё правильно — стань президентом.",

  // ---- StartScreen: форма входа ----
  "start.tab_login": "ВХОД",
  "start.tab_register": "РЕГИСТРАЦИЯ",
  "start.field_login": "ЛОГИН",
  "start.placeholder_login": "имя пользователя",
  "start.field_display_name": "ПОЗЫВНОЙ АККАУНТА (общий для всех партий)",
  "start.placeholder_display_name": "Как вас называть в личном кабинете…",
  "start.field_password": "ПАРОЛЬ",
  "start.btn_checking": "Проверка допуска…",
  "start.btn_login": "Войти →",
  "start.btn_register": "Зарегистрироваться →",

  // ---- StartScreen: после входа ----
  "start.access_confirmed": "ДОПУСК ПОДТВЕРЖДЁН · ",
  "start.edit_name_title": "Изменить имя",
  "start.logout": "ВЫЙТИ",
  "start.loading_games": "Загрузка партий…",
  "start.saved_games": "СОХРАНЁННЫЕ ПАРТИИ",
  "start.slots": "слотов",
  "start.resume": "Продолжить →",
  "start.delete_game_title": "Удалить партию",
  "start.turn_short": "Ход",
  "start.no_saved_games": "Нет сохранённых партий",
  "start.president_name_label": "ИМЯ ПРЕЗИДЕНТА (для этой партии)",
  "start.president_name_hint": "Своё на каждую партию — отдельно от логина @{username}. Если несколько партий, в Зале славы они не перепутаются.",
  "start.choose_country": "ВЫБЕРИТЕ СТРАНУ",
  "start.soon": "СКОРО",
  "start.game_mode": "РЕЖИМ ИГРЫ",
  "start.mode_advisor_title": "С советниками",
  "start.mode_advisor_desc": "Кабинет министров подсказывает оптимальные ходы и путь к победе. Вы можете следовать советам — или полностью формулировать свои указы. Доступен ликбез по механикам.",
  "start.mode_hardcore_title": "Сам по себе",
  "start.mode_hardcore_desc": "Никаких игровых подсказок. Советники молчат. Кабинет и варианты указов остаются. До победы — военной или дипломатической — додумываетесь сами.",
  "start.add_to_leaderboard": "ДОБАВИТЬ В ЗАЛ СЛАВЫ",
  "start.add_to_leaderboard_desc": "Разрешить публикацию итогов этой партии в общем рейтинге. Имя президента и результат будут видны всем.",
  "start.slots_full": "ВСЕ {limit} СЛОТОВ ЗАНЯТЫ — УДАЛИТЕ ОДНУ ПАРТИЮ",
  "start.btn_initializing": "Инициализация досье…",
  "start.btn_start": "Принять командование →",
  "start.hall_of_fame": "🏆 ЗАЛ СЛАВЫ",
  "start.feedback": "🐞 БАГ / ФИДБЕК",
  "start.alpha_title": "⚠ АЛЬФА-ВЕРСИЯ",
  "start.alpha_desc": "Игра в активной разработке: возможны баги, дисбаланс и изменения механик задним числом. Прогресс партий может сбрасываться при крупных обновлениях. Нашли баг — нажмите «Сообщить о баге» выше.",
  "start.disclaimer_title": "ДИСКЛЕЙМЕР",
  "start.disclaimer_desc": "Все персонажи, имена и события в игре являются вымышленными. Любое сходство с реальными лицами случайно. Игра создана в образовательных и развлекательных целях. Мнения, выраженные в игре, не отражают взгляды авторов.",
  "start.footer_note": "ДАННЫЕ НА ИЮНЬ 2026 · ВСЕ СОВПАДЕНИЯ СЛУЧАЙНЫ",

  // ---- Валидационные сообщения (фронтовые, не с бэкенда) ----
  "err.name_min": "Минимум 2 символа",
  "err.name_max": "Максимум 40 символов",
  "err.country_unavailable": "Эта страна пока недоступна",

  // ---- Страны (COUNTRIES) ----
  "country.RU.desc": "Ядерная держава под санкционным давлением. Высокая военная мощь, экономические ограничения.",
  "country.US.desc": "Глобальная сверхдержава. Управление союзами, внутренняя поляризация, доминирование доллара.",
  "country.CN.desc": "Восходящая сверхдержава. Экономическая экспансия, Тайвань, конкуренция с Западом.",
  "country.UA.desc": "Страна в состоянии войны. Максимальная сложность — каждый ход на счету.",
  "country.DE.desc": "Локомотив ЕС. Энергетический переход, зависимость от экспорта, лидерство в Европе.",
  "country.TR.desc": "Многовекторный игрок между Востоком и Западом. Балансирование между НАТО и Россией.",
  "difficulty.Легко": "Легко",
  "difficulty.Средне": "Средне",
  "difficulty.Сложно": "Сложно",
  "difficulty.Эксперт": "Эксперт",

  // ---- Базовые статы (для лидерборда main.jsx) ----
  "stat.stability": "Стабильность",
  "stat.economy": "Экономика",
  "stat.military": "Армия",
  "stat.diplomacy": "Дипломатия",
  "stat.approval": "Рейтинг",

  // ---- LeaderboardPage ----
  "board.back": "← НАЗАД",
  "board.title": "🏆 ЗАЛ СЛАВЫ — ТОП ПРЕЗИДЕНТОВ",
  "board.loading": "ЗАГРУЗКА…",
  "board.empty_1": "Зал Славы пуст.",
  "board.empty_2": "Включите «Добавить в Зал Славы» при создании партии — и ваш результат появится здесь.",
  "board.turn_short": "ход",
  "board.footer": "Показаны только партии с включённой публикацией",

  // ---- App.jsx: шапка и таб-бар ----
  "app.classified": "СОВЕРШЕННО СЕКРЕТНО · ЭКЗ. №1",
  "app.turn_short": "Ход №",
  "app.alpha_badge": "⚠ АЛЬФА",
  "app.wiki_button": "📖 ЛИКБЕЗ",
  "app.bug_button": "🐞 БАГ",
  "app.new_game_button": "НОВАЯ ПАРТИЯ",
  "app.new_game_confirm": "Начать новую партию? Текущий прогресс останется в базе.",
  "tab.overview": "Обстановка",
  "tab.kremlin": "Башни Кремля",
  "tab.treasury": "💰 Казна",
  "tab.map": "Карта",
  "tab.stats": "Показатели",
  "tab.world": "Мир",
  "tab.advisors": "Кабинет министров",
  "tab.policies": "Политики",
  "tab.relations": "Отношения",
  "tab.newsfeed": "Лента",
  "tab.log": "Журнал",

  // ---- App.jsx: WelcomeModal (шапка/лейблы, не глубокое содержимое статов) ----
  "welcome.briefing": "ВВОДНЫЙ БРИФИНГ",
  "welcome.dossier": "ЛИЧНОЕ ДЕЛО",
  "welcome.default_title": "Президент",
  "welcome.dossier_text": "Верховный главнокомандующий. Возглавил {country} в переломный момент истории. Все стратегические решения — в ваших руках. Советники готовы к докладу.",
  "welcome.country_prefix": "СТРАНА · ",
  "welcome.current_info": "Актуальная информация →",
  "welcome.geo_context": "ГЕОПОЛИТИЧЕСКИЙ КОНТЕКСТ · ",
  "welcome.strengths": "СИЛЬНЫЕ СТОРОНЫ",
  "welcome.weaknesses": "СЛАБЫЕ СТОРОНЫ",
  "welcome.stats_section": "📊 ОПЕРАТИВНАЯ СВОДКА",
  "welcome.cta": "Приступить к работе →",
};

const EN = {
  "brand.tagline": "geopolitical strategy",
  "brand.classified": "TOP SECRET",

  "start.hook": "Tired of feeling powerless to change anything?",
  "start.pitch": "REALPOLITIK gives you a shot at getting it right — become president.",

  "start.tab_login": "LOG IN",
  "start.tab_register": "REGISTER",
  "start.field_login": "USERNAME",
  "start.placeholder_login": "username",
  "start.field_display_name": "ACCOUNT CALLSIGN (shared across all games)",
  "start.placeholder_display_name": "What should we call you in your account…",
  "start.field_password": "PASSWORD",
  "start.btn_checking": "Verifying clearance…",
  "start.btn_login": "Log in →",
  "start.btn_register": "Register →",

  "start.access_confirmed": "CLEARANCE CONFIRMED · ",
  "start.edit_name_title": "Change name",
  "start.logout": "LOG OUT",
  "start.loading_games": "Loading games…",
  "start.saved_games": "SAVED GAMES",
  "start.slots": "slots",
  "start.resume": "Resume →",
  "start.delete_game_title": "Delete game",
  "start.turn_short": "Turn",
  "start.no_saved_games": "No saved games",
  "start.president_name_label": "PRESIDENT'S NAME (for this game)",
  "start.president_name_hint": "Your own per game — separate from the @{username} login. If you have several games, the Hall of Fame won't mix them up.",
  "start.choose_country": "CHOOSE A COUNTRY",
  "start.soon": "SOON",
  "start.game_mode": "GAME MODE",
  "start.mode_advisor_title": "With advisors",
  "start.mode_advisor_desc": "The cabinet suggests optimal moves and a path to victory. You can follow the advice — or write your own decrees from scratch. In-game guide available.",
  "start.mode_hardcore_title": "On your own",
  "start.mode_hardcore_desc": "No gameplay hints. Advisors stay silent. The cabinet and decree options remain. You figure out the path to victory — military or diplomatic — yourself.",
  "start.add_to_leaderboard": "ADD TO HALL OF FAME",
  "start.add_to_leaderboard_desc": "Allow this game's results to be published on the public leaderboard. The president's name and outcome will be visible to everyone.",
  "start.slots_full": "ALL {limit} SLOTS ARE FULL — DELETE A GAME",
  "start.btn_initializing": "Initializing dossier…",
  "start.btn_start": "Assume command →",
  "start.hall_of_fame": "🏆 HALL OF FAME",
  "start.feedback": "🐞 BUG / FEEDBACK",
  "start.alpha_title": "⚠ ALPHA VERSION",
  "start.alpha_desc": "The game is under active development: bugs, balance issues, and retroactive mechanic changes may occur. Game progress may reset during major updates. Found a bug — click \"Report a bug\" above.",
  "start.disclaimer_title": "DISCLAIMER",
  "start.disclaimer_desc": "All characters, names, and events in this game are fictional. Any resemblance to real people is coincidental. This game was made for educational and entertainment purposes. Opinions expressed in the game do not reflect the views of the authors.",
  "start.footer_note": "DATA AS OF JUNE 2026 · ALL RESEMBLANCE IS COINCIDENTAL",

  "err.name_min": "Minimum 2 characters",
  "err.name_max": "Maximum 40 characters",
  "err.country_unavailable": "This country isn't available yet",

  "country.RU.desc": "A nuclear power under sanctions pressure. High military strength, economic constraints.",
  "country.US.desc": "A global superpower. Managing alliances, domestic polarization, dollar dominance.",
  "country.CN.desc": "A rising superpower. Economic expansion, Taiwan, competition with the West.",
  "country.UA.desc": "A country at war. Maximum difficulty — every turn counts.",
  "country.DE.desc": "The EU's locomotive. Energy transition, export dependency, leadership in Europe.",
  "country.TR.desc": "A multi-vector player between East and West. Balancing NATO and Russia.",
  "difficulty.Легко": "Easy",
  "difficulty.Средне": "Medium",
  "difficulty.Сложно": "Hard",
  "difficulty.Эксперт": "Expert",

  "stat.stability": "Stability",
  "stat.economy": "Economy",
  "stat.military": "Military",
  "stat.diplomacy": "Diplomacy",
  "stat.approval": "Approval",

  "board.back": "← BACK",
  "board.title": "🏆 HALL OF FAME — TOP PRESIDENTS",
  "board.loading": "LOADING…",
  "board.empty_1": "The Hall of Fame is empty.",
  "board.empty_2": "Enable \"Add to Hall of Fame\" when creating a game — and your result will show up here.",
  "board.turn_short": "turn",
  "board.footer": "Only games with publishing enabled are shown",

  "app.classified": "TOP SECRET · COPY №1",
  "app.turn_short": "Turn #",
  "app.alpha_badge": "⚠ ALPHA",
  "app.wiki_button": "📖 GUIDE",
  "app.bug_button": "🐞 BUG",
  "app.new_game_button": "NEW GAME",
  "app.new_game_confirm": "Start a new game? Your current progress will stay saved.",
  "tab.overview": "Overview",
  "tab.kremlin": "Kremlin Towers",
  "tab.treasury": "💰 Treasury",
  "tab.map": "Map",
  "tab.stats": "Stats",
  "tab.world": "World",
  "tab.advisors": "Cabinet",
  "tab.policies": "Policies",
  "tab.relations": "Relations",
  "tab.newsfeed": "Newsfeed",
  "tab.log": "Log",

  "welcome.briefing": "INTRODUCTORY BRIEFING",
  "welcome.dossier": "PERSONNEL FILE",
  "welcome.default_title": "President",
  "welcome.dossier_text": "Commander-in-Chief. Took charge of {country} at a turning point in history. All strategic decisions are in your hands. Advisors are ready to report.",
  "welcome.country_prefix": "COUNTRY · ",
  "welcome.current_info": "Current briefing →",
  "welcome.geo_context": "GEOPOLITICAL CONTEXT · ",
  "welcome.strengths": "STRENGTHS",
  "welcome.weaknesses": "WEAKNESSES",
  "welcome.stats_section": "📊 SITUATION REPORT",
  "welcome.cta": "Get to work →",
};

const DICTS = { ru: RU, en: EN };

function readInitialLang() {
  try {
    const saved = localStorage.getItem("rp_lang");
    return saved === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

let currentLang = readInitialLang();
const subscribers = new Set();

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  const next = lang === "en" ? "en" : "ru";
  if (next === currentLang) return;
  currentLang = next;
  try { localStorage.setItem("rp_lang", next); } catch {}
  subscribers.forEach((fn) => fn(next));
}

// t(key, vars?) — лукап в словаре текущего языка с подстановкой {var}. Фолбэк на сам ключ, если
// перевода нет (частично переведённые экраны не должны ломаться или показывать пустоту).
export function t(key, vars) {
  const dict = DICTS[currentLang] || RU;
  let str = dict[key] ?? RU[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, v);
    }
  }
  return str;
}

// useLang() — только там, где реально нужен ре-рендер по смене языка (сам переключатель + текст
// на том же экране, что и он). Большинство мест просто зовут t() напрямую без хука.
export function useLang() {
  const [lang, setLangState] = useState(currentLang);
  useEffect(() => {
    const fn = (next) => setLangState(next);
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }, []);
  return lang;
}

// Пилюля-переключатель RU|EN — переиспользуется и на стартовом экране (main.jsx), и в шапке
// игры (App.jsx). dark=true — тёмный фон шапки игры, dark=false — фон стартового экрана
// (оба сейчас на самом деле одного оттенка #14181f/#1f2733, параметр оставлен на случай, если
// понадобится разная стилизация под конкретный фон).
export function LangToggle({ style } = {}) {
  const lang = useLang();
  return React.createElement(
    "div",
    { style: { display: "flex", border: "1px solid #3a4156", borderRadius: 4, overflow: "hidden", ...style } },
    ["ru", "en"].map((l) =>
      React.createElement(
        "button",
        {
          key: l,
          onClick: () => setLang(l),
          style: {
            background: lang === l ? "#9c8347" : "transparent",
            color: lang === l ? "#14181f" : "#5a6070",
            border: "none",
            padding: "3px 8px",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            cursor: "pointer",
          },
        },
        l.toUpperCase()
      )
    )
  );
}
