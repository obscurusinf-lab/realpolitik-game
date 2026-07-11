/**
 * worldUpdate.js — генерация мировых событий после каждого хода.
 * ВАЖНО: промпты намеренно краткие — русский текст токенизируется дороже английского,
 * поэтому каждое поле ограничено 1-2 предложениями чтобы не обрезаться.
 */

const { languageInstruction } = require("./language-instruction");

function buildNuclearAftermathPrompt({ countryName, turnNumber, playerInput, narrative, language, gameDate }) {
  return `Ты — система мирового моделирования. Президент ${countryName} только что нанёс ядерный удар (ход ${turnNumber}, дата в игре: ${gameDate || "—"}).
ВАЖНО ПРО ДАТЫ: если упоминаешь конкретный день/ночь в тексте (например "в ночь на..."), он должен
быть в пределах текущего месяца партии (${gameDate || "—"}) или 1-3 дня до него — НЕ выдумывай
дату из другого месяца или сезона года, это ломает хронологию партии для игрока.

Нарратив: "${narrative}"

Верни ТОЛЬКО валидный JSON (без markdown, без пояснений):
{
  "overview": {
    "headline": "1 предложение — исторический масштаб случившегося",
    "hotspots": [
      {"region": "Эпицентр удара", "text": "1-2 предложения о разрушениях и жертвах", "lat": 50.4, "lon": 30.5},
      {"region": "Ядерная тревога", "text": "1-2 предложения — страны приводят арсеналы в готовность", "lat": 48.9, "lon": 2.3},
      {"region": "Мировой кризис", "text": "1-2 предложения о реакции мирового сообщества", "lat": 40.7, "lon": -74.0}
    ]
  },
  "world_reactions": [
    {"source": "США", "text": "1-2 предложения", "tone": "neg", "escalation": 3},
    {"source": "НАТО", "text": "1-2 предложения", "tone": "neg", "escalation": 3},
    {"source": "Совет Безопасности ООН", "text": "1-2 предложения", "tone": "neg", "escalation": 1},
    {"source": "Китай", "text": "1-2 предложения", "tone": "neg", "escalation": 2},
    {"source": "Великобритания", "text": "1-2 предложения", "tone": "neg", "escalation": 2},
    {"source": "Страна-цель удара", "text": "1-2 предложения", "tone": "neg", "escalation": 3},
    {"source": "Мировые рынки", "text": "1-2 предложения о коллапсе", "tone": "neg", "escalation": 1}
  ],
  "world_moves": [
    {"country": "США", "action": "1 предложение — конкретное действие против игрока", "impact": "1 предложение", "direction": "hostile", "stat_delta": {"economy": -2}},
    {"country": "НАТО", "action": "1 предложение", "impact": "1 предложение", "direction": "hostile", "stat_delta": {"military": -1, "diplomacy": -2}},
    {"country": "Китай", "action": "1 предложение", "impact": "1 предложение", "direction": "hostile", "stat_delta": {"diplomacy": -1}}
  ]
}
escalation: 1=осуждение, 2=ультиматум, 3=угроза ядерного ответа.
stat_delta: реальные изменения статов игрока от хода противника (из набора: economy, military, stability, diplomacy, approval). Только нужные стату, значения -4..+2. Заполни все поля реальными текстами.${languageInstruction(language)}`;
}

