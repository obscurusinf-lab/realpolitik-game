/**
 * Цель: победить. Анализ прошлых попыток:
 * - Пустой тест: победа за 9 ходов, но без сопротивления
 * - Тест с сопротивлением: поражение от экономики (eco=23 при армии mil=81)
 * - Тест новичка: поражение от экономики (eco=30 при mil=100, все территории)
 *
 * ВЫВОД: экономика — главная угроза, не военная.
 * Нужно: decree_fast каждые 2 хода, чтобы eco не падала ниже 40.
 *
 * СТРАТЕГИЯ ПОБЕДЫ:
 * Ход 1: decree_fast (укрепить базу)
 * Ход 2: military (Донецк + Луганск)
 * Ход 3: decree_fast (держим eco)
 * Ход 4: regroup (инициатива)
 * Ход 5: military (Запорожье + Херсон)
 * Ход 6: decree_fast (eco)
 * Ход 7: military (финальный удар)
 * Ход 8+: если не победили — decree_fast + military по ситуации
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
    if ((gs.newsfeed||[]).some(n => n.turn === turnN && ["reaction","world_move","ukraine_action"].includes(n.type))) return gs;
  }
  return api("GET", `/games/${gameId}`, null, token);
}

const HOSTILE = ["США","Великобритания","Германия","Франция","Польша","НАТО","ЕС","Литва","Эстония","Латвия","Финляндия","Швеция","Украина"];
const ALLIES  = ["Китай","Беларусь","Иран","Северная Корея","КНДР","Куба","Венесуэла","Сирия"];

function statLine(s, turn) {
  const don=s.donetsk_control??78, luh=s.luhansk_control??96, zap=s.zaporizhzhia_control??68, khe=s.kherson_control??58, kha=s.kharkiv_control??12;
  const terr2of3 = [zap>=85,khe>=65,kha>=50].filter(Boolean).length >= 2;
  const win = s.military>=85&&s.army_morale>=70&&s.readiness>=70&&s.stability>=52&&s.approval>=52&&s.economy>=36&&don>=100&&luh>=100&&terr2of3;
  console.log(`  [Ход ${turn}] eco:${s.economy} mil:${s.military} appr:${s.approval} stab:${s.stability} dip:${s.diplomacy} init:${s.initiative??100}`);
  console.log(`           DON:${don}% LUH:${luh}% ZAP:${zap}% KHE:${khe}% KHA:${kha}% | morale:${s.army_morale??'?'} ready:${s.readiness??'?'}`);
  const flags = [];
  if ((s.economy??50)<40) flags.push(`eco ${s.economy} ⚠`);
  if ((s.approval??50)<45) flags.push(`appr ${s.approval} ⚠`);
  if ((s.stability??50)<40) flags.push(`stab ${s.stability} ⚠`);
  if ((s.initiative??100)<25) flags.push(`init ${s.initiative??0} ⚠`);
  if (flags.length) console.log(`           ⚠️  ${flags.join("  ")}`);
  if (win) console.log(`           ⭐ ПОБЕДНЫЕ УСЛОВИЯ ВЫПОЛНЕНЫ`);
  return win;
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
    // Дипломатические/информационные атаки → defend (не роняем дипломатию через retaliate)
    // Военные атаки → defend
    // На санкции → accept (дешевле чем конфронтация)
    const diplo = ["diplomatic_offensive","war_crimes_tribunal","info_warfare"].includes(type);
    const sanctions = type === "sanctions_push";
    const preferType = sanctions ? "accept" : "defend";
    const chosen = responses.find(r=>r.type===preferType) || responses.find(r=>r.type==="defend") || responses[0];
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
    const type = isA?"cooperate":isH?"deescalate":"ignore";
    console.log(`  🌍 ${src.substring(0,25)} → [${type}]`);
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
    const d = Object.entries(r.statDeltas||{}).filter(([k,v])=>v!==0&&["economy","military","stability","approval","initiative","army_morale","readiness"].includes(k)).map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
    console.log(`  ⚙ ПЕРЕГРУППИРОВКА: ${d}`);
    return null;
  }
  const pre = await api("POST",`/games/${gameId}/turns/preview`,{playerInput:input,actionMode:action},token);
  const kd = Object.entries(pre.statDeltasPreview||{})
    .filter(([k,v])=>v!==0&&["economy","military","stability","diplomacy","approval","peace_progress","army_morale","readiness","initiative"].includes(k))
    .map(([k,v])=>`${k}:${v>0?"+":""}${v}`).join(", ");
  console.log(`  ${action === "military" ? "⚔" : action.startsWith("decree") ? "📋" : "🤝"} ${action}: ${kd}`);
  const c = await api("POST",`/games/${gameId}/turns/confirm`,{},token);
  return (c.gameOutcome && c.gameOutcome !== "none") ? c.gameOutcome : null;
}

// Динамический план — выбирает действие исходя из текущих статов
// Оптимум: reform → mil → regroup → mil → regroup → mil → WIN
// Экономика сама по себе не растёт от decree_fast (только +3 vs ~-4 пассивный дрейф).
// Победить надо за 6-7 ходов, пока eco ещё выше 36.
function chooseTurn(s, turnN) {
  const eco = s.economy??52, mil = s.military??74, init = s.initiative??100;
  const don = s.donetsk_control??78, luh = s.luhansk_control??96;
  const zap = s.zaporizhzhia_control??68, khe = s.kherson_control??58, kha = s.kharkiv_control??12;

  // "Почти победа" — особая логика
  // Военный ход стоит ~5 eco. Нужно входить в финальный удар с eco >= 43
  const almostWon = mil >= 85 && don >= 90 && luh >= 98 &&
    ([zap >= 80, khe >= 60, kha >= 45].filter(Boolean).length >= 2);
  if (almostWon) {
    if (eco >= 43 && init >= 55) {
      // Eco в норме — финальный удар
      const targets = [];
      if (don < 100) targets.push("Донецк");
      if (zap < 85) targets.push("Запорожье");
      if (khe < 65) targets.push("Херсон");
      const focus = targets.slice(0,2).join(" и ") || "завершение операции";
      return { action: "military", input: `ФИНАЛЬНЫЙ УДАР — ${focus}. Все резервы, авиация, артиллерия. Добить.`, label: `ФИНАЛЬНЫЙ УДАР (${focus})` };
    }
    if (eco < 43 && init >= 20) {
      // Нужен буфер eco перед финальным ударом
      return { action: "decree_fast", input: "Настоящим постановляю: экстренный бюджетный манёвр — поддержать экономику перед решающей операцией.", label: "БУФЕР ECO ПЕРЕД ФИНАЛОМ" };
    }
    if (init < 55) {
      // Нет инициативы — перегруппировка
      return { action: "regroup", input: null, label: "ПЕРЕГРУППИРОВКА ПЕРЕД ФИНАЛОМ" };
    }
  }

  // Инициатива ниже порога для военных — перегруппировка (стоит 55)
  if (init < 55) {
    return { action: "regroup", input: null, label: "ПЕРЕГРУППИРОВКА (init < 55)" };
  }

  // Экономика опасная — указ
  if (eco < 42) {
    return { action: "decree_fast", input: "Настоящим постановляю: экстренный бюджетный манёвр — перераспределить резервные фонды на поддержку потребительского рынка и оборонных предприятий.", label: "ПОДДЕРЖКА ЭКОНОМИКИ" };
  }

  // Ход 1: decree_fast для создания eco-буфера (армия и так раскачается наступлениями)
  if (turnN === 1) {
    return { action: "decree_fast", input: "Настоящим постановляю: оптимизировать оборонный бюджет — ускорить оборот государственных резервов, ввести льготное налогообложение для оборонных предприятий и поддержать потребительский рынок для сохранения социальной стабильности.", label: "ХОД 1: ECO БУФЕР" };
  }

  // Всё остальное время — наступление пока есть инициатива
  const targets = [];
  if (don < 100) targets.push("Донецк");
  if (luh < 100) targets.push("Луганск");
  if (zap < 85) targets.push("Запорожье");
  if (khe < 65) targets.push("Херсон");
  if (kha < 50 && targets.length < 2) targets.push("Харьков");
  const focus = targets.slice(0,2).join(" и ") || "все оставшиеся направления";

  return {
    action: "military",
    input: `Наступление — приоритет: ${focus}. Концентрировать ударные группировки, бронетехнику и артиллерию на ключевых направлениях прорыва. Не давать противнику перегруппироваться.`,
    label: `НАСТУПЛЕНИЕ (${focus})`
  };
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  REALPOLITIK — ПОПЫТКА ПОБЕДЫ");
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Стратегия: чередовать наступления с eco-указами,");
  console.log("  перегруппировка вместо пропуска, реагировать на всё.\n");

  const username = `win_${Date.now()}`;
  await api("POST","/auth/register",{username,password:"testpass123",displayName:"Победитель"});
  const {token} = await api("POST","/auth/login",{username,password:"testpass123"});
  const {gameId} = await api("POST","/games",{countryId:"RU"},token);
  console.log(`  Игра: ${gameId}\n`);

  await sleep(500);
  let gs = await api("GET",`/games/${gameId}`,null,token);
  console.log("  СТАРТ:");
  statLine(gs.stats, 0);
  console.log();

  const seen = new Set();
  let outcome = null;

  for (let turnN = 1; turnN <= 15 && !outcome; turnN++) {
    const step = chooseTurn(gs.stats, turnN);
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ХОД ${turnN}: ${step.label}`);
    console.log(`${"─".repeat(60)}`);

    outcome = await act(gameId, token, step.action, step.input);
    if (outcome) break;

    console.log(`  ⏳ события...`);
    gs = await waitEvents(gameId, token, turnN);
    await respond(gameId, token, gs, turnN, seen);
    gs = await api("GET",`/games/${gameId}`,null,token);
    const won = statLine(gs.stats, turnN);
    if (won) console.log(`\n  ⭐ Проверяем победу через сервер...`);

    if (gs.status && gs.status !== "active") { outcome = gs.status; break; }
  }

  console.log(`\n${"═".repeat(60)}`);
  if (outcome === "victory_military") {
    console.log("  🏆 ПОБЕДА — ВОЕННАЯ");
  } else if (outcome === "victory_peace") {
    console.log("  🕊 ПОБЕДА — МИРНАЯ");
  } else if (outcome?.startsWith("defeat")) {
    console.log(`  💀 ПОРАЖЕНИЕ: ${outcome}`);
  } else {
    console.log(`  ⏸ Лимит ходов. Статус: ${outcome||"active"}`);
  }
  console.log(`${"═".repeat(60)}`);
  statLine(gs.stats, "финал");

  await api("DELETE",`/games/${gameId}`,null,token).catch(()=>{});
}

main().catch(e=>{console.error("ОШИБКА:",e.message);process.exit(1);});
