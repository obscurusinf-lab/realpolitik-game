-- schema.sql
-- Полная схема БД. Запускать на чистой Postgres 15+.

CREATE TABLE countries (
  id            TEXT PRIMARY KEY,           -- 'RU', 'US', 'UA', ...
  name          TEXT NOT NULL,
  base_stats    JSONB NOT NULL,             -- { economy, military, stability, diplomacy, approval }
  base_relations JSONB NOT NULL,            -- [{ name, value, trend, note }]
  relations_graph JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "США": { allies: ["ЕС","Украина"], rivals: ["Китай","Иран"] } }
  context_summary TEXT,                     -- актуальный геополитический контекст ("что происходит сейчас") — для всплывающего окна
  country_profile JSONB,                    -- { description, strengths: [...], weaknesses: [...] } — статичный профиль для брифинга
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  display_name  TEXT NOT NULL,
  is_anonymous  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  country_id    TEXT NOT NULL REFERENCES countries(id),
  status        TEXT NOT NULL DEFAULT 'active', -- active | collapsed | completed | abandoned
  multiplayer_session_id UUID,                  -- NULL для одиночной партии
  current_turn  INT NOT NULL DEFAULT 0,
  last_ping_at  TIMESTAMPTZ,                    -- heartbeat от клиента — индикатор "онлайн" в админке
  ukraine_manual_queue JSONB,                   -- админ пишет действие ЗА Украину — потребляется один раз следующим ходом
  admin_advisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb, -- { advisorId: "текст" } — админ переопределяет рекомендацию министра
  language      TEXT NOT NULL DEFAULT 'ru',   -- 'ru' | 'en' — закреплён при создании партии, как assist_mode (i18n, Фаза 1)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_state (
  game_id       UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  stats         JSONB NOT NULL,             -- текущий снэпшот { economy, military, ... }
  relations     JSONB NOT NULL,             -- текущий массив отношений
  policies      JSONB NOT NULL DEFAULT '[]'::jsonb,
  delayed_effects JSONB NOT NULL DEFAULT '[]'::jsonb, -- очередь будущих эффектов
  overview      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { headline, hotspots }
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE turns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  player_input  TEXT NOT NULL,
  action_mode   TEXT NOT NULL DEFAULT 'decree', -- decree_fast/reform/program, intel, military, diplomacy_op, crisis, regroup, skip
  gm_classification JSONB NOT NULL,         -- сырой валидированный ответ ИИ (без чисел)
  stat_deltas   JSONB NOT NULL,             -- результат rules-engine
  relation_deltas JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative_text TEXT NOT NULL,
  advisor_objection TEXT,
  stats_snapshot JSONB,                    -- полный снимок stats после хода — источник для истории/графиков
  world_event   JSONB,                     -- если это был "ход мира", а не игрока
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE newsfeed_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  item_type     TEXT NOT NULL,              -- 'decree' | 'news'
  source        TEXT NOT NULL,
  text          TEXT NOT NULL,
  reactions     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ user, text, tone }]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leaderboard_snap (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  score         NUMERIC NOT NULL,
  score_breakdown JSONB NOT NULL,           -- { stability_component, diplomacy_component, ... }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE multiplayer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL DEFAULT 'lobby', -- lobby | active | finished
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы для частых запросов
CREATE INDEX idx_turns_game_id ON turns(game_id, turn_n);
CREATE INDEX idx_newsfeed_game_id ON newsfeed_items(game_id, turn_n);
CREATE INDEX idx_leaderboard_score ON leaderboard_snap(score DESC);
CREATE INDEX idx_games_status ON games(status);
