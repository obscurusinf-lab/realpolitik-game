// Разовый скрипт: переводит названия населённых пунктов в ua-settlements.json на русский. НЕ
// часть обычного деплоя (как и prepare-ua-*.js) — правит уже сгенерированный
// frontend/src/assets/ua-settlements.json на месте; повторный запуск prepare-ua-settlements.js
// (обновление данных GeoNames) сотрёт эту правку — тогда нужно прогнать этот скрипт заново.
//
// Петя, 2026-07-19: "все названия на карте на украинском, а должны быть на русском". Разбор
// показал ДВА разных случая:
//  1. ~35 крупных городов (CURATED_MAJOR в prepare-ua-settlements.js) — вопреки собственному
//     комментарию скрипта ("оставлены на русском"), на деле содержали украинское написание
//     ("Часів Яр" вместо "Часов Яр" и т.п.) — точный словарь ниже (MAJOR_RU_FIX).
//  2. ~1025 мелких НП из GeoNames — НЕ украинская кириллица, а официальная украинская ЛАТИНСКАЯ
//     транслитерация (GeoNames отдаёт "name" романизацией, напр. "Samiilove", "Zayichenko") —
//     то есть на карте были не украинские, а вообще латинские подписи. Пайплайн: сначала
//     латиница → украинская кириллица (обратное применение официальной укр. таблицы
//     романизации 2010 года — zh/kh/ts/ch/sh/shch/ia/iu/yi/ye и т.д.), затем украинская
//     кириллица → русская (і→и, ї→и, є→е, ґ→г, "-івка"→"-овка", "-ів"→"-ов", "-ьк"→"-к").
//     Это ПРИБЛИЖЕНИЕ по общепринятым правилам, не выверенный по каждому НП словарь — для тысячи
//     мелких деревень точный русский топоним недостижим без ручной сверки по каждой; результат
//     теперь хотя бы читается как русский текст, а не латиница.

const fs = require("fs");
const path = require("path");

const OUT_PATH = path.join(__dirname, "..", "..", "frontend", "src", "assets", "ua-settlements.json");

const MAJOR_RU_FIX = {
  "Бахмут": "Бахмут",
  "Часів Яр": "Часов Яр",
  "Торецьк": "Торецк",
  "Авдіївка": "Авдеевка",
  "Курахове": "Курахово",
  "Покровськ": "Покровск",
  "Костянтинівка": "Константиновка",
  "Слов'янськ": "Славянск",
  "Краматорськ": "Краматорск",
  "Волноваха": "Волноваха",
  "Вугледар": "Угледар",
  "Мар'їнка": "Марьинка",
  "Сєвєродонецьк": "Северодонецк",
  "Лисичанськ": "Лисичанск",
  "Кремінна": "Кременная",
  "Рубіжне": "Рубежное",
  "Старобільськ": "Старобельск",
  "Бiловодськ": "Беловодск",
  "Мелітополь": "Мелитополь",
  "Енергодар": "Энергодар",
  "Оріхів": "Орехов",
  "Гуляйполе": "Гуляйполе",
  "Василівка": "Васильевка",
  "Токмак": "Токмак",
  "Херсон": "Херсон",
  "Берислав": "Берислав",
  "Нова Каховка": "Новая Каховка",
  "Каховка": "Каховка",
  "Гола Пристань": "Голая Пристань",
  "Куп'янськ": "Купянск",
  "Ізюм": "Изюм",
  "Вовчанськ": "Волчанск",
  "Чугуїв": "Чугуев",
  "Балаклія": "Балаклея",
  "Лиман": "Лиман",
};

