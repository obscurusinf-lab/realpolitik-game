-- Система метрик игроков (2026-07-07) — план согласован с игроком (см. HANDOFF.md, задача
-- облачной сессии), реализовано локальной сессией после того, как schema.sql/миграции были
-- готовы (0001/0002). Обе таблицы — append-only логи аналитики, не игровое состояние: FK на
-- games/users через ON DELETE SET NULL, а не CASCADE — если партия/юзер когда-нибудь удалятся,
-- исторический расход/события не должны пропадать вместе с ними.

CREATE TABLE IF NOT EXISTS player_events (
  id         BIGSERIAL PRIMARY KEY,
  player_id  UUID REFERENCES users(id) ON DELETE SET NULL,  -- nullable — событие может случиться до создания юзера (напр. неудачная попытка регистрации)
  session_id TEXT,                                          -- произвольный клиентский идентификатор сессии, не привязан к auth
  event_type TEXT NOT NULL,                                 -- registered | game_started | turn_submitted | game_completed | game_abandoned
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,             -- контекст события (gameId, countryId, outcome и т.д. — по типу события)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_events_player_created ON player_events(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_player_events_type_created ON player_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID REFERENCES games(id) ON DELETE SET NULL,
  player_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  model          TEXT NOT NULL,                              -- напр. 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'
  purpose        TEXT NOT NULL,                               -- classify_turn | advisors_consult | ukraine_action | ukraine_action_v2 | world_update | suggestions | argue | admin_foreign_action
  input_tokens   INT NOT NULL DEFAULT 0,
  output_tokens  INT NOT NULL DEFAULT 0,
  cached_tokens  INT NOT NULL DEFAULT 0,                       -- cache_read + cache_creation суммарно (см. usage-tracker.js)
  cost_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_player ON ai_usage(player_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_game ON ai_usage(game_id);
