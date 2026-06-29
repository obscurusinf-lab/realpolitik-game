/**
 * Тест: полный прогон с сопротивлением
 * - Отвечаем на каждое действие Украины
 * - Отвечаем на каждую реакцию мира
 * - Детально логируем всё происходящее
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

// Ждём пока в ленте появятся новые события за этот ход
async function waitForEvents(gameId, token, turnN, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const gs = await api("GET", `/games/${gameId}`, null, token);
    const newItems = (gs.newsfeed || []).filter(n =>
      n.turn >= turnN && (n.type === "reaction" || n.type === "world_move" || n.type === "ukraine_action")
    );
    if (newItems.length > 0) return gs;
    process.stdout.write(`  [ждём события... ${i + 1}/${maxAttempts}]\r`);
  }
  return await api("GET", `/games/${gameId}`, null, token);
}

function logStats(label, stats, turn) {
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

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  ХОД ${turn} — ${label}`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  📊 eco:${s.economy??'?'} mil:${s.military??'?'} appr:${s.approval??'?'} stab:${s.stability??'?'} dip:${s.diplomacy??'?'}`);
  console.log(`  🕊  Peace: ${s.peace_progress??0}   Init: ${s.initiative??100}`);
  console.log(`  🗺  DON:${don} LUH:${luh} ZAP:${zap} KHE:${khe} KHA:${kha}`);
  console.log(`  🪖  morale:${s.army_morale??'?'} readiness:${s.readiness??'?'}`);
  if (milVictory) console.log(`  ⭐ ВОЕННАЯ ПОБЕДА ДОСТИГНУТА!`);
  console.log();
}

// Отвечаем на действия Украины — выбираем оптимальный ответ
async function handleUkraineActions(gameId, token, items, stats) {
  if (items.length === 0) return;

  console.log(`\n  ──── 🇺🇦 ДЕЙСТВИЯ УКРАИНЫ (${items.length}) ────`);
  for (const item of items) {
    const meta = typeof item.reactions === "string" ? JSON.parse(item.reactions) : (item.reactions || {});
    const responses = meta.responses || [];

    console.log(`  🇺🇦 ${item.source}`);
    console.log(`     "${item.text.substring(0, 100)}..."`);

    if (responses.length === 0) {
      console.log(`     [нет вариантов ответа]`);
      continue;
    }

    // Стратегия ответа: defend если атака на территорию/армию, retaliate если дипломатия/санкции
    const actionType = meta.type || "";
    let chosenType = "defend";
    if (["diplomatic_offensive", "war_crimes_tribunal", "info_warfare", "sanctions_push"].includes(actionType)) {
      chosenType = "retaliate";
    } else if (["drone_strike", "rail_sabotage", "counterattack", "dnipro_push"].includes(actionType)) {
      chosenType = "defend";
    } else if (actionType === "weapons_delivery") {
      chosenType = "defend";
    } else {
      chosenType = "defend";
    }

    const chosen = responses.find(r => r.type === chosenType) || responses[0];
    console.log(`  → Ответ [${chosen.type.toUpperCase()}]: "${chosen.label}"`);

    try {
      const result = await api("POST", `/games/${gameId}/ukraine-response`,
        { responseType: chosen.type, actionType },
        token
      );
      const delta = Object.entries(result.delta || {}).filter(([,v]) => v !== 0).map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      const outcomeEmoji = result.outcome === "positive" ? "✅" : result.outcome === "negative" ? "❌" : "➖";
      console.log(`  ${outcomeEmoji} Итог: ${result.outcome} | ${result.outcomeText || ""}`);
      if (delta) console.log(`     Дельта: ${delta}`);
    } catch (e) {
      console.log(`  ⚠  Ошибка ответа на Украину: ${e.message}`);
    }
  }
}

// Отвечаем на реакции мира
async function handleWorldReactions(gameId, token, items) {
  const reactions = items.filter(n => n.type === "reaction" || n.type === "world_move");
  if (reactions.length === 0) return;

  console.log(`\n  ──── 🌍 РЕАКЦИЯ МИРА (${reactions.length}) ────`);

  // Классификация источников
  const allies = ["Китай", "Беларусь", "Иран", "Северная Корея", "Сирия", "Куба", "Венесуэла", "Никарагуа"];
  const hostiles = ["США", "Великобритания", "Германия", "Франция", "Польша", "НАТО", "ЕС", "Украина", "Литва", "Эстония", "Латвия"];

  for (const item of reactions) {
    const source = item.source || "";
    const text = item.text || "";
    console.log(`  🌍 ${source}`);
    console.log(`     "${text.substring(0, 90)}..."`);

    // Выбираем тип ответа
    const isHostile = hostiles.some(h => source.includes(h));
    const isAlly = allies.some(a => source.includes(a));
    let responseType;
    if (isHostile) responseType = "deescalate"; // снижаем эскалацию с врагами
    else if (isAlly) responseType = "cooperate"; // укрепляем союзников
    else responseType = "ignore";               // нейтральные — игнорируем

    try {
      const result = await api("POST", `/games/${gameId}/world-response`,
        { responseType, source },
        token
      );
      const delta = Object.entries(result.delta || {}).filter(([,v]) => v !== 0).map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      const outcomeEmoji = result.outcome === "positive" ? "✅" : result.outcome === "negative" ? "❌" : "➖";
      console.log(`  → [${responseType.toUpperCase()}] ${outcomeEmoji} ${delta || "без изменений"}`);
    } catch (e) {
      console.log(`  ⚠  Ошибка мирового ответа: ${e.message}`);
    }
  }
}

const PLAN = [
  {
    action: "diplomacy_op",
    input: "Провести закрытые консультации с китайскими и индийскими партнёрами через МИД. Обозначить готовность к мирным переговорам на собственных условиях — предложить план прекращения огня при сохранении контроля над занятыми территориями.",
    note: "Ход 1: Дипломатия — поднять мирный трек, укрепить поддержку до наступления",
  },
  {
    action: "military",
    input: "Начать скоординированное наступление по всей линии соприкосновения — приоритет Донецкое направление. Задействовать все имеющиеся резервы, артиллерию и бронетехнику. Цель: установить полный контроль над Донецкой агломерацией.",
    note: "Ход 2: Главный удар — Донецк + давление по всему фронту",
  },
  {
    action: "skip",
    input: null,
    note: "Ход 3: Пропуск — восстановить инициативу",
  },
  {
    action: "military",
    input: "Развить успех предыдущего наступления — скоординированный удар на Луганском, Запорожском и Херсонском направлениях. Ввести в бой свежие резервные подразделения.",
    note: "Ход 4: Второй удар — Луганск, Запорожье, Херсон",
  },
  {
    action: "decree_fast",
    input: "Объявить о значительном повышении денежного довольствия военнослужащих и выплат семьям погибших. Ввести налоговые льготы для предприятий оборонно-промышленного комплекса.",
    note: "Ход 5: Быстрый указ — поддержать рейтинг и экономику",
  },
  {
    action: "diplomacy_op",
    input: "Активизировать дипломатические контакты через турецкую площадку — передать детальный мирный план с фиксацией территориального статус-кво.",
    note: "Ход 6: Дипломатия — мирный трек не должен падать",
  },
  {
    action: "military",
    input: "Финальный решающий удар: сосредоточить максимальные силы на установление полного контроля над Донецкой и Луганской областями. Параллельно — активные операции в Запорожье и Херсоне.",
    note: "Ход 7: Решающий удар — выйти на пороги победы",
  },
  {
    action: "skip",
    input: null,
    note: "Ход 8: Пропуск — восстановить инициативу",
  },
  {
    action: "military",
    input: "Операция 'Завершение' — удар с задачей установить контроль над всеми четырьмя регионами.",
    note: "Ход 9: Финальное наступление",
  },
  {
    action: "decree_fast",
    input: "Экстренные меры поддержки экономики: снизить налоговую нагрузку на малый бизнес, выпустить государственные облигации для финансирования военных расходов.",
    note: "Ход 10: Укрепить экономику если ещё не победили",
  },
  {
    action: "diplomacy_op",
    input: "Последние переговоры через посредников для официального оформления прекращения огня на российских условиях.",
    note: "Ход 11: Финальная дипломатия",
  },
  {
    action: "military",
    input: "Добить оставшиеся очаги сопротивления. Полное занятие Луганска, Донецка.",
    note: "Ход 12: Последнее давление",
  },
];

async function main() {
  console.log("🎮 REALPOLITIK — ПОЛНЫЙ ПРОГОН С СОПРОТИВЛЕНИЕМ");
  console.log("Отвечаем на ВСЕ действия Украины и реакции мира\n");

  const username = `test_full_${Date.now()}`;
  await api("POST", "/auth/register", { username, password: "testpass123", displayName: "Полный тест" });
  const { token } = await api("POST", "/auth/login", { username, password: "testpass123" });
  console.log("✓ Авторизован");

  const { gameId } = await api("POST", "/games", { countryId: "RU" }, token);
  console.log(`✓ Игра создана: ${gameId}\n`);

  await sleep(500);
  let gs = await api("GET", `/games/${gameId}`, null, token);
  logStats("НАЧАЛО ИГРЫ", gs.stats, 0);

  let outcome = null;
  const seenItems = new Set(); // чтобы не отвечать дважды на одни события

  for (let i = 0; i < PLAN.length && !outcome; i++) {
    const step = PLAN[i];
    const turnN = i + 1;

    console.log(`\n${"─".repeat(65)}`);
    console.log(`  ${step.note}`);
    console.log(`${"─".repeat(65)}`);

    // --- Выполняем ход ---
    if (step.action === "skip") {
      console.log("  [ПРОПУСК — восстановление инициативы]");
      const skipRes = await api("POST", `/games/${gameId}/turns/skip`, {}, token);
      const deltas = Object.entries(skipRes.statDeltas || {}).filter(([,v]) => v !== 0)
        .map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      console.log(`  📋 Нарратив: ${(skipRes.narrative || "").substring(0, 90)}...`);
      if (deltas) console.log(`  📉 Штрафы: ${deltas}`);
    } else {
      console.log(`  🎯 Режим: ${step.action}`);
      console.log(`  📝 "${step.input.substring(0, 110)}..."`);

      const preview = await api("POST", `/games/${gameId}/turns/preview`, {
        playerInput: step.input,
        actionMode: step.action,
      }, token);

      if (preview.advisorObjection) {
        console.log(`  ⚠  Советник: ${preview.advisorObjection.substring(0, 130)}...`);
      }

      // Показываем только ключевые статы в превью
      const keyDeltas = Object.entries(preview.statDeltasPreview || {})
        .filter(([k,v]) => v !== 0 && ["economy","military","stability","diplomacy","approval","peace_progress","army_morale","readiness","initiative"].includes(k))
        .map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      console.log(`  📈 Превью: ${keyDeltas || "(нет ключевых)"}`);

      const confirm = await api("POST", `/games/${gameId}/turns/confirm`, {}, token);
      outcome = confirm.gameOutcome && confirm.gameOutcome !== "none" ? confirm.gameOutcome : null;
      console.log(`  ✓ Ход подтверждён${outcome ? ` → ИСХОД: ${outcome}` : ""}`);
    }

    if (outcome) break;

    // --- Ждём события этого хода ---
    console.log(`  ⏳ Ожидаем события от мира...`);
    gs = await waitForEvents(gameId, token, turnN);

    // Собираем новые события этого хода
    const newItems = (gs.newsfeed || []).filter(n => {
      const key = `${n.turn}-${n.type}-${n.source}`;
      if (seenItems.has(key)) return false;
      if (n.turn !== turnN) return false;
      seenItems.add(key);
      return true;
    });

    // Украина
    const uaItems = newItems.filter(n => n.type === "ukraine_action");
    const worldItems = newItems.filter(n => n.type === "reaction" || n.type === "world_move");

    if (uaItems.length === 0 && worldItems.length === 0) {
      console.log(`  [Нет событий за этот ход]`);
    }

    await handleUkraineActions(gameId, token, uaItems, gs.stats);
    await handleWorldReactions(gameId, token, worldItems);

    // Обновляем стейт после всех ответов
    gs = await api("GET", `/games/${gameId}`, null, token);
    logStats("ПОСЛЕ ХОДА И ОТВЕТОВ", gs.stats, turnN);

    if (gs.status && gs.status !== "active") {
      outcome = gs.status;
      break;
    }
  }

  console.log("\n" + "═".repeat(65));
  console.log(`  ИТОГ: ${outcome || "игра продолжается (лимит ходов)"}`);
  console.log("═".repeat(65));

  const finalGs = await api("GET", `/games/${gameId}`, null, token);
  const s = finalGs.stats;
  console.log(`\nФинальные статы:`);
  console.log(`  eco:${s.economy} mil:${s.military} appr:${s.approval} stab:${s.stability} dip:${s.diplomacy}`);
  console.log(`  DON:${s.donetsk_control??78} LUH:${s.luhansk_control??96} ZAP:${s.zaporizhzhia_control??68} KHE:${s.kherson_control??58} KHA:${s.kharkiv_control??12}`);
  console.log(`  peace:${s.peace_progress??0} army_morale:${s.army_morale??'?'} readiness:${s.readiness??'?'}`);

  await api("DELETE", `/games/${gameId}`, null, token).catch(() => {});
  console.log("\n✓ Тест-данные удалены");
}

main().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
