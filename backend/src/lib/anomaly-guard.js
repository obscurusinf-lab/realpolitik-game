/**
 * anomaly-guard.js
 *
 * Флаг аномалии для ГОСТЕВЫХ аккаунтов (2026-07-10, Петя — перед публичным постом): вызывается
 * из usage-tracker.js после каждой записи в ai_usage. Проверяет только account_tier='guest' —
 * существующие аккаунты и друзья по админскому коду (tier='unrestricted') никогда не флагаются.
 * Ставит флаг ОДИН раз (WHERE anomaly_flagged_at IS NULL — идемпотентно, без повторного
 * Telegram-пуша на каждый следующий ход того же уже помеченного аккаунта).
 *
 * Два независимых порога (сработает любой):
 *   - COST_THRESHOLD_USD: суммарный расход ИИ аккаунта за всё время. Ориентир (HANDOFF,
 *     2026-07-09): полная партия обходится в среднем ~$0.06-0.15 в текущей ценовой модели —
 *     порог $1 это заведомо в разы больше нормальной игры, не ложные срабатывания на активного
 *     но честного игрока.
 *   - BURST_TURNS/BURST_WINDOW_MINUTES: количество ходов (turns) по всем партиям аккаунта за
 *     короткое окно — человек, читающий нарратив и обдумывающий решение, физически не сделает
 *     15 ходов за 10 минут, а скрипт/накрутка — легко.
 */
const { sendTelegramAlert } = require("./telegram-alert");

const COST_THRESHOLD_USD = 1.0;
const BURST_TURNS = 15;
const BURST_WINDOW_MINUTES = 10;

async function checkGuestAnomaly(db, playerId, logger) {
  if (!playerId) return;

  const userRes = await db.query(
    `SELECT account_tier, anomaly_flagged_at, display_name, username FROM users WHERE id = $1`,
    [playerId]
  );
  const user = userRes.rows[0];
  if (!user || user.account_tier !== "guest" || user.anomaly_flagged_at) return;

  const costRes = await db.query(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE player_id = $1`, [playerId]);
  const totalCost = Number(costRes.rows[0].total);

  const burstRes = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM turns t JOIN games g ON g.id = t.game_id
     WHERE g.owner_user_id = $1 AND t.created_at > now() - interval '${BURST_WINDOW_MINUTES} minutes'`,
    [playerId]
  );
  const burstCount = burstRes.rows[0].cnt;

  let reason = null;
  if (totalCost >= COST_THRESHOLD_USD) reason = `расход $${totalCost.toFixed(3)} ≥ $${COST_THRESHOLD_USD}`;
  else if (burstCount >= BURST_TURNS) reason = `${burstCount} ходов за ${BURST_WINDOW_MINUTES} мин ≥ ${BURST_TURNS}`;
  if (!reason) return;

  // WHERE anomaly_flagged_at IS NULL — гонка между параллельными вызовами: если два запроса
  // одновременно триггернут порог, флаг и алерт уйдут только у одного (rowCount проверяет это).
  const flagRes = await db.query(
    `UPDATE users SET anomaly_flagged_at = now(), anomaly_reason = $2
     WHERE id = $1 AND anomaly_flagged_at IS NULL`,
    [playerId, reason]
  );
  if (flagRes.rowCount === 0) return; // кто-то другой уже флагнул параллельно

  const name = user.display_name || user.username || playerId;
  sendTelegramAlert(`⚠️ Гостевой аккаунт «${name}» помечен как аномальный: ${reason}`).catch((err) => {
    (logger || console).error?.({ err }, "telegram alert send failed");
  });
}

module.exports = { checkGuestAnomaly, COST_THRESHOLD_USD, BURST_TURNS, BURST_WINDOW_MINUTES };
