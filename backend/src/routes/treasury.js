/**
 * treasury.js
 *
 * POST /games/:gameId/treasury/issue-bonds   — выпуск ОФЗ (+20 казны, +долг)
 * POST /games/:gameId/treasury/repay-bonds   — погашение выпуска (-20 казны, -долг)
 * POST /games/:gameId/treasury/cb-pressure   — давление на ЦБ (body: {direction:"raise"|"lower"})
 * POST /games/:gameId/treasury/cb-replace    — смена главы ЦБ (body: {type:"soft"|"hawkish"})
 * POST /games/:gameId/treasury/anti-corruption — антикоррупционная кампания
 * POST /games/:gameId/treasury/convert-reserves — конвертация ФНБ в казну (1 раз/мес, лимит, инфл. след)
 * POST /games/:gameId/treasury/toggle-fx-regime — переключить управляемый/плавающий курс рубля
 *
 * Механика ОФЗ:
 *   - Максимум 3 активных выпуска (stats.ofz_count)
 *   - 1 выпуск за месяц (stats.ofz_used_this_month)
 *   - Каждый выпуск: +20 к казне немедленно, -0.5 давление инфляции (было +2 — слишком резко для
 *     разового события)
 *   - Погашение: -22 к казне (премия за досрочное погашение выше суммы выпуска), снимает 1 выпуск,
 *     давление инфляции -0.3 (не симметрично выпуску — долг нельзя "обнулить" без следа:
 *     быстрый цикл выпуск→погашение всегда оставляет чистый минус в казне и небольшой + инфляции)
 *   - КОМПАУНДИНГ: стоимость обслуживания 1 выпуска не фиксирована, а растёт вместе с ключевой
 *     ставкой ЦБ (ofzMonthlyCostPerBond). Чем выше ставка (обычно — реакция на инфляцию, которую
 *     сами же ОФЗ и разгоняют), тем дороже занимать → печатать ОФЗ при высокой ставке невыгодно.
 *     Замыкает контур: ОФЗ → инфляция → ставка ЦБ → дороже ОФЗ → дефицит → снова ОФЗ.
 *
 * Механика ключевой ставки:
 *   - stats.key_rate — текущая ставка (5–25%), ЦБ двигает автономно каждый месяц
 *   - stats.cb_head_type — "neutral"|"soft"|"hawkish" (глава ЦБ)
 *   - stats.cb_pressure_used — флаг: давление уже оказано в этом месяце
 *   - stats.cb_replaced — true, если глава ЦБ уже был заменён (одноразово)
 *
 * Механика антикоррупционной кампании:
 *   - ⚡35 инициативы, −8 казны (расследования стоят денег), 1 раз в месяц (stats.anticorruption_used)
 *   - Эффект: коррупция −(6..10), но элиты недовольны (-3 elite_satisfaction)
 *   - 25% шанс "показательного процесса": доп. одобрение +3 (PR-эффект)
 *   - 15% шанс провала: коррупция −2 (слабее) и стабильность −1 (саботаж расследования элитами)
 *
 * Механика курсовой политики (Петя, 2026-07-05 — "отпустить курс рубля"):
 *   - stats.fx_floating — false (по умолчанию) = управляемый курс: ЦБ гасит валютные шоки резервами
 *     (см. dampenFxShock в turns.js) — как и раньше, но теперь видимо в сводке "Бюджет за месяц".
 *   - true = плавающий курс: шоки проходят БЕЗ демпфера — резервы не тратятся, но и не защищают.
 *     Более сильные колебания курса => больше валютного дохода казны при ослаблении рубля
 *     (fxIncome = (usd_rub−80)×0.4), но и заметно больше инфляции (шкалируемый канал в turns.js,
 *     раньше был плоский +0.5 независимо от размера отклонения).
 *   - Переключение стоит ⚡15 инициативы (это политическое решение, не бесплатный тумблер),
 *     можно включать/выключать сколько угодно раз за партию.
 *
 * POST /games/:gameId/treasury/emergency-stimulus — экстренное стимулирование экономики
 *   (Петя, 2026-07-10, по находке домашней сессии "5/5 живых партий проиграли": у economy нет
 *   мгновенного рычага спасения — все econ_* указы двигают только gdp_growth/employment,
 *   которые сходятся в economy С ЛАГОМ на end-month. Когда economy уже у порога defeat_collapse
 *   (<30), спасти её В МОМЕНТЕ нечем. "Как вколоть адреналин в умирающего" — прямой буст,
 *   но с ценой после — "должен сжигать резервы, разгонять инфляцию", Петя, уточнение того же дня):
 *   - Доступно только когда economy < 45 (это ЭКСТРЕННЫЙ рычаг, не рутинная кнопка роста)
 *   - ⚡40 инициативы, −15 казны, −15 резервов ФНБ (реально СЖИГАЕТ резервы, не конвертирует их
 *     в казну, как /convert-reserves), кулдаун 4 хода (stats.emergency_stimulus_last_turn)
 *   - Эффект: economy +10 немедленно, инфляция +5 сразу
 *   - "Похмелье": 3 месяца подряд −1 к economy И +1 к инфляции (perk_stimulus_hangover_turns,
 *     тикает в /turns/end-month) — цена приходит ПОСЛЕ, не разово наперёд, как настоящий адреналин
 *
 * POST /games/:gameId/treasury/invest-surplus — инвестировать профицит казны
 *   (Петя, 2026-07-11: "профицит казны... но прирост к экономике так же +1. Как будто бы должно
 *   быть больше. Или должен быть механизм вложения этих денег" — плоский +1 к economy при
 *   treasury>65 не масштабировался по размеру излишка, ЭТО поправлено отдельно в turns.js;
 *   а это — активная кнопка для игрока, не только пассивный фон):
 *   - Доступно только когда treasury ≥ 70 (это ИНВЕСТИЦИЯ ИЗЛИШКА, не рутинная трата рабочей казны)
 *   - ⚡25 инициативы, −30 казны (резервы ФНБ не трогает — другой ресурс, другая роль), кулдаун
 *     3 хода (stats.invest_surplus_last_turn)
 *   - Эффект: НЕ мгновенный (в отличие от emergency-stimulus) — растянутый +2 economy/мес на
 *     протяжении 4 месяцев (perk_investment_boost_turns, тикает в /turns/end-month), БЕЗ инфляции
 *     и без похмелья — спокойное решение с деньгами, которые уже есть, а не паническая мера
 *
 * POST /games/:gameId/treasury/bank-surplus — отложить профицит казны в резервы (ФНБ)
 *   (Петя, 2026-07-11, отдельно от invest-surplus: "не вижу опции вложить излишек казны в
 *   резервы" — invest-surplus тратит профицит на РОСТ экономики, а это — противоположное
 *   консервативное решение: не тратить, а ОТЛОЖИТЬ на будущее в резервы, зеркало уже
 *   существующего /convert-reserves, только в обратную сторону):
 *   - Доступно только когда treasury ≥ 70 (тот же порог профицита, что у invest-surplus)
 *   - ⚡20 инициативы, −10 казны → +10 резервов (1:1, тот же курс, что у /convert-reserves),
 *     инфляция −0.3 (откладывание денег вместо траты — лёгкий дефляционный эффект, зеркало
 *     +0.3 у /convert-reserves), 1 раз в месяц (stats.surplus_banked_this_month, сбрасывается
 *     в /turns/end-month) — НЕ отдельный многоходовый кулдаун, тот же паттерн, что и у
 *     convert-reserves (не накопительный лимит на партию, а помесячный)
 *   - Мгновенный эффект (в отличие от invest-surplus) — тут нет "роста", это просто перекладывание
 *     денег из одного резерва в другой, растягивать нечего
 */

