/**
 * ukraine-counterattack-ai.js
 *
 * ЭКСПЕРИМЕНТАЛЬНАЯ фича (2026-07-11, Петя: "хочу для теста посмотреть, каково это — живой
 * противник с ИИ, с возможностью отключить"). Тумблер: UKRAINE_AI_COUNTERATTACK_ENABLED=true
 * в .env — по умолчанию ВЫКЛЮЧЕНО, поведение полностью совпадает с прежним детерминированным
 * расчётом (computeTerritoryDelta без aiCounterattack).
 *
 * Что решает: КУДА и НАСКОЛЬКО СИЛЬНО контратакует ВСУ после наступления игрока — раньше это
 * была чистая формула от armyQuality (см. rules-engine.js). Теперь, если включено, Haiku
 * получает полный контекст обеих сторон (не только зеркальные статы, а РЕАЛЬНУЮ ситуацию —
 * недавние ходы, состояние фронта) и решает сам, а не просто выбирает случайные ключи.
 *
 * Контракт устойчивости — тот же трёхуровневый принцип, что у generateUkraineActionV2: любая
 * ошибка (сеть/невалидный JSON/ключ вне TERRITORY_KEYS/пушбэк вне разумных пределов) → null,
 * вызывающий код (turns.js) откатывается на детерминированный расчёт. Никаких retry — дёшево,
 * невысокая критичность, есть надёжный fallback.
 *
 * Детерминизм preview vs confirm: результат ЭТОГО вызова кешируется в pendingTurnStore (Redis)
 * при /turns/preview и переиспользуется БЕЗ повторного ИИ-вызова при /turns/confirm — иначе два
 * реальных вызова модели дали бы РАЗНЫЕ решения, и превью разошлось бы с итогом (та же причина,
 * по которой gmClassification уже кешируется точно так же).
 */

const { TERRITORY_KEYS } = require("../rules/rules-engine");

const MAX_PUSHBACK_PER_KEY = 6;   // разумный потолок — не сильно выше детерминированного максимума (resistanceIntensity+1, обычно ≤4)
const MAX_TOTAL_PUSHBACK = 15;    // защита от одного катастрофического хода, даже если ИИ разошёлся
const MAX_CONTESTED_KEYS = 4;     // из 5 фронтов — не может задеть все сразу

function stripMarkdownFences(text) {
  return text.replace(/```json\s*|\s*```/g, "").trim();
}

function isEnabled() {
  return process.env.UKRAINE_AI_COUNTERATTACK_ENABLED === "true";
}

async function decideAiCounterattack({ ruStats, uaStats, armyQuality, resistanceIntensity, recentMoves, gameId, turnNumber, callClaudeApi, meta, language }) {
  if (!isEnabled()) return null;

  try {
    const movesText = (recentMoves || []).length > 0
      ? recentMoves.map(m => `- [${m.mode}] ${m.input}`).join("\n")
      : "- нет данных";

    const prompt = `Ты — командование ВСУ, принимающее решение о контратаке после наступления России в этом ходу военного симулятора.

ТЕКУЩИЙ КОНТРОЛЬ ФРОНТОВ (0-100, чем выше — тем прочнее позиции России): Донецк ${ruStats.donetsk_control ?? 50}, Луганск ${ruStats.luhansk_control ?? 50}, Запорожье ${ruStats.zaporizhzhia_control ?? 50}, Херсон ${ruStats.kherson_control ?? 50}, Харьков ${ruStats.kharkiv_control ?? 50}.
АРМИЯ РОССИИ: боеготовность ${armyQuality}/100.
СОСТОЯНИЕ ВСУ: армия ${uaStats.ua_army ?? 65}/100, поддержка Запада ${uaStats.ua_west_support ?? 75}/100, боевой дух ${uaStats.ua_morale ?? 65}/100.
БЮДЖЕТ ОТВЕТА (не превышай): суммарный откат по всем фронтам ≤ ${Math.min(MAX_TOTAL_PUSHBACK, resistanceIntensity * 3)} пунктов, не более ${MAX_CONTESTED_KEYS} фронтов одновременно, откат по одному фронту ≤ ${MAX_PUSHBACK_PER_KEY} пунктов.

НЕДАВНИЕ ХОДЫ РОССИИ:
${movesText}

Выбери, на каких фронтах и насколько сильно ВСУ контратакует — реалистично, исходя из того, где у России сейчас растянуты силы, а не случайно. Слабая позиция ВСУ (низкая армия/поддержка Запада) — меньше и слабее контратака. Не будь предсказуемым, не повторяй одну и ту же схему каждый раз.

Верни строго JSON:
{"pushback": {"donetsk_control": 0, "luhansk_control": 0, "zaporizhzhia_control": 0, "kherson_control": 0, "kharkiv_control": 0}, "narrative": "1 короткое предложение — что и почему сделала ВСУ"}
Пушбэк только для фронтов, которые реально контратакуются (0 или отсутствие ключа — фронт не контратакован). Числа — целые.`;

    const response = await callClaudeApi({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }, meta);

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    const parsed = JSON.parse(stripMarkdownFences(rawText));

    if (!parsed.pushback || typeof parsed.pushback !== "object") return null;

    const pushbackByKey = {};
    let total = 0;
    for (const [key, value] of Object.entries(parsed.pushback)) {
      if (!TERRITORY_KEYS.includes(key)) continue; // неизвестный ключ — игнорируем, не проваливаем весь ответ
      const n = Math.round(Number(value));
      if (!Number.isFinite(n) || n <= 0) continue;
      const clamped = Math.min(MAX_PUSHBACK_PER_KEY, n);
      pushbackByKey[key] = clamped;
      total += clamped;
    }

    const contestedKeys = Object.keys(pushbackByKey).slice(0, MAX_CONTESTED_KEYS);
    if (contestedKeys.length === 0) return null; // ИИ решил не контратаковать вообще — не валидный ответ для этой функции, пусть решает детерминированная формула

    // Финальная защита бюджета — если ИИ всё же превысил (несмотря на инструкцию), пропорционально
    // урезаем. floor (не round) — гарантирует, что сумма НЕ превысит потолок даже после округления
    // нескольких значений одновременно (round вверх на каждом ключе может суммарно перебить cap).
    if (total > MAX_TOTAL_PUSHBACK) {
      const scale = MAX_TOTAL_PUSHBACK / total;
      for (const key of contestedKeys) pushbackByKey[key] = Math.max(1, Math.floor(pushbackByKey[key] * scale));
    }

    return {
      contestedKeys,
      pushbackByKey: Object.fromEntries(contestedKeys.map(k => [k, pushbackByKey[k]])),
      narrative: typeof parsed.narrative === "string" ? parsed.narrative.slice(0, 300) : null,
    };
  } catch (err) {
    console.error("decideAiCounterattack failed, falling back to deterministic:", err.message);
    return null;
  }
}

module.exports = { decideAiCounterattack, isEnabled: isEnabled };
