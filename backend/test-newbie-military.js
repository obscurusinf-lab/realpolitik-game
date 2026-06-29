/**
 * Тест: новичок пробует военную победу
 * Описывает ход мыслей, использует перегруппировку вместо пропуска,
 * отвечает на все действия Украины и реакции мира.
 */

const API = "https://realpolitik-game-production.up.railway.app";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${API}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function waitForEvents(gameId, token, turnN, maxAttempts = 18) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const gs = await api("GET", `/games/${gameId}`, null, token);
    const newItems = (gs.newsfeed || []).filter(n =>
      n.turn >= turnN && (n.type === "reaction" || n.type === "world_move" || n.type === "ukraine_action")
    );
    if (newItems.length > 0) return gs;
  }
  return await api("GET", `/games/${gameId}`, null, token);
}

function box(label, char = "═") { return `\n${char.repeat(65)}\n  ${label}\n${char.repeat(65)}`; }
function line(char = "─") { return char.repeat(65); }

function logStats(stats, turn) {
  const s = stats;
  const don = s.donetsk_control ?? 78;
  const luh = s.luhansk_control ?? 96;
  const zap = s.zaporizhzhia_control ?? 68;
  const khe = s.kherson_control ?? 58;
  const kha = s.kharkiv_control ?? 12;
  const milVictory = s.military >= 85 && s.army_morale >= 70 && s.readiness >= 70
    && s.stability >= 52 && s.approval >= 52 && s.economy >= 36
    && don >= 100 && luh >= 100
    && ([zap >= 85, khe >= 65, kha >= 50].filter(Boolean).length >= 2);

  console.log(`  📊 eco:${s.economy??'?'} mil:${s.military??'?'} appr:${s.approval??'?'} stab:${s.stability??'?'} dip:${s.diplomacy??'?'}`);
  console.log(`  🕊  Peace:${s.peace_progress??0}   Init:${s.initiative??100}   Ход:${turn}`);
  console.log(`  🗺  DON:${don}% LUH:${luh}% ZAP:${zap}% KHE:${khe}% KHA:${kha}%`);
  console.log(`  🪖  Мораль:${s.army_morale??'?'}  Готовность:${s.readiness??'?'}`);
  if (milVictory) console.log(`\n  ⭐⭐⭐ УСЛОВИЯ ВОЕННОЙ ПОБЕДЫ ВЫПОЛНЕНЫ ⭐⭐⭐`);
  // Предупреждения
  if ((s.economy??50) < 36) console.log(`  ⚠️  КРИТИЧНО: Экономика ${s.economy} — порог катастрофы 30!`);
  if ((s.approval??50) < 38) console.log(`  ⚠️  КРИТИЧНО: Рейтинг ${s.approval} — угроза переворота!`);
  if ((s.stability??50) < 32) console.log(`  ⚠️  КРИТИЧНО: Стабильность ${s.stability} — народные волнения!`);
  if ((s.diplomacy??50) < 22) console.log(`  ⚠️  КРИТИЧНО: Дипломатия ${s.diplomacy} — полная изоляция!`);
  if ((s.initiative??100) < 20) console.log(`  ⚠️  Инициатива ${s.initiative} — нужна перегруппировка!`);
}

const HOSTILE = ["США", "Великобритания", "Германия", "Франция", "Польша", "НАТО", "ЕС", "Украина", "Литва", "Эстония", "Латвия", "Финляндия", "Швеция"];
const ALLIES  = ["Китай", "Беларусь", "Иран", "Северная Корея", "КНДР", "Сирия", "Куба", "Венесуэла"];