// БАЛАНС (2026-07-04): игрок пожаловался, что ответы других стран (Анкара, Китай) "ощущаются
// как заглушки" — раньше страны различались ТОЛЬКО 3 общими категориями (ВРАГИ/СОЮЗНИКИ/
// НЕЙТРАЛЫ), без единой конкретики под конкретную страну: одна и та же инструкция "критика или
// угроза" одинаково хорошо (то есть одинаково обезличенно) подходила и США, и Польше. По аналогии
// с ADVISORS-персонами в advisors.js — короткий, но конкретный профиль реального интереса/рычага
// каждой страны, чтобы модели было от чего оттолкнуться, а не сочинять generic "критика с Запада".
const COUNTRY_PROFILES = {
  "США":               "лидер западной коалиции, санкционное давление и военная помощь Украине — главный оппонент",
  "НАТО":               "военный альянс, поставки вооружений и расширение на восток — воспринимается как прямая угроза",
  "Великобритания":     "самый ястребиный тон в риторике среди союзников Киева, инициатор новых санкционных пакетов",
  "ЕС":                 "коллективный санкционный режим, но расколот внутри — Венгрия и Словакия тормозят единство",
  "Германия":           "экономически пострадала от разрыва газовых поставок, но политически жёстко проукраинская",
  "Франция":            "балансирует между жёсткой риторикой и периодическими намёками на диалог, ядерная держава",
  "Польша":             "самый враждебный сосед, логистический хаб военной помощи Украине, историческая вражда",
  "Китай":              "стратегический партнёр, избегает прямой военной поддержки — торговля в обход санкций, расчёты в юанях вместо доллара",
  "Беларусь":           "ближайший союзник, территория для операций, полностью зависим экономически от Москвы",
  "Иран":               "поставщик дронов и ракетных технологий, сам под санкциями, общий интерес против Запада",
  "Северная Корея":     "поставщик боеприпасов и снарядов в обмен на технологии и продовольствие",
  "Индия":              "крупнейший покупатель российской нефти со скидкой, но избегает ссориться с США",
  "Турция":             "член НАТО, но балансирует — посредник в переговорах, поставляет Байрактары Украине, но не присоединяется к санкциям",
  "ОАЭ":                "финансовый хаб для параллельного импорта и перевода активов, нейтралитет ради собственной выгоды",
  "Саудовская Аравия":  "партнёр по ОПЕК+ в вопросах цены на нефть, но исторически близка к США",
  "Казахстан":          "транзитный хаб для параллельного импорта, но осторожен — не хочет злить Запад санкционными обходами",
};
function countryLine(name) {
  return `${name} (${COUNTRY_PROFILES[name] || "без особых деталей"})`;
}

function buildWorldUpdatePrompt({ countryName, turnNumber, playerInput, narrative, statDeltas, relationDeltas, currentRelations, prevOverview, language, gameDate }) {
  const deltaLines = Object.entries(statDeltas)
    .filter(([, d]) => d !== 0)
    .map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v}`)
    .join(", ") || "—";

  const relLines = (relationDeltas || []).slice(0, 4)
    .map(r => `${r.country}:${r.delta > 0 ? "+" : ""}${r.delta}`)
    .join(", ") || "—";

  return `Геополитическая стратегия. ${countryName}, ход ${turnNumber}, дата в игре: ${gameDate || "—"}.
Решение: "${playerInput}"
Изменения статов: ${deltaLines} | Отношения: ${relLines}
Контекст: ${prevOverview?.headline || "—"}
ВАЖНО ПРО ДАТЫ: если в тексте hotspots/world_reactions/world_moves упоминается конкретный день
или ночь (например "в ночь на..."), он должен быть в пределах текущего месяца партии (${gameDate || "—"})
или 1-3 дня до него — НЕ выдумывай дату из другого месяца/сезона года, это ломает хронологию
партии для игрока (баг, найденный в реальной игре: текст сослался на декабрь при дате в игре
"11 августа").

КАТЕГОРИИ СТРАН (строго соблюдай tone и direction). В скобках — конкретный интерес/рычаг этой
страны в контексте войны: используй его, а не общие фразы "критика Запада"/"поддержка союзника" —
текст каждой реакции должен явно опираться именно на ЭТОТ рычаг, иначе ответ выглядит как заглушка.
• ВРАГИ → tone:"neg", direction:"hostile": ${["США","НАТО","Великобритания","ЕС","Германия","Франция","Польша"].map(countryLine).join("; ")}
• СОЮЗНИКИ → tone:"pos", direction:"cooperative": ${["Китай","Беларусь","Иран","Северная Корея"].map(countryLine).join("; ")}
• НЕЙТРАЛЫ → tone:"neutral", direction:"neutral": ${["Индия","Турция","ОАЭ","Саудовская Аравия","Казахстан"].map(countryLine).join("; ")}

