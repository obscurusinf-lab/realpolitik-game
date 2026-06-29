/**
 * treasury.js
 *
 * POST /games/:gameId/treasury/issue-bonds   — выпуск ОФЗ (+20 казны, +долг)
 * POST /games/:gameId/treasury/repay-bonds   — погашение выпуска (-20 казны, -долг)
 *
 * Механика ОФЗ:
 *   - Максимум 3 активных выпуска (stats.ofz_count)
 *   - 1 выпуск за месяц (stats.ofz_used_this_month)
 *   - Каждый выпуск: +20 к казне немедленно, -3/мес. в end-month + инфляция +1
 *   - Погашение: -20 к казне, снимает 1 выпуск (инфляция -1 в следующий end-month)
 */

const OFZ_TREASURY_GAIN = 20;        // немедленный прирост казны
const OFZ_MAX_COUNT = 3;             // максимум активных выпусков
const OFZ_MONTHLY_COST = 3;          // стоимость обслуживания 1 выпуска в месяц
const OFZ_REPAY_COST = 20;           // сколько казны нужно для погашения

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
      // Снижение инфляционного давления
      newStats.inflation = Math.max(0, (newStats.inflation ?? 64) - 2);

      await client.query(
        `UPDATE game_state SET stats = $1 WHERE game_id = $2`,
        [JSON.stringify(newStats), gameId]
      );

      const T = 0.8;
      await client.query(
        `INSERT INTO newsfeed_items (game_id, turn_n, item_type, source, text, reactions) VALUES ($1,$2,'news',$3,$4,'[]')`,
        [gameId, game.current_turn + 1, "Минфин",
         `Погашен 1 выпуск ОФЗ — казна сократилась на ${OFZ_REPAY_COST} пунктов (≈₽${(OFZ_REPAY_COST * T).toFixed(1)} трлн). ` +
         `Осталось активных выпусков: ${newStats.ofz_count}/${OFZ_MAX_COUNT}. ` +
         `Ежемесячное обслуживание снижено до ${newStats.ofz_count * OFZ_MONTHLY_COST} пунктов/мес. Инфляционное давление снижено.`]
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
}

module.exports = { registerTreasuryRoutes, OFZ_MONTHLY_COST };