async function handleUkraine(gameId, token, items) {
  for (const item of items) {
    const meta = typeof item.reactions === "string" ? JSON.parse(item.reactions) : (item.reactions || {});
    const responses = meta.responses || [];
    const actionType = meta.type || "";
    console.log(`\n  🇺🇦 ${item.source}`);
    console.log(`     Событие: "${item.text.substring(0, 110)}..."`);
    if (!responses.length) { console.log(`     [нет вариантов]`); continue; }

    // Стратегия ответа
    let chosenType = "defend";
    let reasoning = "";
    if (["diplomatic_offensive","war_crimes_tribunal","info_warfare","sanctions_push"].includes(actionType)) {
      // Дипломатические атаки — лучше отвечать ретальяцией (агрессивно, как новичок)
      chosenType = "retaliate";
      reasoning = "Украина давит дипломатически — новичок выбирает жёсткий ответ";
    } else if (["drone_strike","rail_sabotage","counterattack","dnipro_push","weapons_delivery"].includes(actionType)) {
      chosenType = "defend";
      reasoning = "Военная атака — оборона и закрытие уязвимостей";
    } else {
      chosenType = "defend";
      reasoning = "Неизвестный тип — осторожно, обороняемся";
    }
    const chosen = responses.find(r => r.type === chosenType) || responses[0];
    console.log(`     💭 Мысль: ${reasoning}`);
    console.log(`     → Ответ [${chosen.type.toUpperCase()}]: "${chosen.label}"`);
    try {
      const r = await api("POST", `/games/${gameId}/ukraine-response`, { responseType: chosen.type, actionType }, token);
      const delta = Object.entries(r.delta||{}).filter(([,v])=>v!==0).map(([k,v])=>`${k}:${v>0?'+':''}${v}`).join(", ");
      const emoji = r.outcome==="positive"?"✅":r.outcome==="negative"?"❌":"➖";
      console.log(`     ${emoji} ${r.outcome}: ${r.outcomeText||""}${delta?` | ${delta}`:""}`);
    } catch(e) { console.log(`     ⚠ Ошибка: ${e.message}`); }
  }
}

async function handleWorld(gameId, token, items) {
  const reactions = items.filter(n => n.type === "reaction" || n.type === "world_move");
  if (!reactions.length) return;
  console.log(`\n  ──── 🌍 Реакция мира (${reactions.length} событий) ────`);
  for (const item of reactions) {
    const source = item.source || "";
    const isHostile = HOSTILE.some(h => source.includes(h));
    const isAlly = ALLIES.some(a => source.includes(a));
    const responseType = isAlly ? "cooperate" : isHostile ? "deescalate" : "ignore";
    const reasoning = isAlly ? "союзник — укрепляем" : isHostile ? "враг — снижаем эскалацию" : "нейтрал — игнорируем";
    console.log(`  🌍 ${source} → [${responseType}] (${reasoning})`);
    console.log(`     "${item.text.substring(0, 85)}..."`);
    try {
      const r = await api("POST", `/games/${gameId}/world-response`, { responseType, source }, token);
      const delta = Object.entries(r.delta||{}).filter(([,v])=>v!==0).map(([k,v])=>`${k}:${v>0?'+':''}${v}`).join(", ");
      if (delta) console.log(`     → ${delta}`);
    } catch(e) { console.log(`     ⚠ ${e.message}`); }
  }
}

async function doTurn(gameId, token, turnN, action, input, thought, seenItems) {
  console.log(`\n${line()}`);
  console.log(`  ХОД ${turnN} — ${action.toUpperCase()}`);
  console.log(line());
  console.log(`\n  💭 МЫСЛИ НОВИЧКА: ${thought}`);

  if (action === "regroup") {
    console.log(`\n  ⚙ Выбираю ПЕРЕГРУППИРОВКУ — армии нужна передышка, восстановить инициативу`);
    const r = await api("POST", `/games/${gameId}/turns/regroup`, {}, token);
    const d = Object.entries(r.statDeltas||{}).filter(([k,v])=>v!==0&&["economy","military","stability","approval","initiative","army_morale","readiness"].includes(k)).map(([k,v])=>`${k}:${v>0?'+':''}${v}`).join(", ");
    console.log(`  📋 ${r.narrative}`);
    console.log(`  📈 Результат: ${d||"без изменений"}`);
    return null;
  }

  console.log(`\n  🎯 Режим: ${action}`);
  console.log(`  📝 Текст приказа: "${input.substring(0, 120)}..."`);

  const preview = await api("POST", `/games/${gameId}/turns/preview`, { playerInput: input, actionMode: action }, token);
  if (preview.advisorObjection) {
    console.log(`\n  ⚠️  СОВЕТНИК: ${preview.advisorObjection.substring(0, 150)}...`);
    console.log(`  💭 Новичок: понял предупреждение, но всё равно подтверждаю — цель важнее`);
  }
  const keyDeltas = Object.entries(preview.statDeltasPreview||{})
    .filter(([k,v])=>v!==0&&["economy","military","stability","diplomacy","approval","peace_progress","army_morale","readiness","initiative"].includes(k))
    .map(([k,v])=>`${k}:${v>0?'+':''}${v}`).join(", ");
  console.log(`  📈 Превью изменений: ${keyDeltas||"(нет ключевых)"}`);

  const confirm = await api("POST", `/games/${gameId}/turns/confirm`, {}, token);
  const outcome = confirm.gameOutcome && confirm.gameOutcome !== "none" ? confirm.gameOutcome : null;
  if (outcome) console.log(`\n  🏁 ИСХОД ИГРЫ: ${outcome}`);
  return outcome;
}