Верни ТОЛЬКО валидный JSON (без markdown):
{
  "overview": {
    "headline": "1 предложение — главное изменение",
    "hotspots": [
      {"region": "конкретный город/регион", "text": "1-2 предложения", "lat": 51.5, "lon": 30.5},
      {"region": "конкретный город/регион", "text": "1-2 предложения", "lat": 38.9, "lon": -77.0}
    ]
  },
  "world_reactions": [
    {"source": "ВЫБЕРИ 1 страну из ВРАГИ", "text": "критика или угроза — 1 предложение", "tone": "neg", "options": [{"label":"...", "type":"confront"},{"label":"...", "type":"deescalate"},{"label":"...", "type":"ignore"}]},
    {"source": "ВЫБЕРИ 1 страну из СОЮЗНИКИ", "text": "поддержка или понимание — 1 предложение", "tone": "pos", "options": [{"label":"...", "type":"cooperate"},{"label":"...", "type":"deescalate"},{"label":"...", "type":"ignore"}]},
    {"source": "ВЫБЕРИ 1 страну из НЕЙТРАЛЫ", "text": "прагматичная позиция — 1 предложение", "tone": "neutral", "options": [{"label":"...", "type":"cooperate"},{"label":"...", "type":"confront"},{"label":"...", "type":"ignore"}]}
  ],
ВАЖНО: world_reactions — ровно 3 записи, не больше и не меньше. Выбери 3 наиболее важных актора.
КАЖДАЯ запись world_reactions должна содержать "options" — РОВНО 3 варианта ответа президента на
ИМЕННО ЭТУ реакцию (не общий шаблон "созвать совещание"/"выразить обеспокоенность" — конкретная
формулировка под это конкретное событие и страну, до ~12 слов, от первого лица президента).
"type" каждого варианта — один из: "confront" (жёсткий/конфронтационный ответ), "deescalate"
(смягчить/снизить напряжение), "cooperate" (пойти навстречу/договориться), "ignore"
(проигнорировать/не реагировать). Выбери 3 наиболее логичных типа для ТОНА этой конкретной
реакции (не обязательно одинаковый набор типов для всех трёх world_reactions — врагу обычно не
подходит "cooperate", союзнику обычно не подходит "confront", но решай по контексту, не механически).
  "world_moves": [
    {"country": "1 страна из ВРАГИ", "action": "конкретное действие (санкции/нота/переброска)", "impact": "1 предложение — последствие", "direction": "hostile", "stat_delta": {"economy": -1}},
    {"country": "1 страна из СОЮЗНИКИ или НЕЙТРАЛЫ", "action": "конкретное действие (торговля/поддержка/сделка)", "impact": "1 предложение", "direction": "cooperative", "stat_delta": {"economy": 1}}
  ]
}
ПРАВИЛА: lat/lon — реальные координаты, разные регионы. stat_delta только если действие реально влияет (economy/military/stability/diplomacy/approval), значения -3..+2. Текст каждой страны уникален и конкретен.${languageInstruction(language)}`;
}

async function generateWorldUpdate({ params, callClaudeApi, meta }) {
  const isNuclear = params.actionType === "nuclear_strike";
  // Добавляем контекст исхода разведки в нарратив
  const intelOutcomes = {
    intel_critical_success: "Блестящая разведывательная операция — враги уязвлены, союзники впечатлены.",
    intel_success: "Разведывательная операция успешно завершена.",
    intel_failure: "Разведывательная операция провалена — операция скомпрометирована.",
    intel_critical_failure: "Разведывательный провал — агент задержан, дипломатический скандал.",
  };
  if (intelOutcomes[params.actionType]) {
    params = { ...params, narrative: `${intelOutcomes[params.actionType]} ${params.narrative || ""}`.trim() };
  }
  const prompt = isNuclear
    ? buildNuclearAftermathPrompt(params)
    : buildWorldUpdatePrompt(params);

  let response;
  try {
    response = await callClaudeApi({
      model: isNuclear ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
      max_tokens: isNuclear ? 6000 : 2500,
      messages: [{ role: "user", content: prompt }],
    }, { ...meta, purpose: meta?.purpose || (isNuclear ? "world_update_nuclear" : "world_update") });
  } catch (err) {
    console.error("worldUpdate Claude call failed:", err.message);
    return null;
  }

  // Проверяем stop_reason — если max_tokens, JSON скорее всего обрезан
  if (response.stop_reason === "max_tokens") {
    console.error("worldUpdate hit max_tokens limit — response truncated");
  }

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  const cleaned = rawText.replace(/```json\s*|\s*```/g, "").trim();

  // Попытка 1: нормальный JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Попытка 2: найти первый полный валидный JSON-объект
  try {
    const start = cleaned.indexOf("{");
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        else if (cleaned[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end !== -1) return JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch {}

  // Попытка 3: вытащить хотя бы overview и reactions по отдельности
  try {
    const overviewMatch = cleaned.match(/"overview"\s*:\s*(\{[\s\S]*?\})\s*,\s*"world_reactions"/);
    const reactionsMatch = cleaned.match(/"world_reactions"\s*:\s*(\[[\s\S]*?\])/);
    if (overviewMatch || reactionsMatch) {
      return {
        overview: overviewMatch ? JSON.parse(overviewMatch[1]) : null,
        world_reactions: reactionsMatch ? JSON.parse(reactionsMatch[1]) : [],
        world_moves: [],
      };
    }
  } catch {}

  console.error("worldUpdate JSON parse failed after 3 attempts, raw snippet:", cleaned.slice(0, 300));
  return null;
}

module.exports = { generateWorldUpdate };
