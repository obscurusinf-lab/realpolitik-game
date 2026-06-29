/**
 * ТЕСТ: НОВИЧОК В КОМБИНИРОВАННОМ РЕЖИМЕ
 * Смесь дипломатии и военного решения. Игрок-новичок рассуждает вслух,
 * не действует идеально, но старается:
 *   - военным давлением занять территории (рычаг на переговорах)
 *   - дипломатией поднимать мирный трек и не скатиться в изоляцию
 *   - держать тыл (экономика/рейтинг/стабильность)
 *
 * Условия исходов (из turns.js):
 *   ВОЕННАЯ ПОБЕДА (ход>=8): mil>=85, мораль>=70, готовность>=70,
 *     стаб>=52, рейтинг>=52, эко>=36, ДНР=100, ЛНР=100, 2 из 3 регионов.
 *   МИРНАЯ ПОБЕДА (ход>=12): peace>=100 И эко>=65 И рейтинг>=65 И стаб>=65.
 *   Частичные: partial_military (mil>=80), partial (статы ок), partial_peace.
 *   Поражения: рейтинг<30, эко<30, стаб<25, дип<15, эскалация>=3.
 *   MAX_TURNS = 24.
 */

const API = "https://realpolitik-game-production.up.railway.app";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function waitEvents(gameId, token, turnN, max = 18) {
  for (let i = 0; i < max; i++) {
    await sleep(2000);
    const gs = await api("GET", `/games/${gameId}`, null, token);
    if ((gs.newsfeed || []).some(n => n.turn === turnN && ["reaction", "world_move", "ukraine_action"].includes(n.type))) return gs;
  }
  return api("GET", `/games/${gameId}`, null, token);
}

const HOSTILE = ["США","Великобритания","Германия","Франция","Польша","НАТО","ЕС","Литва","Эстония","Латвия","Финляндия","Швеция","Украина"];
const ALLIES = ["Китай","Беларусь","Иран","Северная Корея","КНДР","Куба","Венесуэла","Сирия"];

function statLine(s, turn) {
  const don=s.donetsk_control??78, luh=s.luhansk_control??96, zap=s.zaporizhzhia_control??68, khe=s.kherson_control??58, kha=s.kharkiv_control??12;
  console.log(`  [Ход ${turn}] эко:${s.economy} арм:${s.military} рйт:${s.approval} стб:${s.stability} дип:${s.diplomacy} мир:${s.peace_progress??0} инц:${s.initiative??100}`);
  console.log(`           ДНР:${don}% ЛНР:${luh}% ЗАП:${zap}% ХЕР:${khe}% ХАР:${kha}% | мрл:${s.army_morale??'?'} гтв:${s.readiness??'?'}`);
  const flags = [];
  if ((s.economy??50)<38) flags.push(`эко ${s.economy}⚠`);
  if ((s.approval??50)<45) flags.push(`рйт ${s.approval}⚠`);
  if ((s.stability??50)<40) flags.push(`стб ${s.stability}⚠`);
  if ((s.diplomacy??50)<25) flags.push(`дип ${s.diplomacy}⚠`);
  if (flags.length) console.log(`           ⚠️  ${flags.join("  ")}`);
}