async function main() {
  console.log(box("🎮 REALPOLITIK — ИГРА НОВИЧКА: ВОЕННАЯ ПОБЕДА", "═"));
  console.log(`
Я — новый игрок. Хочу победить военным путём — захватить все четыре региона.
Знаю, что нужно: Донецк 100%, Луганск 100%, и ещё хотя бы 2 из 3 (Запорожье, Херсон, Харьков).
Проблема — не очень понимаю как работает инициатива и экономика. Буду разбираться.

Стратегия (план новичка):
  1. Сначала укреплю армию — нужны военные реформы
  2. Потом дипломатия — чтобы мир не давил слишком сильно
  3. Наступление на Донецк — самое важное
  4. Перегруппировка если инициатива упала
  5. Ещё наступление — Луганск + Запорожье
  6. Ещё раз дать армии отдых
  7. Финальный удар по всем направлениям
  8. Если экономика просела — быстрый указ
`);

  const username = `newbie_${Date.now()}`;
  await api("POST", "/auth/register", { username, password: "testpass123", displayName: "Новичок" });
  const { token } = await api("POST", "/auth/login", { username, password: "testpass123" });
  console.log("✓ Авторизован как новичок\n");

  const { gameId } = await api("POST", "/games", { countryId: "RU" }, token);
  console.log(`✓ Игра начата: ${gameId}`);

  await sleep(500);
  let gs = await api("GET", `/games/${gameId}`, null, token);

  console.log(box("НАЧАЛО ИГРЫ — ОЦЕНИВАЮ СИТУАЦИЮ"));
  logStats(gs.stats, 0);
  console.log(`
  💭 ПЕРВЫЕ МЫСЛИ НОВИЧКА:
  Окей, смотрю на цифры. Армия 74 — неплохо, но для победы нужно 85+.
  Экономика 52 — средняя, нужно следить чтобы не упала ниже 30 (катастрофа).
  Рейтинг 63 — норм, ниже 30 будет переворот.
  Инициатива 100 — отлично, могу действовать.
  Мирный трек 12 — очень низкий, но мне нужна военная победа, не мирная.

  Донецк 78%, Луганск 96% — Луганск почти мой!
  Харьков 12% — очень мало, наверное стоит сосредоточиться на других.

  ПЛАН: Сначала реформирую армию (decree_reform), потом буду наступать.
  Перегруппировка вместо пропуска — советник подсказал что есть такая опция.
`);

  const seenItems = new Set();
  let outcome = null;

  const TURNS = [
    {
      action: "decree_reform",
      input: "Провести масштабную реформу вооружённых сил: модернизировать систему боевой подготовки, обновить тяжёлую технику и артиллерийский парк, ввести новую систему ротации подразделений на передовой. Выделить дополнительное финансирование на контрактную службу.",
      thought: "Первый ход — и я хочу сразу укрепить армию. Мне сказали что для военной победы нужна армия 85+, а у меня 74. Decree_reform даёт +4..+6, должно помочь. Да, потрачу 35 инициативы, но оно того стоит.",
    },
    {
      action: "diplomacy_op",
      input: "Провести консультации с Китаем и Индией о нейтральной позиции. Обозначить что Россия открыта к диалогу — но только на своих условиях. Цель: снизить международное давление перед активной военной фазой.",
      thought: "Армия чуть выросла. Теперь дипломатия — хочу чтобы мир не давил пока я буду наступать. Китай и Индия важны — они хотя бы нейтральны. Дипломатия стоит 35 инициативы... после реформы у меня должно быть ещё прилично.",
    },
    {
      action: "military",
      input: "Начать наступление на Донецком направлении — концентрированный удар на ключевые узлы Донецкой агломерации. Задействовать все готовые соединения. Цель: установить полный контроль над Донецком.",
      thought: "Инициатива должна была восстановиться. Первое большое наступление! Сосредотачиваюсь на Донецке — там уже 78%, надо добить до 100%. Военная операция стоит 55 инициативы — это много, после неё надо будет перегруппироваться.",
    },
    {
      action: "regroup",
      input: null,
      thought: "После наступления инициатива, скорее всего, упала. Советник говорит использовать перегруппировку — армия устала, нужен отдых. Это лучше чем пропуск: мораль вырастет, инициатива восстановится на 75, и без штрафов к экономике.",
    },
    {
      action: "military",
      input: "Развить успех на Донецком направлении — дожать остатки сопротивления и установить полный контроль. Одновременно начать давление на Луганском направлении — там 96%, один сильный удар должен завершить захват.",
      thought: "Инициатива восстановлена! Теперь второй удар — хочу закрыть и Донецк и Луганск. Луганск на 96%, значит ещё чуть-чуть и он мой. Донецк пока не 100% — продолжаю давить.",
    },
    {
      action: "decree_fast",
      input: "Настоящим постановляю: объявить о повышении единовременных выплат семьям военнослужащих и ввести льготное кредитование для участников боевых действий. Дополнительные средства на поддержку оборонной промышленности.",
      thought: "Проверяю показатели — надо держать экономику и рейтинг. Быстрый указ стоит всего 20 инициативы и даёт +3 к экономике и рейтингу. Это как 'быстрая таблетка' между наступлениями. Советник предупреждал про дефицит бюджета, но сейчас важно не дать упасть рейтингу.",
    },
    {
      action: "military",
      input: "Масштабное наступление по всему фронту: Запорожское и Херсонское направления — главный удар. Одновременно добить оставшиеся очаги сопротивления в Донецке и Луганске. Ввести в бой резервные бронетанковые соединения.",
      thought: "Луганск и Донецк должны быть близко к 100%. Теперь надо Запорожье (нужно 85%) и Херсон (нужно 65%). Бросаю всё в наступление — это решающий момент. После этого снова перегруппировка.",
    },
    {
      action: "regroup",
      input: null,
      thought: "Инициатива снова на нуле после двух подряд наступлений. Перегруппировка — армия уже воевала несколько ходов подряд, мораль нужно восстановить. Да и армейские показатели (мораль и готовность) влияют на победные условия.",
    },
    {
      action: "military",
      input: "Операция финального закрепления: установить полный контроль над Запорожьем и Херсоном. Одновременно продолжить давление на Харьковском направлении — нарастить присутствие хотя бы до 50%. Использовать воздушную поддержку и артиллерию.",
      thought: "Это может быть решающий ход. Если Запорожье перейдёт 85% и Херсон 65% — я победил! Смотрю на условия победы: mil≥85, army_morale≥70, readiness≥70, stability≥52, approval≥52, economy≥36, DON=100, LUH=100, и 2 из 3 территорий. Всё складывается.",
    },
    {
      action: "decree_fast",
      input: "Настоящим постановляю: в целях поддержки экономики военного времени ввести налоговые льготы для стратегических предприятий и выделить резервный фонд для сглаживания инфляционного давления. Дополнительная социальная поддержка семей военнослужащих.",
      thought: "Экономика, наверное, просела после всех наступлений. Если она упадёт ниже 30 — GAME OVER. Быстрый указ поможет. Да, трачу ход, но лучше поддержать тыл чем потерять игру из-за коллапса.",
    },
    {
      action: "military",
      input: "Финальный удар — добить все оставшиеся очаги. Максимальное давление на Запорожье и Херсон для достижения победных порогов. Если не победил — продолжать наступление на Харькове.",
      thought: "Если ещё не победил — значит не хватает каких-то показателей. Продолжаю давить военно. Интересно посмотреть насколько реально выиграть без идеальной стратегии.",
    },
    {
      action: "diplomacy_op",
      input: "Активизировать дипломатические контакты через нейтральные площадки. Передать сигнал: Россия достигла стратегических целей и готова обсудить стабилизацию на занятых позициях.",
      thought: "Пробую дипломатию в конце — может поможет зафиксировать результаты и улучшить мирный трек.",
    },
  ];

  for (let i = 0; i < TURNS.length && !outcome; i++) {
    const step = TURNS[i];
    const turnN = i + 1;

    outcome = await doTurn(gameId, token, turnN, step.action, step.input, step.thought, seenItems);

    if (!outcome) {
      console.log(`\n  ⏳ Ждём реакцию мира...`);
      gs = await waitForEvents(gameId, token, turnN);

      const newItems = (gs.newsfeed || []).filter(n => {
        const key = `${n.turn}-${n.type}-${n.source}`;
        if (seenItems.has(key) || n.turn !== turnN) return false;
        seenItems.add(key);
        return true;
      });

      const uaItems = newItems.filter(n => n.type === "ukraine_action");
      const worldItems = newItems.filter(n => n.type === "reaction" || n.type === "world_move");

      if (uaItems.length === 0 && worldItems.length === 0) {
        console.log(`  [Мир пока молчит на этом ходу]`);
      }

      await handleUkraine(gameId, token, uaItems);
      await handleWorld(gameId, token, worldItems);

      gs = await api("GET", `/games/${gameId}`, null, token);
      console.log(box(`ИТОГ ХОДА ${turnN}`, "─"));
      logStats(gs.stats, turnN);

      if (gs.status && gs.status !== "active") {
        outcome = gs.status;
        break;
      }
    }
  }

  console.log(box("═══════════════════════ ФИНАЛ ИГРЫ ════════════════════════", "═"));
  const s = gs.stats;
  const won = outcome === "victory_military";
  const lost = outcome && outcome.startsWith("defeat");

  if (won) {
    console.log(`\n  🏆 ВОЕННАЯ ПОБЕДА!\n`);
    console.log(`  Новичок справился! Ключевые ходы:`)
    console.log(`  - Реформа армии в начале дала фундамент`);
    console.log(`  - Перегруппировка вместо пропуска сэкономила экономику`);
    console.log(`  - Дипломатия снизила давление извне`);
  } else if (lost) {
    console.log(`\n  💀 ПОРАЖЕНИЕ: ${outcome}`);
    console.log(`\n  Новичок проиграл. Разбор ошибок:`);
    if ((s.economy??50) < 36) console.log(`  - Экономика рухнула до ${s.economy} — слишком много военных ходов без поддержки`);
    if ((s.approval??50) < 38) console.log(`  - Рейтинг упал до ${s.approval} — нужно было больше социальных указов`);
    if ((s.military??50) < 85) console.log(`  - Армия ${s.military} — не дотянула до 85 для победы`);
    const don = s.donetsk_control??78, luh = s.luhansk_control??96;
    if (don < 100 || luh < 100) console.log(`  - Территории: DON ${don}% LUH ${luh}% — не захватил все нужные регионы`);
  } else {
    console.log(`\n  ⏸ Игра продолжается (12 ходов исчерпаны)`);
    console.log(`  Новичок не успел за 12 ходов — нужно было быстрее действовать`);
  }

  console.log(`\nФинальные статы:`);
  logStats(gs.stats, "финал");

  await api("DELETE", `/games/${gameId}`, null, token).catch(() => {});
  console.log("\n✓ Готово\n");
}

main().catch(e => { console.error("\nОШИБКА:", e.message); process.exit(1); });