const OFZ_TREASURY_GAIN = 20;        // немедленный прирост казны
const OFZ_MAX_COUNT = 3;             // максимум активных выпусков
const OFZ_REPAY_COST = 22;           // сколько казны нужно для погашения (выше суммы выпуска — премия за досрочный выкуп)
const RESERVES_CONVERT_AMOUNT = 10;  // сколько резервов конвертируется в казну за 1 раз
const RESERVES_CONVERT_MIN_LEFT = 15; // ниже этого уровня резервов конвертация запрещена
const FX_REGIME_TOGGLE_COST = 15;    // инициатива за смену курсовой политики (управляемый ⇄ плавающий)
const EMERGENCY_STIMULUS_THRESHOLD = 45;   // экономика должна быть НИЖЕ этого, чтобы кнопка стала доступна
const EMERGENCY_STIMULUS_INITIATIVE_COST = 40;
const EMERGENCY_STIMULUS_TREASURY_COST = 15;
const EMERGENCY_STIMULUS_RESERVES_COST = 15;   // резервы ФНБ СГОРАЮТ (не конвертируются, как /convert-reserves)
const EMERGENCY_STIMULUS_ECONOMY_BOOST = 10;
const EMERGENCY_STIMULUS_INFLATION_HIT = 5;    // немедленный удар по инфляции
const EMERGENCY_STIMULUS_COOLDOWN_TURNS = 4;   // ходов между применениями
const EMERGENCY_STIMULUS_HANGOVER_TURNS = 3;   // месяцев отложенной цены (-1 economy И +1 инфляция/мес)
const INVESTMENT_THRESHOLD = 70;        // казна должна быть НЕ НИЖЕ этого для инвестиции
const INVESTMENT_TREASURY_COST = 30;    // тратим часть профицита
const INVESTMENT_INITIATIVE_COST = 25;
const INVESTMENT_COOLDOWN_TURNS = 3;
const INVESTMENT_BOOST_TURNS = 4;       // месяцев растянутого эффекта (+2 economy/мес, см. turns.js)
const BANK_SURPLUS_THRESHOLD = 70;      // тот же порог профицита, что у invest-surplus
const BANK_SURPLUS_AMOUNT = 10;         // казна -10 → резервы +10 (тот же курс, что у convert-reserves)
const BANK_SURPLUS_INITIATIVE_COST = 20;

