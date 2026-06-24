/**
 * admin-events.js
 *
 * Очередь событий от геймастера (администратора).
 * Хранится в Redis как список. При следующем confirm игрока
 * все накопленные события применяются к его партии.
 *
 * Ключ: admin_events:{gameId} -> JSON-список событий
 */

function adminEventsKey(gameId) {
  return `admin_events:${gameId}`;
}

function createAdminEventStore(redisClient) {
  return {
    async push(gameId, event) {
      await redisClient.rpush(adminEventsKey(gameId), JSON.stringify(event));
      // Живут 7 дней — если игрок не зашёл, сами истекут
      await redisClient.expire(adminEventsKey(gameId), 7 * 24 * 3600);
    },

    async popAll(gameId) {
      const key = adminEventsKey(gameId);
      const len = await redisClient.llen(key);
      if (!len) return [];
      const items = await redisClient.lrange(key, 0, len - 1);
      await redisClient.del(key);
      return items.map(s => JSON.parse(s));
    },

    async list(gameId) {
      const key = adminEventsKey(gameId);
      const items = await redisClient.lrange(key, 0, -1);
      return items.map(s => JSON.parse(s));
    },
  };
}

module.exports = { createAdminEventStore };
