/**
 * language-instruction.js
 *
 * i18n Фаза 3 (2026-07-07) — общий фрагмент, которым каждый промпт-билдер (gamemaster,
 * advisors, ukraine-action, ukraine-action-v2, worldUpdate, suggestions, argue) отмечает
 * язык ответа. НЕ переводит сами системные промпты/личности персонажей целиком (это отдельная,
 * намного более объёмная работа) — просто одна явная инструкция в конце промпта, которую Клод
 * прекрасно понимает независимо от языка остального текста промпта.
 *
 * language === "en" — вернуть инструкцию; иначе (дефолт "ru") — вернуть "" (ничего не менять,
 * старое поведение как было).
 */
function languageInstruction(language) {
  if (language !== "en") return "";
  return "\n\nIMPORTANT: Write your ENTIRE response — narrative, titles, dialogue, everything — in English, not Russian. This game session is set to English.";
}

module.exports = { languageInstruction };
