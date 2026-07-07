/**
 * player-events.js
 *
 * Общий хелпер записи в player_events (миграция 0003, система метрик игроков, 2026-07-07) —
 * переиспользуется из нескольких роутов (server.js для auth, games.js, turns.js, admin.js).
 * Fire-and-forget по тому же принципу, что и ai_usage в usage-tracker.js — сбой записи события
 * не должен ломать основной ответ игроку.
 */
function recordEvent(db, { playerId, sessionId, eventType, payload }) {
  db.query(
    `INSERT INTO player_events (player_id, session_id, event_type, payload) VALUES ($1, $2, $3, $4)`,
    [playerId || null, sessionId || null, eventType, JSON.stringify(payload || {})]
  ).catch((err) => {
    console.error({ err, eventType }, "player_events insert failed");
  });
}

module.exports = { recordEvent };