// Ещё один точный словарь — крупные/узнаваемые города и посёлки среди тех GeoNames-записей,
// что отдаются ЛАТИНСКОЙ транслитерацией (не входили в CURATED_MAJOR исходного скрипта, но
// достаточно известны по военным сводкам, чтобы не полагаться на механическое приближение).
// Ключ — точное латинское написание из GeoNames (см. дамп UA.txt), включая областные центры
// (Донецк/Луганск/Харьков/Мариуполь и т.д. — они отдельно есть как точки-поселения, не только
// подписи областей). Не претендует на полноту — сотни мелких сёл дальше по списку идут через
// механическое приближение ниже, тут — только те, где уверенность высокая.
const EXTRA_KNOWN_FIX = {
  "Druzhkivka": "Дружковка", "Zuyivka": "Зуевка", "Zuhres": "Зугрэс", "Zorynsk": "Зоринск",
  "Zolote": "Золотое", "Zolochiv": "Золочев", "Zmiiv": "Змиев", "Zymohiria": "Зимогорье",
  "Zhdanivka": "Ждановка", "Zelenivka": "Зеленовка", "Zaitseve": "Зайцево",
  "Zaporizhzhya": "Запорожье", "Zachepylivka": "Зачепиловка", "Yuzhna Lomuvatka": "Южная Ломоватка",
  "Katerynivka": "Екатериновка", "Yenakiyeve": "Енакиево", "Yasynivka": "Ясиновка",
  "Yasynuvata": "Ясиноватая", "Yalta": "Ялта", "Vysokopillya": "Высокополье", "Vysokyi": "Высокий",
  "Voznesenka": "Вознесенка", "Nikol's’ke": "Никольское", "Nikol's'ke": "Никольское",
  "Vodiane": "Водяное", "Volodymyrivka": "Владимировка", "Vynohradove": "Виноградово",
  "Vilnyansk": "Вольнянск", "Vesele": "Веселое", "Verkhniy Rohachyk": "Верхний Рогачик",
  "Verbivka": "Вербовка", "Velyki Kopani": "Великие Копани", "Velykyi Burluk": "Великий Бурлук",
  "Velyka Znamianka": "Великая Знаменка", "Velyka Novosilka": "Великая Новоселка",
  "Velyka Lepetykha": "Великая Лепетиха", "Velyka Bilozerka": "Великая Белозерка",
  "Velyka Oleksandrivka": "Великая Александровка", "Vasyshcheve": "Васищево", "Valky": "Валки",
  "Bokovo-Khrustalne": "Боково-Хрустальное", "Uspenka": "Успенка", "Ukrayinsk": "Украинск",
  "Vuhlehirsk": "Углегорск", "Oleshky": "Алешки", "Tsyrkuny": "Циркуны", "Troitske": "Троицкое",
  "Toshkivka": "Тошковка", "Chystyakove": "Чистяково", "Terpinnia": "Терпение",
  "Ternova": "Терновая", "Irmino": "Ирмино", "Boykivske": "Бойковское", "Talakivka": "Талаковка",
  "Svyatohirsk": "Святогорск", "Svetlodarsk": "Светлодарск", "Svatove": "Сватово",
  "Stepnohirsk": "Степногорск", "Sukhodilsk": "Суходольск", "Staryi Saltiv": "Старый Салтов",
  "Staryi Krym": "Старый Крым", "Staromykhailivka": "Старомихайловка",
  "Starobesheve": "Старобешево", "Stanytsya-Luhanska": "Станица Луганская",
  "Kadiyivka": "Кадиевка", "Solonytsivka": "Солоницевка", "Snizhne": "Снежное",
  "Slov`yanoserbsk": "Славяносербск", "Slatyne": "Слатино", "Syvaske": "Сивашское",
  "Shevchenkove": "Шевченково", "Shakhtarsk": "Шахтерск", "Shabelkivka": "Шабельковка",
  "Siversk": "Северск", "Selydove": "Селидово", "Shchastya": "Счастье", "Savyntsi": "Савинцы",
  "Sakhnovshchyna": "Сахновщина", "Ruska Lozova": "Русская Лозовая", "Rubanivka": "Рубановка",
  "Rozivka": "Розовка", "Rovenky": "Ровеньки", "Rozkishne": "Роскошное", "Rohan": "Рогань",
  "Rodynske": "Родинское", "Rodakove": "Родаково", "Raihorodok": "Райгородок",
  "Rozsypne": "Рассыпное", "P'yatypill'ya": "Пятиполье", "Prymorske": "Приморское",
  "Sartana": "Сартана", "Prymorsk": "Приморск", "Pryazovske": "Приазовское",
  "Popasna": "Попасная", "Polohy": "Пологи", "Pokotylivka": "Покотиловка",
  "Petrivske": "Петровское", "Petrovo-Krasnosillya": "Петрово-Красноселье",
  "Pisochyn": "Песочин", "Zlatopil": "Златополь", "Pervomayskyi": "Первомайский",
  "Manhush": "Мангуш", "Perevalsk": "Перевальск", "Peresichna": "Пересечная",
  "Pelahiivka": "Пелагеевка", "Pechenihy": "Печенеги", "Rykove": "Рыково",
  "Parkhomivka": "Пархомовка", "Lymanivka": "Лимановка", "Panteleymonivka": "Пантелеймоновка",
  "Osypenko": "Осипенко", "Vilshany": "Ольшаны", "Olenivka": "Оленовка",
  "Ocheretyne": "Очеретино", "Novyi Svit": "Новый Свет", "Novovorontsovka": "Нововоронцовка",
  "Novotroyitske": "Новотроицкое", "Novosvitlivka": "Новосветловка", "Aydar": "Айдар",
  "Novopokrovka": "Новопокровка", "Novomykolayivka": "Новониколаевка",
  "Novomykolaivka": "Новониколаевка", "Novohrodivka": "Новогродовка",
  "Novofedorivka": "Новофедоровка", "Novodonetske": "Новодонецкое",
  "Novobohdanivka": "Новобогдановка", "Novoazovs'k": "Новоазовск", "Novoaidar": "Новоайдар",
  "Novooleksiyivka": "Новоалексеевка", "Nyu-York": "Нью-Йорк", "Nova Zburivka": "Новая Збурьевка",
  "Nova Vodolaha": "Новая Водолага", "Nova Mayachka": "Новая Маячка",
  "Nyzhnya Krynka": "Нижняя Крынка", "Nyzhni Sirohozy": "Нижние Серогозы",
  "Mykolaivka": "Николаевка", "Mospyne": "Моспино", "Molochansk": "Молочанск",
  "Miusynsk": "Миусинск", "Milove": "Меловое", "Mykhaylivka": "Михайловка", "Merefa": "Мерефа",
  "Matviivka": "Матвеевка", "Markivka": "Марковка", "Mariupol": "Мариуполь",
  "Malotaranivka": "Малотарановка", "Malokaterynivka": "Малокатериновка",
  "Mala Danylivka": "Малая Даниловка", "Mala Bilozerka": "Малая Белозерка",
  "Makiyivka": "Макеевка", "Liubotyn": "Люботин", "Lyubymivka": "Любимовка",
  "Lutuhyne": "Лутугино", "Luhansk": "Луганск", "Lozova": "Лозовая",
  "Ivanivske": "Ивановское", "Lyptsi": "Липцы", "Bilmak": "Бильмак", "Kushuhum": "Кушугум",
  "Kurylivka": "Куриловка", "Krynychna": "Криничная", "Khrustalnyi": "Хрустальный",
  "Krasnotorka": "Красноторка", "Krasnorichenske": "Краснореченское",
  "Krasnokutsk": "Краснокутск", "Krasnohorivka": "Красногоровка", "Teple": "Теплое",
  "Sorokyne": "Сорокино", "Nova Karakuba": "Новая Каракуба", "Korotych": "Коротыч",
  "Kinski Rozdory": "Конские Раздоры", "Slobozhanske": "Слобожанское",
  "Kal'mius'ke": "Кальмиусское", "Khrestivka": "Крестовка", "Holubivka": "Голубовка",
  "Khorosheve": "Хорошево", "Khartsyzk": "Харцызск", "Kharkiv": "Харьков",
  "Kehychivka": "Кегичевка", "Kozachi Laheri": "Казачьи Лагери", "Sofiyivka": "Софиевка",
  "Soledar": "Соледар", "Komyshuvakha": "Камышеваха", "Komyshany": "Камышаны",
  "Kamyane": "Каменское", "Kamyanka-Dniprovska": "Каменка-Днепровская",
  "Kalanchak": "Каланчак", "Ivanivka": "Ивановка", "Ilovays’k": "Иловайск",
  "Ilovays'k": "Иловайск", "Horlivka": "Горловка", "Hirske": "Горское", "Hirnyk": "Горняк",
  "Hornostayivka": "Горностаевка", "Heorhiivka": "Георгиевка", "Fashchivka": "Фащевка",
  "Eskhar": "Эсхар", "Dvorichna": "Двуречная", "Drobysheve": "Дробышево", "Donetsk": "Донецк",
  "Dokuchayevsk": "Докучаевск", "Dobropillia": "Доброполье", "Dniprovka": "Днепровка",
  "Dniprorudne": "Днепрорудное", "Dmytrivka": "Дмитровка", "Myrnohrad": "Мирноград",
  "Derhachi": "Дергачи", "Debaltseve": "Дебальцево", "Oskil": "Оскол", "Donets": "Донец",
  "Voznesenivka": "Вознесеновка", "Chornukhyne": "Чернухино", "Chornobaivka": "Чернобаевка",
  "Chernihivka": "Черниговка", "Cherkaske": "Черкасское", "Cherkaska Lozova": "Черкасская Лозовая",
  "Chaplynka": "Чаплинка", "Voskresenka": "Воскресенка", "Bylbasivka": "Былбасовка",
  "Budy": "Буды", "Bryanka": "Брянка", "Borshchivka": "Борщевка", "Borivske": "Боровское",
  "Borova": "Боровая", "Bohodukhiv": "Богодухов", "Blyzniuky": "Близнюки",
  "Blahodatne": "Благодатное", "Krynychne": "Криничное", "Bezliudivka": "Безлюдовка",
  "Berdyansk": "Бердянск", "Bilyi Kolodiaz": "Белый Колодезь", "Bilozerske": "Белозерское",
  "Bilozerka": "Белозерка", "Bile": "Белое", "Bilorichenskyi": "Белореченский",
  "Bilytske": "Белицкое", "Barvinkove": "Барвенково", "Balky": "Балки", "Balabyne": "Балабино",
  "Babayi": "Бабаи", "Antratsyt": "Антрацит", "Antonivka": "Антоновка",
  "Andriyivka": "Андреевка", "Amvrosiivka": "Амвросиевка", "Almazna": "Алмазная",
  "Oleksiyevo-Druzhkivka": "Алексеево-Дружковка", "Oleksandrivsk": "Александровск",
  "Oleksandrivka": "Александровка", "Alchevsk": "Алчевск", "Yakymivka": "Якимовка",
  "Podvirky": "Подворки", "Dokuchayevske": "Докучаевское", "Tavryiske": "Таврийское",
  "Novoluhanske": "Новолуганское", "Bratske": "Братское",
};

