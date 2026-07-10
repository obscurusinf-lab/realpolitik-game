/**
 * usage-tracker.js
 *
 * Обёртка вокруг callClaudeApi (2026-07-07, система метрик игроков — план согласован с
 * игроком через облачную сессию, см. HANDOFF.md) — единая точка, где реально считается расход
 * на Claude API по партии/игроку/назначению вызова, независимо от того, какой из ai-модулей
 * его сделал (gamemaster, advisors, ukraine-action, ukraine-action-v2, worldUpdate, suggestions, argue, admin).
 *
 * Не трогает сам callClaudeApi (backend/src/ai/claude-client.js) — оборачивает СНАРУЖИ, один
 * раз в server.js, вместо правки самого клиента. Каждый вызывающий модуль передаёт вторым
 * аргументом meta = { gameId, playerId, purpose } — если meta не передан (старый call site,
 * который ещё не обновили), запись всё равно происходит, просто без привязки к игре/игроку
 * (gameId/playerId будут NULL) — не ломает вызовы, которые забыли/не успели прокинуть meta.
 *
 * Запись в БД — fire-and-forget: ошибка вставки логируется, но НИКОГДА не мешает основному
 * игровому ответу (учёт расхода — аналитика, а не критичная для геймплея часть).
 */

// Цены Anthropic (2026-07, $ за 1M токенов) — единственное место в кодовой базе, где считается
// денежный расход. Если модель/тариф поменяются — обновить только здесь.
const PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0, cacheWrite: 1.0, cacheRead: 0.10 },
};
// Фолбэк на случай новой/неизвестной модели — консервативно берём тариф Sonnet (дороже), чтобы
// не underestimate-ить расход в статистике, если ценник забыли добавить.
const FALLBACK_PRICING = PRICING["claude-sonnet-4-6"];

const { checkGuestAnomaly } = require("../lib/anomaly-guard");

function computeCostUsd(model, usage) {
  const pricing = PRICING[model] || FALLBACK_PRICING;
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage?.cache_read_input_tokens || 0;
  const cost =
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheWriteTokens * pricing.cacheWrite +
      cacheReadTokens * pricing.cacheRead) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6; // округление до 6 знаков — той же точности, что NUMERIC(10,6) в БД
}

function wrapCallClaudeApi({ db, callClaudeApi, logger }) {
  return async function trackedCallClaudeApi(params, meta = {}) {
    const response = await callClaudeApi(params);
    const usage = response?.usage;
    if (usage) {
      const cachedTokens = (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      const costUsd = computeCostUsd(params.model, usage);
      db.query(
        `INSERT INTO ai_usage (game_id, player_id, model, purpose, input_tokens, output_tokens, cached_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          meta.gameId || null,
          meta.playerId || null,
          params.model,
          meta.purpose || "unknown",
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          cachedTokens,
          costUsd,
        ]
      ).then(() => {
        // Проверка аномалии — только гостевые аккаунты (см. anomaly-guard.js), fire-and-forget,
        // не блокирует и не может уронить основной игровой ответ.
        if (meta.playerId) checkGuestAnomaly(db, meta.playerId, logger).catch((err) => {
          (logger || console).error?.({ err }, "anomaly check failed");
        });
      }).catch((err) => {
        (logger || console).error?.({ err, purpose: meta.purpose }, "ai_usage insert failed");
      });
    }
    return response;
  };
}

module.exports = { wrapCallClaudeApi, computeCostUsd, PRICING };
