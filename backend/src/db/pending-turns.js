/**
 * pending-turns.js
 *
 * Хранилище классификаций ИИ между POST /turns/preview и POST /turns/confirm.
 * Redis выбран осознанно (не Postgres-поле, не in-memory Map) по двум причинам:
 *  1) Естественный TTL — pending-ход, который игрок не подтвердил, должен
 *     самоуничтожиться, а не висеть вечной записью в game_state.
 *  2) Та же инфраструктура понадобится для мультиплеера (этап 5: presence,
 *     синхронизация комнат) — не вводим новую сущность специально под это,
 *     просто используем её раньше по времени.
 *
 * Ключ: pending_turn:{gameId} -> JSON { gmClassification, turnNumber, createdAt }
 * TTL: 5 минут — если игрок не подтвердил за это время, ход считается
 * отменённым, и при следующем preview/confirm придётся классифицировать заново.
 */

const PENDING_TURN_TTL_SECONDS = 30 * 60; // 30 минут — игрок может долго думать или спорить с советником

function pendingTurnKey(gameId) {
  return `pending_turn:${gameId}`;
}

/**
 * @param {import('ioredis').Redis} redisClient
 */
function createPendingTurnStore(redisClient) {
  return {
    async save(gameId, payload) {
      const stored = JSON.stringify({
        ...payload,
        createdAt: new Date().toISOString(),
      });
      await redisClient.set(pendingTurnKey(gameId), stored, "EX", PENDING_TURN_TTL_SECONDS);
    },

    async get(gameId) {
      const raw = await redisClient.get(pendingTurnKey(gameId));
      if (!raw) return null;
      return JSON.parse(raw);
    },

    async clear(gameId) {
      await redisClient.del(pendingTurnKey(gameId));
    },
  };
}

module.exports = { createPendingTurnStore, PENDING_TURN_TTL_SECONDS };
