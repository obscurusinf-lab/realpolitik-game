/**
 * Тест: агрессивный военный прогон
 * Цель: военная победа (territory control + mil stats)
 * Стратегия:
 *   - Хода 1: диплом (поднять мирный трек чтобы не сдохнуть, поднять дипломатию)
 *   - Хода 2,4,7,9: военное наступление
 *   - Хода 3,8: пропуск (восстановить инициативу)
 *   - Хода 5: быстрый указ (экономика/рейтинг если просели)
 *   - Хода 6: дипломатия (поддержать мирный трек)
 *   - Хода 10+: диплом + воен по ситуации
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

async function waitWorldUpdate(gameId, token, turnN, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const gs = await api("GET", `/games/${gameId}`, null, token);
    const reactions = (gs.newsfeed || []).filter(n => (n.type === "reaction" || n.type === "world_move" || n.type === "ukraine_action") && n.turn >= turnN);
    if (reactions.length > 0) return gs;
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

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ХОД ${turn} — ${label}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  📊 Статы: eco:${s.economy??'?'} mil:${s.military??'?'} appr:${s.approval??'?'} stab:${s.stability??'?'} dip:${s.diplomacy??'?'}`);
  console.log(`  🕊  Peace: ${s.peace_progress??0}  Init: ${s.initiative??100}`);
  console.log(`  🗺  Терр: DON:${don} LUH:${luh} ZAP:${zap} KHE:${khe} KHA:${kha}`);
  console.log(`  🪖  Арм: morale:${s.army_morale??'?'} ready:${s.readiness??'?'}`);
  if (milVictory) console.log(`  ⭐ ВОЕННАЯ ПОБЕДА ВОЗМОЖНА!`);
  console.log();
}

async function main() {
  console.log("🎮 REALPOLITIK — АГРЕССИВНЫЙ ВОЕННЫЙ ПРОГОН");
  console.log("Цель: военная победа через территориальный контроль\n");

  // Регистрируемся
  const username = `test_agg_${Date.now()}`;
  await api("POST", "/auth/register", { username, password: "testpass123", displayName: "Тест Агрессор" });
  const { token } = await api("POST", "/auth/login", { username, password: "testpass123" });
  console.log("✓ Авторизован");

  // Создаём игру (Россия = countryId 1)
  const { gameId } = await api("POST", "/games", { countryId: "RU" }, token);
  console.log(`✓ Игра создана: ${gameId}\n`);

  await sleep(500);
  let gs = await api("GET", `/games/${gameId}`, null, token);
  logStats("НАЧАЛО ИГРЫ", gs.stats, 0);

  // Стратегия по ходам
  const plan = [
    // Ход 1: дипломатия — поднять мирный трек и дипломатию
    {
      action: "diplomacy_op",
      input: "Провести закрытые консультации с китайскими и индийскими партнёрами через МИД. Обозначить готовность к мирным переговорам на собственных условиях — предложить план прекращения огня при сохранении контроля над занятыми территориями.",
      note: "Дипломатия: поднять мирный трек и укрепить международную поддержку перед активной фазой"
    },
    // Ход 2: военное наступление (основное)
    {
      action: "military",
      input: "Начать скоординированное наступление по всей линии соприкосновения — приоритет Донецкое направление. Задействовать все имеющиеся резервы, артиллерию и бронетехнику. Цель: установить полный контроль над Донецкой агломерацией.",
      note: "Главный удар: занять Донецк полностью, продвинуться на всех направлениях"
    },
    // Ход 3: пропуск — восстановление инициативы
    {
      action: "skip",
      input: null,
      note: "Пропуск: восстановить инициативу до 75+ перед следующим ударом"
    },
    // Ход 4: военное наступление
    {
      action: "military",
      input: "Развить успех предыдущего наступления — скоординированный удар на Луганском, Запорожском и Херсонском направлениях. Ввести в бой свежие резервные подразделения. Приказ: не допустить консолидации украинской обороны.",
      note: "Второй удар: давление на Луганск, Запорожье, Херсон одновременно"
    },
    // Ход 5: быстрый указ (поддержать экономику/рейтинг)
    {
      action: "decree_fast",
      input: "Объявить о значительном повышении денежного довольствия военнослужащих и выплат семьям погибших. Ввести налоговые льготы для предприятий оборонно-промышленного комплекса.",
      note: "Социальная поддержка: удержать рейтинг и стабилизировать экономику военного времени"
    },
    // Ход 6: дипломатия — мирный трек не давать упасть
    {
      action: "diplomacy_op",
      input: "Активизировать дипломатические контакты через турецкую площадку — передать детальный мирный план с фиксацией территориального статус-кво. Цель: продемонстрировать готовность к переговорам и снизить международное давление.",
      note: "Дипломатический маневр: снизить интенсивность западного давления, поддержать мирный трек"
    },
    // Ход 7: военное наступление
    {
      action: "military",
      input: "Финальный решающий удар: сосредоточить максимальные силы на установление полного контроля над Донецкой и Луганской областями. Параллельно — активные операции в Запорожье и Херсоне.",
      note: "Решающий удар: выйти на победные пороги территорий"
    },
    // Ход 8: пропуск — инициатива
    {
      action: "skip",
      input: null,
      note: "Пропуск: восстановить ресурсы для финального этапа"
    },
    // Ход 9: военное наступление
    {
      action: "military",
      input: "Операция 'Завершение' — удар с задачей установить контроль над всеми четырьмя регионами. Использовать воздушную поддержку, артиллерию и бронегруппы. Украинские позиции должны быть прорваны по всей линии фронта.",
      note: "Последнее наступление: финальные территории для победы"
    },
    // Ход 10: дипломатия
    {
      action: "diplomacy_op",
      input: "Объявить о достижении стратегических целей и предложить немедленное прекращение огня на основе занятых позиций. Апеллировать к безопасности населения и необходимости восстановления.",
      note: "Дипломатический финал: зафиксировать результаты военной операции"
    },
    // Ход 11: военное наступление (если не победили)
    {
      action: "military",
      input: "Добить оставшиеся очаги сопротивления. Полное занятие Луганска, Донецка. Удержание Запорожья, Херсона, Харькова — комплексная операция по замыканию кольца.",
      note: "Финальное давление: добить оставшиеся территории"
    },
    // Ход 12: дипломатия
    {
      action: "diplomacy_op",
      input: "Последние переговоры через посредников для официального оформления прекращения огня на российских условиях.",
      note: "Финальная дипломатия"
    },
  ];

  let outcome = null;
  for (let i = 0; i < plan.length && !outcome; i++) {
    const step = plan[i];
    const turnN = i + 1;

    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ХОД ${turnN}: ${step.note}`);
    console.log(`${"─".repeat(60)}`);

    if (step.action === "skip") {
      console.log("  [ПРОПУСК ХОДА — восстановление инициативы]");
      const skipRes = await api("POST", `/games/${gameId}/turns/skip`, {}, token);
      console.log(`  → narrative: ${(skipRes.narrative || "").substring(0, 80)}...`);
      const deltas = Object.entries(skipRes.statDeltas || {}).filter(([,v]) => v !== 0).map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      if (deltas) console.log(`  → статы: ${deltas}`);
    } else {
      // Preview
      console.log(`  Режим: ${step.action}`);
      console.log(`  Текст: "${step.input.substring(0, 100)}..."`);
      const preview = await api("POST", `/games/${gameId}/turns/preview`, {
        playerInput: step.input,
        actionMode: step.action,
      }, token);

      if (preview.advisorObjection) {
        console.log(`  ⚠  Советник: ${preview.advisorObjection.substring(0, 120)}...`);
      }

      const deltas = Object.entries(preview.statDeltasPreview || {}).filter(([,v]) => v !== 0).map(([k,v]) => `${k}:${v>0?'+':''}${v}`).join(", ");
      console.log(`  → превью дельт: ${deltas || "(нет)"}`);

      // Confirm
      const confirm = await api("POST", `/games/${gameId}/turns/confirm`, {}, token);
      console.log(`  ✓ Подтверждено. Outcome: ${confirm.gameOutcome || "продолжаем"}`);
      outcome = confirm.gameOutcome;
    }

    // Ждём world update
    await sleep(1500);
    gs = await waitWorldUpdate(gameId, token, turnN, 5);

    // Лог Украины
    const uaItems = (gs.newsfeed || []).filter(n => n.type === "ukraine_action" && n.turn === turnN);
    if (uaItems.length > 0) {
      console.log(`  🇺🇦 Украина: ${uaItems[0].source} — ${uaItems[0].text.substring(0, 100)}...`);
    }

    logStats("ПОСЛЕ ХОДА", gs.stats, turnN);

    if (outcome) break;
    if (gs.status && gs.status !== "active") { outcome = gs.status; break; }
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  ИТОГ: ${outcome || "игра продолжается"}`);
  console.log("═".repeat(60));
  gs = await api("GET", `/games/${gameId}`, null, token);
  const s = gs.stats;
  console.log(`\nФинальные статы:`);
  console.log(`  eco:${s.economy} mil:${s.military} appr:${s.approval} stab:${s.stability} dip:${s.diplomacy}`);
  console.log(`  DON:${s.donetsk_control??78} LUH:${s.luhansk_control??96} ZAP:${s.zaporizhzhia_control??68} KHE:${s.kherson_control??58} KHA:${s.kharkiv_control??12}`);
  console.log(`  peace:${s.peace_progress??0} army_morale:${s.army_morale??'?'} readiness:${s.readiness??'?'}`);

  // Чистим тест-юзера
  console.log("\nУбираем тест-данные...");
  await api("DELETE", `/games/${gameId}`, null, token).catch(() => {});
  console.log("✓ Готово");
}

main().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