// Компаундинг: стоимость обслуживания 1 выпуска ОФЗ растёт вместе с ключевой ставкой ЦБ.
// При базовой ставке ~18.5% даёт те же −3/мес, что и раньше при фиксированной стоимости.
function ofzMonthlyCostPerBond(keyRate) {
  return Math.max(2, Math.round((keyRate ?? 18.5) / 6));
}
function ofzTotalMonthlyCost(count, keyRate) {
  return count * ofzMonthlyCostPerBond(keyRate);
}

async function registerTreasuryRoutes(fastify, { db, verifyToken }) {
  async function loadGameForUpdate(client, gameId) {
    const res = await client.query(
      `SELECT g.*, gs.stats, gs.policies, gs.overview, c.name AS country_name
       FROM games g
       JOIN game_state gs ON gs.game_id = g.id
       JOIN countries c ON c.id = g.country_id
       WHERE g.id = $1 FOR UPDATE`,
      [gameId]
    );
    return res.rows[0] || null;
  }

  // ---------- ВЫПУСК ОФЗ ----------
  fastify.post("/games/:gameId/treasury/issue-bonds", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      const ofzCount = newStats.ofz_count ?? 0;

      if (ofzCount >= OFZ_MAX_COUNT) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Достигнут лимит долга: максимум ${OFZ_MAX_COUNT} выпуска ОФЗ одновременно.` });
      }
      if (newStats.ofz_used_this_month) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "ОФЗ уже выпускались в этом месяце. Завершите месяц перед следующим выпуском." });
      }

      const { TREASURY_MIN } = require("../rules/rules-engine");
      const treasuryBefore = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      newStats.treasury = Math.min(100, treasuryBefore + OFZ_TREASURY_GAIN);
      newStats.ofz_count = ofzCount + 1;
      newStats.ofz_used_this_month = true;
      // Небольшой инфляционный всплеск при выпуске
      newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 0.5);

      await client.query(
        `UPDATE game_state SET stats = $1 WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const { TREASURY_PER_TRILLION: T } = require("../rules/rules-engine");
      const gain = OFZ_TREASURY_GAIN;
      const monthlyCost = ofzTotalMonthlyCost(newStats.ofz_count, newStats.key_rate);

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин",
         `Размещён выпуск ОФЗ на ₽${(gain * T).toFixed(1)} трлн — казна пополнена на ${gain} пунктов. ` +
         `Активных выпусков: ${newStats.ofz_count}/${OFZ_MAX_COUNT}. ` +
         `Обслуживание долга: −${monthlyCost} пунктов/мес. при текущей ставке ЦБ ${newStats.key_rate ?? 18.5}% (≈₽${(monthlyCost * T).toFixed(1)} трлн). ` +
         `Инфляционное давление +0.5.`,
         JSON.stringify([{ stat_delta: { treasury: gain, inflation: 0.5 } }])]
      );

      await client.query("COMMIT");

      return reply.send({
        treasury: newStats.treasury,
        ofzCount: newStats.ofz_count,
        inflation: newStats.inflation,
        monthlyCost,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка выпуска ОФЗ" });
    } finally {
      client.release();
    }
  });

  // ---------- ПОГАШЕНИЕ ОФЗ ----------
  fastify.post("/games/:gameId/treasury/repay-bonds", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      const ofzCount = newStats.ofz_count ?? 0;

      if (ofzCount <= 0) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Нет активных выпусков ОФЗ для погашения." });
      }
      const treasuryCurrent = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      if (treasuryCurrent < OFZ_REPAY_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно средств. Для погашения нужно ${OFZ_REPAY_COST} пунктов казны, доступно ${Math.round(treasuryCurrent)}.` });
      }

      const { TREASURY_MIN } = require("../rules/rules-engine");
      newStats.treasury = Math.max(TREASURY_MIN, treasuryCurrent - OFZ_REPAY_COST);
      newStats.ofz_count = ofzCount - 1;
      // Снижение инфляционного давления (меньше, чем прирост при выпуске — погашение не "отменяет" эффект бесплатно)
      newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 0.3);

      await client.query(
        `UPDATE game_state SET stats = $1 WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const { TREASURY_PER_TRILLION: T } = require("../rules/rules-engine");
      const newMonthlyCost = ofzTotalMonthlyCost(newStats.ofz_count, newStats.key_rate);
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин",
         `Погашен 1 выпуск ОФЗ — казна сократилась на ${OFZ_REPAY_COST} пунктов (≈₽${(OFZ_REPAY_COST * T).toFixed(1)} трлн, с премией за досрочный выкуп). ` +
         `Осталось активных выпусков: ${newStats.ofz_count}/${OFZ_MAX_COUNT}. ` +
         `Ежемесячное обслуживание снижено до ${newMonthlyCost} пунктов/мес. Инфляционное давление −0.3.`,
         JSON.stringify([{ stat_delta: { treasury: -OFZ_REPAY_COST, inflation: -0.3 } }])]
      );

      await client.query("COMMIT");

      return reply.send({
        treasury: newStats.treasury,
        ofzCount: newStats.ofz_count,
        inflation: newStats.inflation,
        monthlyCost: newMonthlyCost,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка погашения ОФЗ" });
    } finally {
      client.release();
    }
  });

  // ---------- КОНВЕРТАЦИЯ РЕЗЕРВОВ В КАЗНУ ----------
  // ФНБ можно распечатать, но не досуха: конвертация ограничена лимитом за месяц
  // (RESERVES_CONVERT_AMOUNT) и не даёт увести резервы ниже RESERVES_CONVERT_MIN_LEFT —
  // ниже этого уровня ЦБ нечем защищать рубль (см. демпфер валютных шоков в turns.js).
  // Конвертация — по сути расширение денежной массы, поэтому даёт небольшой инфляционный след.
  fastify.post("/games/:gameId/treasury/convert-reserves", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      if (newStats.reserves_converted_this_month) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Резервы уже конвертировались в этом месяце." });
      }
      const reservesNow = newStats.reserves ?? 48;
      if (reservesNow - RESERVES_CONVERT_AMOUNT < RESERVES_CONVERT_MIN_LEFT) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: `Нельзя опускать резервы ниже ${RESERVES_CONVERT_MIN_LEFT} — ЦБ нечем будет защищать рубль от шоков. Доступно к конвертации: ${Math.max(0, reservesNow - RESERVES_CONVERT_MIN_LEFT)} из ${RESERVES_CONVERT_AMOUNT}.`,
        });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < 20) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Недостаточно инициативы (нужно 20)." });
      }

      const { TREASURY_MIN } = require("../rules/rules-engine");
      const treasuryBefore = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      newStats.reserves = reservesNow - RESERVES_CONVERT_AMOUNT;
      newStats.treasury = Math.min(100, treasuryBefore + RESERVES_CONVERT_AMOUNT);
      newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 0.3);
      newStats.initiative = initiative - 20;
      newStats.reserves_converted_this_month = true;

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const { TREASURY_PER_TRILLION: T } = require("../rules/rules-engine");
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин",
         `ФНБ распечатан: ${RESERVES_CONVERT_AMOUNT} пунктов резервов конвертированы в казну (≈₽${(RESERVES_CONVERT_AMOUNT * T).toFixed(1)} трлн). ` +
         `Остаток резервов: ${newStats.reserves}. Расширение денежной массы слегка подтолкнуло инфляцию (+0.3).`,
         JSON.stringify([{ stat_delta: { treasury: RESERVES_CONVERT_AMOUNT, reserves: -RESERVES_CONVERT_AMOUNT, inflation: 0.3 } }])]
      );

      await client.query("COMMIT");
      return reply.send({ treasury: newStats.treasury, reserves: newStats.reserves, inflation: newStats.inflation });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка конвертации резервов" });
    } finally {
      client.release();
    }
  });

  // ---------- ОТЛОЖИТЬ ПРОФИЦИТ КАЗНЫ В РЕЗЕРВЫ (зеркало convert-reserves) ----------
  fastify.post("/games/:gameId/treasury/bank-surplus", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      if (newStats.surplus_banked_this_month) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Профицит уже отложен в резервы в этом месяце." });
      }
      const treasuryNow = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      if (treasuryNow < BANK_SURPLUS_THRESHOLD) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Казна должна быть не ниже ${BANK_SURPLUS_THRESHOLD}, чтобы откладывать профицит (сейчас ${treasuryNow}).` });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < BANK_SURPLUS_INITIATIVE_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно инициативы (нужно ${BANK_SURPLUS_INITIATIVE_COST}).` });
      }

      const reservesNow = newStats.reserves ?? 48;
      newStats.treasury = Math.max(0, treasuryNow - BANK_SURPLUS_AMOUNT);
      newStats.reserves = Math.min(100, reservesNow + BANK_SURPLUS_AMOUNT);
      newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 0.3);
      newStats.initiative = initiative - BANK_SURPLUS_INITIATIVE_COST;
      newStats.surplus_banked_this_month = true;

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const { TREASURY_PER_TRILLION: T } = require("../rules/rules-engine");
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин",
         `Часть профицита казны (${BANK_SURPLUS_AMOUNT} пунктов, ≈₽${(BANK_SURPLUS_AMOUNT * T).toFixed(1)} трлн) направлена в резервы ФНБ. ` +
         `Новый уровень резервов: ${newStats.reserves}. Изъятие денег из оборота слегка охладило инфляцию (−0.3).`,
         JSON.stringify([{ stat_delta: { treasury: -BANK_SURPLUS_AMOUNT, reserves: BANK_SURPLUS_AMOUNT, inflation: -0.3 } }])]
      );

      await client.query("COMMIT");
      return reply.send({ treasury: newStats.treasury, reserves: newStats.reserves, inflation: newStats.inflation });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка отложения профицита в резервы" });
    } finally {
      client.release();
    }
  });

  // ---------- КУРСОВАЯ ПОЛИТИКА (управляемый ⇄ плавающий курс) ----------
  fastify.post("/games/:gameId/treasury/toggle-fx-regime", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < FX_REGIME_TOGGLE_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно инициативы (нужно ${FX_REGIME_TOGGLE_COST}).` });
      }

      const wasFloating = !!newStats.fx_floating;
      newStats.fx_floating = !wasFloating;
      newStats.initiative = initiative - FX_REGIME_TOGGLE_COST;

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const newsText = newStats.fx_floating
        ? "ЦБ объявил о переходе к свободному курсообразованию: резервы больше не будут использоваться для сглаживания курсовых шоков. Более сильные колебания рубля увеличат валютный доход бюджета при ослаблении, но и разгонят инфляцию сильнее прежнего."
        : "ЦБ возвращается к управляемому курсу: резервы вновь будут гасить резкие курсовые шоки, ограничивая как инфляционные риски, так и потенциальный валютный доход бюджета.";
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "ЦБ РФ", newsText]
      );

      await client.query("COMMIT");
      return reply.send({ fxFloating: newStats.fx_floating, initiative: newStats.initiative });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка смены курсовой политики" });
    } finally {
      client.release();
    }
  });

  // ---------- ДАВЛЕНИЕ НА ЦБ ----------
  fastify.post("/games/:gameId/treasury/cb-pressure", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { direction } = request.body || {};
    if (direction !== "raise" && direction !== "lower") {
      return reply.code(400).send({ error: "direction должен быть 'raise' или 'lower'" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      if (newStats.cb_pressure_used) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Давление на ЦБ уже оказано в этом месяце." });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < 25) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Недостаточно инициативы (нужно 25)." });
      }

      const delta = direction === "raise" ? 2 : -2;
      newStats.key_rate = Math.max(5, Math.min(25, Math.round(((newStats.key_rate ?? 18.5) + delta) * 2) / 2));
      newStats.initiative = initiative - 25;
      newStats.cb_pressure_used = true;

      // 30% шанс утечки в прессу
      const leaked = Math.random() < 0.3;
      if (leaked) {
        newStats.isolation = Math.min(100, (newStats.isolation ?? 68) + 3);
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
          [gameId, game.current_turn + 1, "Reuters",
           `Источники в Кремле сообщают о прямом вмешательстве президента в решение ЦБ по ключевой ставке. ` +
           `Западные партнёры расценивают это как подрыв независимости регулятора. Изоляция России усилилась.`,
           JSON.stringify([{ stat_delta: { isolation: 3 } }])]
        );
      }

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);
      await client.query("COMMIT");

      const dirLabel = direction === "raise" ? `повышена до ${newStats.key_rate}%` : `снижена до ${newStats.key_rate}%`;
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "ЦБ РФ",
         `Внеплановое решение по ключевой ставке: ${dirLabel}. ` +
         `${direction === "raise" ? "Цель — сдержать инфляционное давление." : "Цель — стимулировать кредитование и экономический рост."}`]
      );

      return reply.send({ stats: newStats, leaked });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка операции ЦБ" });
    } finally {
      client.release();
    }
  });

  // ---------- СМЕНА ГЛАВЫ ЦБ ----------
  fastify.post("/games/:gameId/treasury/cb-replace", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;
    const { type } = request.body || {};
    if (type !== "soft" && type !== "hawkish") {
      return reply.code(400).send({ error: "type должен быть 'soft' или 'hawkish'" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      if (newStats.cb_replaced) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Глава ЦБ уже был заменён — повторная замена невозможна." });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < 40) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Недостаточно инициативы (нужно 40)." });
      }

      newStats.cb_replaced = true;
      newStats.cb_head_type = type;
      newStats.initiative = initiative - 40;

      // Немедленный сдвиг ставки в зависимости от назначенца
      if (type === "soft") {
        newStats.key_rate = Math.max(5, (newStats.key_rate ?? 18.5) - 3);
        // Мягкий глава: рынок ожидает смягчения — небольшое снижение ожиданий инфляции
        newStats.approval = Math.min(100, (newStats.approval ?? 63) + 3); // бизнес доволен
        newStats.elite_satisfaction = Math.min(100, (newStats.elite_satisfaction ?? 62) + 2);
      } else {
        newStats.key_rate = Math.min(25, (newStats.key_rate ?? 18.5) + 2);
        // Жёсткий глава: сигнал рынку, инфляционные ожидания снижаются
        newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 2);
      }

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const headName = type === "soft"
        ? ["Кириллов А.В.", "Соколов Д.Р.", "Власенко П.И."][Math.floor(Math.random() * 3)]
        : ["Громов С.К.", "Казаков Н.Е.", "Фёдоров В.М."][Math.floor(Math.random() * 3)];
      const typeLabel = type === "soft" ? "«голубь»" : "«ястреб»";
      const policyLabel = type === "soft"
        ? `Новый глава известен приверженностью стимулирующей политике. Ожидается снижение ставки до ${newStats.key_rate}% и оживление кредитования. Риск: рост инфляционного давления.`
        : `Новый глава известен жёсткой антиинфляционной позицией. Ставка повышена до ${newStats.key_rate}%. Эффект: сдерживание инфляции. Риск: замедление экономики.`;

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Кремль",
         `Указом президента назначен новый председатель Центрального банка — ${headName} (${typeLabel}). ${policyLabel}`,
         JSON.stringify([{ stat_delta: type === "soft"
           ? { approval: 3, elite_satisfaction: 2 }
           : { inflation: -2 } }])]
      );

      await client.query("COMMIT");
      return reply.send({ stats: newStats, headName, type });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка смены главы ЦБ" });
    } finally {
      client.release();
    }
  });

  // ---------- АНТИКОРРУПЦИОННАЯ КАМПАНИЯ ----------
  fastify.post("/games/:gameId/treasury/anti-corruption", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      if (newStats.anticorruption_used) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Кампания уже запущена в этом месяце." });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < 35) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Недостаточно инициативы (нужно 35)." });
      }
      const { TREASURY_MIN } = require("../rules/rules-engine");
      const treasuryCurrent = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      if (treasuryCurrent < 8) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Недостаточно средств на расследования (нужно 8 казны)." });
      }

      newStats.initiative = initiative - 35;
      newStats.treasury = Math.max(TREASURY_MIN, treasuryCurrent - 8);
      newStats.anticorruption_used = true;
      // Кампания — это и есть активная борьба с коррупцией в этом месяце: подавляет пассивный
      // отскок коррупции в конце месяца (см. проверку anti_corruption_this_month в turns.js).
      newStats.anti_corruption_this_month = true;

      const corrBefore = newStats.corruption ?? 68;
      const roll = Math.random();
      let outcome, corrDrop, eliteDelta, approvalDelta, stabilityDelta;
      if (roll < 0.15) {
        outcome = "sabotaged";
        corrDrop = 2; eliteDelta = -1; approvalDelta = 0; stabilityDelta = -1;
      } else if (roll < 0.40) {
        outcome = "showcase";
        corrDrop = 6 + Math.floor(Math.random() * 5); eliteDelta = -3; approvalDelta = 3; stabilityDelta = 0;
      } else {
        outcome = "normal";
        corrDrop = 6 + Math.floor(Math.random() * 5); eliteDelta = -3; approvalDelta = 0; stabilityDelta = 0;
      }
      newStats.corruption = Math.max(20, corrBefore - corrDrop); // ниже 20 коррупцию в РФ не свести — игровой пол
      newStats.elite_satisfaction = Math.max(0, (newStats.elite_satisfaction ?? 62) + eliteDelta);
      if (approvalDelta) newStats.approval = Math.min(100, (newStats.approval ?? 63) + approvalDelta);
      if (stabilityDelta) newStats.stability = Math.max(0, (newStats.stability ?? 66) + stabilityDelta);

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const newsText = outcome === "sabotaged"
        ? `Антикоррупционная кампания забуксовала: ключевые фигуранты дел оказались хорошо защищены. Коррупция снизилась незначительно (${corrBefore}→${newStats.corruption}), элиты насторожены, стабильность пошатнулась.`
        : outcome === "showcase"
        ? `Громкие аресты в рамках антикоррупционной кампании попали на федеральные каналы — общество одобряет жёсткость. Коррупция: ${corrBefore}→${newStats.corruption}. Часть элит затаила обиду.`
        : `Антикоррупционная кампания: проведены проверки и аресты в нескольких ведомствах. Коррупция снижена с ${corrBefore} до ${newStats.corruption}. Часть элитных кругов недовольна вмешательством.`;

      // БАЛАНС (2026-07-08): раньше stat_delta нигде не сохранялся для этой новости — игрок видел
      // только числа, зашитые в прозу ("Коррупция: 57→47"), без структурированных чипов (как у
      // ukraine_action/world_move). Дельты уже посчитаны выше — просто прикладываем их к записи.
      const anticorrStatDelta = {};
      const corrDeltaVal = newStats.corruption - corrBefore;
      if (corrDeltaVal !== 0) anticorrStatDelta.corruption = corrDeltaVal;
      if (eliteDelta) anticorrStatDelta.elite_satisfaction = eliteDelta;
      if (approvalDelta) anticorrStatDelta.approval = approvalDelta;
      if (stabilityDelta) anticorrStatDelta.stability = stabilityDelta;

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Генпрокуратура", newsText, JSON.stringify([{ stat_delta: anticorrStatDelta }])]
      );

      await client.query("COMMIT");
      return reply.send({ stats: newStats, outcome, corrBefore, corrAfter: newStats.corruption });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка антикоррупционной кампании" });
    } finally {
      client.release();
    }
  });

  // ---------- ЭКСТРЕННОЕ СТИМУЛИРОВАНИЕ ЭКОНОМИКИ ("адреналин") ----------
  fastify.post("/games/:gameId/treasury/emergency-stimulus", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      const economyBefore = typeof newStats.economy === "number" ? newStats.economy : 50;
      if (economyBefore >= EMERGENCY_STIMULUS_THRESHOLD) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Экономика ещё не в критической зоне (нужно ниже ${EMERGENCY_STIMULUS_THRESHOLD}, сейчас ${economyBefore}).` });
      }
      const currentTurn = game.current_turn ?? 0;
      const lastTurn = newStats.emergency_stimulus_last_turn;
      if (typeof lastTurn === "number" && currentTurn - lastTurn < EMERGENCY_STIMULUS_COOLDOWN_TURNS) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Экстренный укол ещё не восстановился (доступен раз в ${EMERGENCY_STIMULUS_COOLDOWN_TURNS} хода).` });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < EMERGENCY_STIMULUS_INITIATIVE_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно инициативы (нужно ${EMERGENCY_STIMULUS_INITIATIVE_COST}).` });
      }
      const reservesCurrent = typeof newStats.reserves === "number" ? newStats.reserves : 48;
      if (reservesCurrent < EMERGENCY_STIMULUS_RESERVES_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно резервов ФНБ (нужно ${EMERGENCY_STIMULUS_RESERVES_COST}, сейчас ${reservesCurrent}).` });
      }

      const { TREASURY_MIN } = require("../rules/rules-engine");
      const treasuryCurrent = typeof newStats.treasury === "number" ? newStats.treasury : 52;

      newStats.initiative = initiative - EMERGENCY_STIMULUS_INITIATIVE_COST;
      newStats.treasury = Math.max(TREASURY_MIN, treasuryCurrent - EMERGENCY_STIMULUS_TREASURY_COST);
      newStats.reserves = Math.max(0, reservesCurrent - EMERGENCY_STIMULUS_RESERVES_COST);
      newStats.economy = Math.min(100, economyBefore + EMERGENCY_STIMULUS_ECONOMY_BOOST);
      newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + EMERGENCY_STIMULUS_INFLATION_HIT);
      newStats.emergency_stimulus_last_turn = currentTurn;
      // Суммируем, а не перезаписываем (аудит 2026-07-10): сейчас кулдаун стимула (4 хода)
      // строго больше похмелья (3 хода), поэтому повторно уколоть, пока похмелье ещё активно,
      // физически нельзя — но если константы когда-нибудь изменятся местами, перезапись молча
      // обнулила бы остаток похмелья вместо накопления полного штрафа.
      newStats.perk_stimulus_hangover_turns = (newStats.perk_stimulus_hangover_turns ?? 0) + EMERGENCY_STIMULUS_HANGOVER_TURNS;

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const newsText = `Экстренные вливания в экономику: правительство сожгло часть резервов ФНБ (−${EMERGENCY_STIMULUS_RESERVES_COST}) на прямую поддержку — экономика ${economyBefore}→${newStats.economy}. Эффект придётся отработать: инфляционное давление выросло сразу и продолжит расти ближайшие ${EMERGENCY_STIMULUS_HANGOVER_TURNS} месяца, пока экономика приходит в себя после интервенции.`;

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин", newsText, JSON.stringify([{ stat_delta: { economy: EMERGENCY_STIMULUS_ECONOMY_BOOST, inflation: EMERGENCY_STIMULUS_INFLATION_HIT, reserves: -EMERGENCY_STIMULUS_RESERVES_COST } }])]
      );

      await client.query("COMMIT");
      return reply.send({ stats: newStats, economyBefore, economyAfter: newStats.economy, reservesBefore: reservesCurrent, reservesAfter: newStats.reserves });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка экстренного стимулирования" });
    } finally {
      client.release();
    }
  });

  // ---------- ИНВЕСТИРОВАНИЕ ПРОФИЦИТА КАЗНЫ ----------
  fastify.post("/games/:gameId/treasury/invest-surplus", async (request, reply) => {
    const { gameId } = request.params;
    const payload = verifyToken(request, reply);
    if (!payload) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const game = await loadGameForUpdate(client, gameId);
      if (!game) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Game not found" }); }

      const newStats = { ...game.stats };
      const treasuryBefore = typeof newStats.treasury === "number" ? newStats.treasury : 52;
      if (treasuryBefore < INVESTMENT_THRESHOLD) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Профицит казны недостаточен для инвестиции (нужно от ${INVESTMENT_THRESHOLD}, сейчас ${treasuryBefore}).` });
      }
      const currentTurn = game.current_turn ?? 0;
      const lastTurn = newStats.invest_surplus_last_turn;
      if (typeof lastTurn === "number" && currentTurn - lastTurn < INVESTMENT_COOLDOWN_TURNS) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Инвестиция ещё не восстановилась (доступна раз в ${INVESTMENT_COOLDOWN_TURNS} хода).` });
      }
      const initiative = typeof newStats.initiative === "number" ? newStats.initiative : 100;
      if (initiative < INVESTMENT_INITIATIVE_COST) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: `Недостаточно инициативы (нужно ${INVESTMENT_INITIATIVE_COST}).` });
      }

      const { TREASURY_MIN } = require("../rules/rules-engine");
      newStats.initiative = initiative - INVESTMENT_INITIATIVE_COST;
      newStats.treasury = Math.max(TREASURY_MIN, treasuryBefore - INVESTMENT_TREASURY_COST);
      newStats.invest_surplus_last_turn = currentTurn;
      // Суммируем, а не перезаписываем — тот же принцип, что и у похмелья экстренного стимула:
      // повторная инвестиция, пока предыдущая ещё не отработала, должна продлевать эффект,
      // а не молча обнулять остаток.
      newStats.perk_investment_boost_turns = (newStats.perk_investment_boost_turns ?? 0) + INVESTMENT_BOOST_TURNS;

      await client.query(`UPDATE game_state SET stats = $1 WHERE game_id = $2`, [JSON.stringify(newStats), gameId]);

      const newsText = `Профицит казны направлен на инфраструктурные и промышленные инвестиции (−${INVESTMENT_TREASURY_COST} казны) — экономический эффект будет проявляться постепенно в течение ближайших ${INVESTMENT_BOOST_TURNS} месяцев, без давления на инфляцию.`;

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,$5)`,
        [gameId, game.current_turn + 1, "Минфин", newsText, JSON.stringify([{ stat_delta: { treasury: -INVESTMENT_TREASURY_COST } }])]
      );

      await client.query("COMMIT");
      return reply.send({ stats: newStats, treasuryBefore, treasuryAfter: newStats.treasury });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка инвестирования" });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerTreasuryRoutes, ofzMonthlyCostPerBond, ofzTotalMonthlyCost };