async function respond(gameId, token, gs, turnN, seen) {
  const items = (gs.newsfeed||[]).filter(n=>{
    const k=`${n.turn}-${n.type}-${n.source}`;
    if (seen.has(k)||n.turn!==turnN) return false;
    seen.add(k); return true;
  });
  const ua = items.filter(n=>n.type==="ukraine_action");
  const world = items.filter(n=>n.type==="reaction"||n.type==="world_move");

  for (const item of ua) {
    const meta = typeof item.reactions==="string"?JSON.parse(item.reactions):(item.reactions||{});
    const type = meta.type||"";
    const responses = meta.responses||[];
    // НОВИЧОК-ДИПЛОМАТ: на дипломатические/информационные атаки — мягкая защита, не контрудар
    // (контрудар роняет дип). На военные удары — защита. На санкции — принять.
    const sanctions = type === "sanctions_push";
    const prefer = sanctions ? "accept" : "defend";
    const chosen = responses.find(r=>r.type===prefer) || responses.find(r=>r.type==="defend") || responses[0];
    if (!chosen) continue;
    console.log(`  🇺🇦 ${item.source.replace("Украина · ","")} → [${chosen.type}]`);
    try {
      const r = await api("POST",`/games/${gameId}/ukraine-response`,{responseType:chosen.type,actionType:type},token);
      const d = Object.entries(r.delta||{}).filter(([,v])=>v!==0).map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
      const e = r.outcome==="positive"?"✅":r.outcome==="negative"?"❌":"➖";
      if (d) console.log(`     ${e} ${d}`);
    } catch(e){console.log(`     ⚠ ${e.message}`);}
  }

  for (const item of world) {
    const src = item.source||"";
    const isH = HOSTILE.some(h=>src.includes(h));
    const isA = ALLIES.some(a=>src.includes(a));
    // КОМБИНИРОВАННЫЙ: с союзниками — сотрудничество, с врагами — деэскалация (а не игнор),
    // чтобы держать дипломатию и мирный трек.
    const type = isA?"cooperate":isH?"deescalate":"deescalate";
    console.log(`  🌍 ${src.substring(0,24)} → [${type}]`);
    try {
      const r = await api("POST",`/games/${gameId}/world-response`,{responseType:type,source:src},token);
      const d = Object.entries(r.delta||{}).filter(([,v])=>v!==0).map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
      if (d) console.log(`     ${d}`);
    } catch(e){console.log(`     ⚠ ${e.message}`);}
  }
}

async function act(gameId, token, action, input) {
  if (action === "regroup") {
    const r = await api("POST",`/games/${gameId}/turns/regroup`,{},token);
    const d = Object.entries(r.statDeltas||{}).filter(([k,v])=>v!==0&&["economy","military","stability","approval","initiative","army_morale","readiness","peace_progress"].includes(k)).map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
    console.log(`  ⚙ ПЕРЕГРУППИРОВКА: ${d}`);
    return null;
  }
  const pre = await api("POST",`/games/${gameId}/turns/preview`,{playerInput:input,actionMode:action},token);
  const kd = Object.entries(pre.statDeltasPreview||{})
    .filter(([k,v])=>v!==0&&["economy","military","stability","diplomacy","approval","peace_progress","army_morale","readiness","initiative"].includes(k))
    .map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
  const icon = action==="military"?"⚔":action==="diplomacy_op"?"🤝":action.startsWith("decree")?"📋":"•";
  console.log(`  ${icon} ${action}: ${kd}`);
  const c = await api("POST",`/games/${gameId}/turns/confirm`,{},token);
  return (c.gameOutcome && c.gameOutcome !== "none") ? c.gameOutcome : null;
}

// Стоимость инициативы (из rules-engine). Пассивная регенерация +25/ход.
const INIT_COST = { military: 55, diplomacy_op: 35, decree_fast: 20, decree_reform: 35, regroup: 0 };

// Обёртка: сервер проверяет (инициатива + регенерация 25) >= стоимость.
// Если не хватает — перегруппировка.
const PASSIVE_REGEN = 25;
function gateByInitiative(step, init) {
  if (!step || step.action === "regroup") return step;
  const need = (INIT_COST[step.action] ?? 0) - PASSIVE_REGEN; // минимально нужная инициатива
  if (init < need) {
    return { action: "regroup", input: null, label: "ПЕРЕГРУППИРОВКА (мало инициативы)",
      think: `На «${step.label}» инициативы не хватает (есть ${init}). Отведу войска и накоплю.` };
  }
  return step;
}
function chooseTurn(s, turnN) {
  return gateByInitiative(chooseTurnRaw(s, turnN), s.initiative ?? 100);
}

