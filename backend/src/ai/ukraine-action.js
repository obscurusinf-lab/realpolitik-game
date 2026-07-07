/**
 * ukraine-action.js
 *
 * Раньше (см. комментарий у ukraine_action_this_month в turns.js) месячное действие
 * Украины полностью выбиралось Math.random() по фиксированным весам из жёстко
 * прописанной таблицы UA_ACTIONS — сам нарратив и цифры были статичным текстом,
 * ИИ (selectUkraineStrategy) только чуть двигал веса. Игрок: "действия украины должны
 * быть продиктованы ИИ, а не детерминированы, иначе зачем нам ии????".
 *
 * Это НЕ убирает safety-границы: ИИ выбирает ТОЛЬКО из уже заданных типов действия
 * (validTypes — те же UA_ACTIONS, что и раньше, отфильтрованные по контекстным весам),
 * и только пишет заголовок/текст + magnitude (0-1, сила эффекта внутри диапазона
 * категории). Числовые дельты по-прежнему считаются из УЖЕ БАЛАНС-ТЕСТИРОВАННЫХ
 * базовых значений UA_ACTIONS, отмасштабированных по magnitude — ИИ не может внести
 * непредсказуемые числа. При любой ошибке (сеть/JSON/валидация) — null, и вызывающий
 * код откатывается на старый Math.random()-выбор, как было раньше (ноль риска регресса).
 */

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

async function generateUkraineAction({ stats, uaStrategy, recentMoves, recentUaTitles, validTypes, callClaudeApi, meta }) {
  if (!validTypes || validTypes.length === 0) return null;

  const uaArmy = stats.ua_army ?? 65;
  const uaWest = stats.ua_west_support ?? 75;
  const uaMorale = stats.ua_morale ?? 65;
  const ruArmy = stats.military ?? 50;
  const ruEconomy = stats.economy ?? 50;
  const peace = stats.peace_progress ?? 0;
  const ruDiplomacy = stats.diplomacy ?? 50;

  const movesText = (recentMoves || []).length > 0
    ? recentMoves.map(m => `- [${m.mode}] ${m.input}`).join("\n")
    : "- нет данных";
  const titlesText = (recentUaTitles || []).length > 0
    ? recentUaTitles.join("\n")
    : "- нет данных";
  const typesText = validTypes.map(t => `- ${t.type}: ${t.title}`).join("\n");

  const prompt = `Ты — стратегический ИИ, управляющий действиями Украины в этом ходу военно-политического симулятора (президент России — игрок). Не будь предсказуемым: не повторяй недавние формулировки, реагируй на конкретную обстановку.

СОСТОЯНИЕ УКРАИНЫ: армия ВСУ ${uaArmy}/100, поддержка Запада ${uaWest}/100, боевой дух ${uaMorale}/100.
СОСТОЯНИЕ РОССИИ (противник): армия ${ruArmy}/100, экономика ${ruEconomy}/100, дипломатия ${ruDiplomacy}/100, мирный трек ${peace}/100.
СТРАТЕГИЯ УКРАИНЫ В ЭТОМ МЕСЯЦЕ: ${uaStrategy}.

ПОСЛЕДНИЕ ХОДЫ ИГРОКА:
${movesText}

ПОСЛЕДНИЕ ДЕЙСТВИЯ УКРАИНЫ (не повторяй буквально ни формулировку, ни сюжет):
${titlesText}

ДОСТУПНЫЕ ТИПЫ ДЕЙСТВИЯ (выбери РОВНО один, наиболее уместный сейчас):
${typesText}

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
  "action_type": "<один из типов выше, точное совпадение строки>",
  "title": "короткий заголовок новости, до 60 символов",
  "text": "2-4 предложения нарратива на русском, конкретно и по-новому, в духе военной сводки для российского читателя (см. точку зрения выше)",
  "magnitude": 0.0-1.0
}`;

  try {
    const resp = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }, meta);
    const rawText = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    const parsed = JSON.parse(stripMarkdownFences(rawText));

    const validTypeSet = new Set(validTypes.map(t => t.type));
    if (!validTypeSet.has(parsed.action_type)) return null;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;

    const magnitude = typeof parsed.magnitude === "number" && isFinite(parsed.magnitude)
      ? Math.max(0, Math.min(1, parsed.magnitude))
      : 0.7;

    return {
      action_type: parsed.action_type,
      title: parsed.title.trim().slice(0, 100),
      text: parsed.text.trim().slice(0, 600),
      magnitude,
    };
  } catch (err) {
    console.error("generateUkraineAction failed, falling back to weighted-random:", err.message);
    return null;
  }
}

module.exports = { generateUkraineAction };
