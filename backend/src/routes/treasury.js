/**
 * treasury.js
 *
 * POST /games/:gameId/treasury/issue-bonds   — выпуск ОФЗ (+20 казны, +долг)
 * POST /games/:gameId/treasury/repay-bonds   — погашение выпуска (-20 казны, -долг)
 * POST /games/:gameId/treasury/cb-pressure   — давление на ЦБ (body: {direction:"raise"|"lower"})
 * POST /games/:gameId/treasury/cb-replace    — смена главы ЦБ (body: {type:"soft"|"hawkish"})
 * POST /games/:gameId/treasury/anti-corruption — антикоррупционная кампания
 *
 * Механика ОФЗ:
 *   - Максимум 3 активных выпуска (stats.ofz_count)
 *   - 1 выпуск за месяц (stats.ofz_used_this_month)
 *   - Каждый выпуск: +20 к казне немедленно, -3/мес. в end-month + давление инфляции +2
 *   - Погашение: -22 к казне (премия за досрочное погашение выше суммы выпуска), снимает 1 выпуск,
 *     давление инфляции -1 (не симметрично выпуску — долг нельзя "обнулить" без следа:
 *     быстрый цикл выпуск→погашение всегда оставляет чистый минус в казне и +1 инфляции)
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
 */

const OFZ_TREASURY_GAIN = 20;        // немедленный прирост казны
const OFZ_MAX_COUNT = 3;             // максимум активных выпусков
const OFZ_MONTHLY_COST = 3;          // стоимость обслуживания 1 выпуска в месяц
const OFZ_REPAY_COST = 22;           // сколько казны нужно для погашения (выше суммы выпуска — премия за досрочный выкуп)

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
      newStats.inflation = Math.min(100, (newStats.inflation ?? 64) + 2);

      await client.query(
        `UPDATE game_state SET stats = $1 WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const T = 0.8;
      const gain = OFZ_TREASURY_GAIN;
      const monthlyCost = newStats.ofz_count * OFZ_MONTHLY_COST;

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "Минфин",
         `Размещён выпуск ОФЗ на ₽${(gain * T).toFixed(1)} трлн — казна пополнена на ${gain} пунктов. ` +
         `Активных выпусков: ${newStats.ofz_count}/${OFZ_MAX_COUNT}. ` +
         `Обслуживание долга: −${monthlyCost} пунктов/мес. (≈₽${(monthlyCost * T).toFixed(1)} трлн). ` +
         `Инфляционное давление +2.`]
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
      newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 1);

      await client.query(
        `UPDATE game_state SET stats = $1 WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const T = 0.8;
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "Минфин",
         `Погашен 1 выпуск ОФЗ — казна сократилась на ${OFZ_REPAY_COST} пунктов (≈₽${(OFZ_REPAY_COST * T).toFixed(1)} трлн, с премией за досрочный выкуп). ` +
         `Осталось активных выпусков: ${newStats.ofz_count}/${OFZ_MAX_COUNT}. ` +
         `Ежемесячное обслуживание снижено до ${newStats.ofz_count * OFZ_MONTHLY_COST} пунктов/мес. Инфляционное давление −1.`]
      );

      await client.query("COMMIT");

      return reply.send({
        treasury: newStats.treasury,
        ofzCount: newStats.ofz_count,
        inflation: newStats.inflation,
        monthlyCost: newStats.ofz_count * OFZ_MONTHLY_COST,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error(err);
      return reply.code(500).send({ error: "Ошибка погашения ОФЗ" });
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
        newStats.reputation = Math.max(0, (newStats.reputation ?? 28) - 5);
        await client.query(
          `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
          [gameId, game.current_turn + 1, "Reuters",
           `Источники в Кремле сообщают о прямом вмешательстве президента в решение ЦБ по ключевой ставке. ` +
           `Западные партнёры расценивают это как подрыв независимости регулятора. Изоляция России усилилась.`]
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
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "Кремль",
         `Указом президента назначен новый председатель Центрального банка — ${headName} (${typeLabel}). ${policyLabel}`]
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

      const corrBefore = newStats.corruption ?? 55;
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

      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "Генпрокуратура", newsText]
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
}

module.exports = { registerTreasuryRoutes, OFZ_MONTHLY_COST };
