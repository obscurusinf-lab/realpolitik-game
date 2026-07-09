/**
 * lib/name-blocklist.js
 *
 * Стоп-лист имён/фамилий для displayName и presidentName (Петя, 2026-07-09):
 * игра рендерит введённое игроком имя как имя "президента" в стилистике
 * официального документа и публично показывает его в Зале Славы — без
 * стоп-листа это открывает путь к скриншотам вида "[реальное имя]
 * приказал X" / "[реальное имя] — исход: ядерный удар", годным для
 * дезинформации и подстав.
 *
 * Два уровня:
 *   - hard: однозначно одиозные фигуры (Гитлер и т.п.) — жёсткий отказ.
 *   - soft: ныне живущие реальные политики — нейтральный отказ "имя занято",
 *           не выдающий причину.
 * Список не претендует на полноту — это первый пласт, расширяемый по мере
 * необходимости, а не исчерпывающий реестр всех политиков мира.
 */

function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Однозначно одиозные фигуры — жёсткий блок, независимо от контекста.
const HARD_BLOCK = [
  "гитлер", "hitler",
  "муссолини", "mussolini",
  "пол пот", "pol pot",
].map(normalize);

// Ныне живущие реальные политики — мягкий блок ("имя занято").
// Список ориентирован на фигур, релевантных сеттингу (Россия/Украина/Запад),
// плюс наиболее узнаваемые мировые лидеры.
const SOFT_BLOCK = [
  "путин", "putin",
  "медведев", "medvedev",
  "лавров", "lavrov",
  "шойгу", "shoigu",
  "мишустин", "mishustin",
  "зеленский", "зеленскый", "zelensky", "zelenskyy",
  "байден", "biden",
  "трамп", "trump",
  "си цзиньпин", "xi jinping",
  "эрдоган", "erdogan",
  "макрон", "macron",
  "шольц", "scholz",
  "мерц", "merz",
  "стармер", "starmer",
  "орбан", "orban", "orban viktor",
  "лукашенко", "lukashenko",
  "моди", "modi",
].map(normalize);

/**
 * @param {string} rawName
 * @returns {{tier: "hard"|"soft"} | null}
 */
function checkNameBlocklist(rawName) {
  if (!rawName) return null;
  const norm = normalize(rawName);
  if (!norm) return null;
  for (const token of HARD_BLOCK) {
    if (norm.includes(token)) return { tier: "hard" };
  }
  for (const token of SOFT_BLOCK) {
    if (norm.includes(token)) return { tier: "soft" };
  }
  return null;
}

module.exports = { checkNameBlocklist };
