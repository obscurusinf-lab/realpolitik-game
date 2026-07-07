/**
 * ukraine-action-v2.js
 *
 * "Полная симметрия" (Петя, 2026-07-06) — отдельный файл от ukraine-action.js НАРОЧНО:
 * v1 (generateUkraineAction) — рабочая, проверенная система ("мидл граунд"), которую нужно
 * сохранить нетронутой как fallback. Смешивание веток if/else для двух разных контрактов
 * (выбор из 17 готовых заголовков vs свободный текст с нуля) внутри одной функции —
 * риск случайно сломать проверенный fallback при правке нового кода.
 *
 * Отличие от v1: ИИ выбирает категорию из UA_RULES_TABLE (7 широких категорий вместо 17
 * канонических событий), сам пишет title/text С НУЛЯ (не выбирает из готового), и указывает
 * severity (1-3, та же шкала, что использует classifyTurn для игрока) вместо magnitude (0-1) —
 * так дельты считаются той же формулой computeUaStatDelta/SEVERITY_MULTIPLIER, что и у игрока,
 * без отдельной схемы масштабирования.
 *
 * Контракт устойчивости идентичен v1: без retries (Haiku, дёшево/быстро, невысокая критичность —
 * не решение игрока), любая ошибка (сеть/невалидный JSON/category вне списка/severity вне 1-3) →
 * null, вызывающий код (turns.js) откатывается на v1 (generateUkraineAction), а если и та
 * провалится — на чистый Math.random() (UA_ACTIONS) — трёхуровневый fallback.
 */

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

async function generateUkraineActionV2({ uaStats, ruStats, recentMoves, recentUaTitles, categories, contextLabel, callClaudeApi }) {
  if (!categories || categories.length === 0) return null;

  const uaArmy = uaStats.ua_army ?? 65;
  const uaWest = uaStats.ua_west_support ?? 75;
  const uaMorale = uaStats.ua_morale ?? 65;
  const uaEconomy = uaStats.ua_economy ?? 55;
  const uaDiplomacy = uaStats.ua_diplomacy ?? 70;
  const uaStability = uaStats.ua_stability ?? 60;
  const ruArmy = ruStats.military ?? 50;
  const ruEconomy = ruStats.economy ?? 50;
  const peace = ruStats.peace_progress ?? 0;
  const ruDiplomacy = ruStats.diplomacy ?? 50;

  const movesText = (recentMoves || []).length > 0
    ? recentMoves.map(m => `- [${m.mode}] ${m.input}`).join("\n")
    : "- нет данных";
  const titlesText = (recentUaTitles || []).length > 0
    ? recentUaTitles.join("\n")
    : "- нет данных";
  const categoriesText = categories.map(c => `- ${c.key}: ${c.label}`).join("\n");
  const contextNote = contextLabel === "regroup"
    ? "\nКОНТЕКСТ: Россия только что объявила перегруппировку войск — Украина видит в этом окно уязвимости."
    : "";

  const prompt = `Ты — стратегический ИИ, управляющий действиями Украины в этом ходу военно-политического симулятора (президент России — игрок). Не будь предсказуемым: не повторяй недавние формулировки, реагируй на конкретную обстановку. Пиши title/text САМ, с нуля — не пересказывай примеры.

СОСТОЯНИЕ УКРАИНЫ: армия ВСУ ${uaArmy}/100, поддержка Запада ${uaWest}/100, боевой дух ${uaMorale}/100, экономика ${uaEconomy}/100, дипломатия ${uaDiplomacy}/100, внутренняя стабильность ${uaStability}/100.
СОСТОЯНИЕ РОССИИ (противник): армия ${ruArmy}/100, экономика ${ruEconomy}/100, дипломатия ${ruDiplomacy}/100, мирный трек ${peace}/100.${contextNote}

ПОСЛЕДНИЕ ХОДЫ ИГРОКА:
${movesText}

ПОСЛЕДНИЕ ДЕЙСТВИЯ УКРАИНЫ (не повторяй буквально ни формулировку, ни сюжет):
${titlesText}

ДОСТУПНЫЕ КАТЕГОРИИ (выбери РОВНО одну, наиболее уместную сейчас):
${categoriesText}

ТОЧКА ЗРЕНИЯ ТЕКСТА (важно): этот текст видит ПРЕЗИДЕНТ РОССИИ в своей сводке новостей —
это доклад о том, что произошло НА НЕГО/ЕГО СТОРОНУ, а не победная реляция украинского
штаба. Пиши как русскоязычное сообщение/сводка Минобороны о случившемся: что атаковано,
где, какой ущерб и последствия для России — фактически, в третьем лице. НЕЛЬЗЯ писать от
имени Украины и её мотивов ("это усложнит противнику", "позволит нам сэкономить
боеприпасы", "мы ослабим оборону" и т.п.) — такие формулировки звучат как внутренний отчёт
украинского командования, а не как новость для российского читателя. Пример правильного тона:
"Украинские FPV-дроны атаковали нефтеперерабатывающий завод в Саратовской области. Пожар
продолжается несколько часов — ущерб оценивается в $200 млн." Пример НЕПРАВИЛЬНОГО тона (не
делать так): "Это усложнит противнику реагирование и позволит ВСУ экономить боеприпасы."

Ответь ТОЛЬКО JSON без markdown-разметки, без пояснений:
{
  "category": "<один из ключей категорий выше, точное совпадение строки>",
  "title": "короткий заголовок новости, до 60 символов",
  "text": "2-4 предложения нарратива на русском, конкретно и по-новому, в духе военной сводки для российского читателя (см. точку зрения выше)",
  "severity": 1 | 2 | 3,
  "exposure_risk": "low" | "medium" | "high" | null
}`;

  try {
    const resp = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const rawText = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    const parsed = JSON.parse(stripMarkdownFences(rawText));

    const categorySet = new Set(categories.map(c => c.key));
    if (!categorySet.has(parsed.category)) return null;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    if (![1, 2, 3].includes(parsed.severity)) return null;

    const exposureRisk = ["low", "medium", "high"].includes(parsed.exposure_risk) ? parsed.exposure_risk : null;

    return {
      category: parsed.category,
      title: parsed.title.trim().slice(0, 100),
      text: parsed.text.trim().slice(0, 600),
      severity: parsed.severity,
      exposure_risk: exposureRisk,
    };
  } catch (err) {
    console.error("generateUkraineActionV2 failed, falling back to v1:", err.message);
    return null;
  }
}

module.exports = { generateUkraineActionV2 };