// КОМБИНИРОВАННАЯ стратегия новичка: сначала военным давлением берём территории
// (рычаг), параллельно держим дипломатию, затем переводим преимущество в мирный трек.
function chooseTurnRaw(s, turnN) {
  const eco=s.economy??52, mil=s.military??74, init=s.initiative??100;
  const appr=s.approval??63, stab=s.stability??66, dip=s.diplomacy??48, peace=s.peace_progress??0;
  const don=s.donetsk_control??78, luh=s.luhansk_control??96;
  const zap=s.zaporizhzhia_control??68, khe=s.kherson_control??58, kha=s.kharkiv_control??12;

  const milTargets = () => {
    const t=[];
    if (don<100) t.push("Донецк");
    if (luh<100) t.push("Луганск");
    if (zap<85) t.push("Запорожье");
    if (khe<65) t.push("Херсон");
    if (kha<50 && t.length<2) t.push("Харьков");
    return t.slice(0,2).join(" и ") || "оставшиеся направления";
  };
  const territorySecured = don>=100 && luh>=100 &&
    [zap>=85,khe>=65,kha>=50].filter(Boolean).length>=2;

  // === АВАРИЙНЫЙ ТЫЛ (всегда первым) ===
  if (eco<42) return { action:"decree_fast", input:"Экстренная экономическая поддержка — резервы на рынок и оборонку.", label:"ПОДДЕРЖКА ЭКОНОМИКИ", think:"Экономика просела — без неё всё рухнет, латаю немедленно." };
  if (appr<48 || stab<46) return { action:"decree_fast", input:"Социальный пакет: выплаты семьям военных и пенсионерам, усиление порядка.", label:"ПОДДЕРЖКА ТЫЛА", think:"Тыл шатается — надо подкинуть социалки." };
  if (dip<34) return { action:"diplomacy_op", input:"Срочные консультации с Китаем и нейтральными странами — не дать Западу изолировать нас.", label:"СПАСАЕМ ДИПЛОМАТИЮ", think:"Дипломатия в красной зоне — изоляция = поражение." };

  // Ход 1: казна вперёд оружия
  if (turnN===1) return { action:"decree_fast", input:"Укрепить бюджет — льготы оборонным предприятиям и поддержка рынка.", label:"ХОД 1: УКРЕПИТЬ ТЫЛ", think:"Без денег войну не вытянешь — начну с экономики." };
  // Ход 2: одна военная реформа, чтобы армия пошла в рост
  if (turnN===2 && mil<80) return { action:"decree_reform", input:"Военная реформа: ускорить вооружение, поднять довольствие, наладить ротацию.", label:"ВОЕННАЯ РЕФОРМА", think:"Подтяну армию разок — дальше она будет крепнуть от самих наступлений." };

  if (territorySecured) {
    // Территории + мир уже должны были дать combined. Если нет — укрепляем тыл.
    return { action:"decree_fast", input:"Мирные дивиденды: программа восстановления и рост доходов населения.", label:"МИРНЫЕ ДИВИДЕНДЫ", think:"И территории, и мир есть — укрепляю тыл." };
  }

  // ЦЕЛЬ: ПРИНУЖДЕНИЕ К МИРУ (victory_combined) = территории взяты + мир>=50.
  // Ключ: мир надо поднять ДО финального захвата (иначе сработает чисто военная победа).
  //
  // ФАЗА A: сначала поднимаем мирный трек до ~48 (порог combined=40 + буфер на вероломства).
  if (peace < 48) {
    return { action:"diplomacy_op", input:"Через нейтральных посредников вести переговоры о перемирии: фиксация фактической линии в обмен на частичное снятие санкций и гарантии безопасности.", label:"ДИПЛОМАТИЯ (строим мир)", think:`Мир ${peace} — мало. Подниму мирный трек до ~48, потом военным блицем закрою территории — это даст принуждение к миру.` };
  }

  // ФАЗА B: мир набран — военный блиц закрывает территории.
  // Держим мир выше 42 (порог combined=40), чтобы захват дал именно принуждение к миру.
  if (peace < 42) {
    return { action:"diplomacy_op", input:"Срочно подтвердить перемирие через посредников, не дать мирному треку просесть перед решающим шагом.", label:"ДИПЛОМАТИЯ (держим порог)", think:"Мир просел к порогу 40 — подкреплю, иначе финальный удар даст просто военную победу." };
  }
  if (mil>=70) {
    return { action:"military", input:`Финальное наступление — приоритет ${milTargets()}. Закрыть территориальные цели с позиции уже достигнутого перемирия.`, label:`ВОЕННЫЙ БЛИЦ (${milTargets()})`, think:"Мир набран. Теперь блицем закрываю территории — в момент захвата при мире>=50 получу принуждение к миру." };
  }
  // Армия просела — разовая реформа
  return { action:"decree_reform", input:"Срочная военная реформа перед блицем: вооружение, довольствие, ротация.", label:"РЕФОРМА ПЕРЕД БЛИЦЕМ", think:"Армия просела — подтяну перед решающим наступлением." };
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  REALPOLITIK — НОВИЧОК · КОМБИНИРОВАННЫЙ РЕЖИМ");
  console.log("  Смесь дипломатии и военного давления");
  console.log("══════════════════════════════════════════════════════════════\n");

  const username = `combo_${Date.now()}`;
  await api("POST","/auth/register",{username,password:"testpass123",displayName:"Новичок-Дипломат"});
  const {token} = await api("POST","/auth/login",{username,password:"testpass123"});
  // комбинированный режим — обычная партия (с советниками доступны, но играем сами)
  const {gameId} = await api("POST","/games",{countryId:"RU",assistMode:"advisor"},token);
  console.log(`  Игра: ${gameId}\n`);

  await sleep(500);
  let gs = await api("GET",`/games/${gameId}`,null,token);
  console.log("  СТАРТ:");
  statLine(gs.stats, 0);

  const seen = new Set();
  let outcome = null;

  for (let turnN=1; turnN<=24 && !outcome; turnN++) {
    const step = chooseTurn(gs.stats, turnN);
    console.log(`\n${"─".repeat(62)}`);
    console.log(`  ХОД ${turnN}: ${step.label}`);
    if (step.think) console.log(`  💭 «${step.think}»`);
    console.log(`${"─".repeat(62)}`);

    outcome = await act(gameId, token, step.action, step.input);
    if (outcome) break;

    console.log(`  ⏳ события...`);
    gs = await waitEvents(gameId, token, turnN);
    await respond(gameId, token, gs, turnN, seen);
    gs = await api("GET",`/games/${gameId}`,null,token);
    statLine(gs.stats, turnN);

    if (gs.status && gs.status!=="active") { outcome = gs.status; break; }
  }

  console.log(`\n${"═".repeat(62)}`);
  const labels = {
    victory_military:"🏆 ВОЕННАЯ ПОБЕДА", victory:"🕊 МИРНАЯ ПОБЕДА",
    partial_military:"⚔ ЧАСТИЧНЫЙ ВОЕННЫЙ УСПЕХ", partial:"📊 ЧАСТИЧНЫЙ УСПЕХ (статы)",
    partial_peace:"🤝 ЧАСТИЧНЫЙ МИР",
    defeat_collapse:"💀 ЭКОНОМИЧЕСКИЙ КОЛЛАПС", defeat_coup:"💀 ПЕРЕВОРОТ",
    defeat_unrest:"💀 ВОЛНЕНИЯ", defeat_isolation:"💀 ИЗОЛЯЦИЯ",
    defeat_war:"💀 СПИРАЛЬ ВОЙНЫ", defeat_time:"⏳ СРОК ИСТЁК — ЦЕЛИ НЕ ДОСТИГНУТЫ",
  };
  console.log(`  РЕЗУЛЬТАТ: ${labels[outcome] || outcome || "партия не завершена"}`);
  console.log(`${"═".repeat(62)}`);
  statLine(gs.stats, "финал");

  await api("DELETE",`/games/${gameId}`,null,token).catch(()=>{});
}

main().catch(e=>{console.error("ОШИБКА:",e.message);process.exit(1);});