// ---------- Шаг 1: латинская романизация (GeoNames) -> украинская кириллица ----------
// Обратное применение официальной укр. таблицы 2010 года. Работаем в нижнем регистре, регистр
// первой буквы слова восстанавливаем в конце — иначе пришлось бы дублировать все правила под
// заглавные варианты диграфов.
const WORD_INITIAL = [
  ["shch", "щ"],
  ["ye", "є"],
  ["yi", "ї"],
  ["yu", "ю"],
  ["ya", "я"],
];
const GENERAL_DIGRAPHS = [
  ["shch", "щ"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["iu", "ю"],
  ["ia", "я"],
  ["yi", "ї"],
  ["ye", "є"],
];
const SINGLE = {
  a: "а", b: "б", v: "в", h: "г", g: "ґ", d: "д", e: "е", z: "з", y: "и", i: "і",
  k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", t: "т", u: "у", f: "ф",
  j: "й",
};

function latinWordToUkCyrillic(word) {
  const lower = word.toLowerCase();
  let out = "";
  let pos = 0;
  while (pos < lower.length) {
    const ch = lower[pos];
    if (ch === "'" || ch === "’") { out += "ь"; pos += 1; continue; }
    if (!/[a-z]/.test(ch)) { out += lower[pos]; pos += 1; continue; }
    let matched = false;
    if (pos === 0) {
      for (const [pat, rep] of WORD_INITIAL) {
        if (lower.startsWith(pat, pos)) { out += rep; pos += pat.length; matched = true; break; }
      }
      if (matched) continue;
    }
    for (const [pat, rep] of GENERAL_DIGRAPHS) {
      if (lower.startsWith(pat, pos)) { out += rep; pos += pat.length; matched = true; break; }
    }
    if (matched) continue;
    out += SINGLE[ch] || ch;
    pos += 1;
  }
  // Восстанавливаем регистр первой буквы под исходное слово (GeoNames — Title Case по словам).
  if (word[0] && word[0] === word[0].toUpperCase() && /[A-Za-z]/.test(word[0])) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

// Небольшая эвристика: слово уже кириллическое (украинские мажоры хранятся кириллицей) — не
// трогаем на этом шаге, латинский реверс тут не нужен.
function isLatinWord(word) {
  return /[A-Za-z]/.test(word) && !/[А-Яа-яЁёІіЇїЄєҐґ]/.test(word);
}

// ---------- Шаг 2: украинская кириллица -> русская кириллица ----------
function ukCyrillicWordToRu(word) {
  let w = word;
  w = w.replace(/['’]/g, "ь");
  w = w.replace(/івка$/g, "овка").replace(/Івка$/g, "Овка");
  w = w.replace(/ів$/g, "ов").replace(/Ів$/g, "Ов");
  w = w.replace(/їв$/g, "ов").replace(/Їв$/g, "Ов");
  w = w.replace(/ьк$/g, "к").replace(/Ьк$/g, "К");
  w = w.replace(/і/g, "и").replace(/І/g, "И");
  w = w.replace(/ї/g, "и").replace(/Ї/g, "И");
  w = w.replace(/є/g, "е").replace(/Є/g, "Е");
  w = w.replace(/ґ/g, "г").replace(/Ґ/g, "Г");
  return w;
}

function russifyName(name) {
  return name
    .split(" ")
    .map((word) => {
      const cyr = isLatinWord(word) ? latinWordToUkCyrillic(word) : word;
      return ukCyrillicWordToRu(cyr);
    })
    .join(" ");
}

// GeoNames иногда даёт типографский апостроф (’), иногда обычный (') для одного и того же
// звука — нормализуем перед поиском в словаре, чтобы не дублировать оба варианта в EXTRA_KNOWN_FIX.
function normalizeApostrophe(s) {
  return s.replace(/’/g, "'");
}

const data = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
let majorFixed = 0, knownFixed = 0, translited = 0, unchanged = 0;
for (const s of data) {
  const normalized = normalizeApostrophe(s.name);
  if (MAJOR_RU_FIX[s.name] !== undefined) {
    const before = s.name;
    s.name = MAJOR_RU_FIX[s.name];
    if (s.name !== before) majorFixed++;
  } else if (EXTRA_KNOWN_FIX[normalized] !== undefined) {
    s.name = EXTRA_KNOWN_FIX[normalized];
    knownFixed++;
  } else {
    const before = s.name;
    s.name = russifyName(s.name);
    if (s.name !== before) translited++; else unchanged++;
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(data));
const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
console.log(`Total: ${data.length}, major dict: ${majorFixed}, known-city dict: ${knownFixed}, mechanical latin/uk->ru: ${translited}, unchanged: ${unchanged}`);
console.log(`Wrote ${OUT_PATH} (${sizeKb}KB)`);
