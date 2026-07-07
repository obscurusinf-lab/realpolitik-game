-- schema.sql
-- Полная схема БД. Источник истины — снята с реальной прод-Postgres (Railway) через
-- information_schema/pg_catalog интроспекцию 2026-07-07 (pg_dump бинарник недоступен в этом
-- окружении, но результат эквивалентен). До этой ревизии файл был написан вручную и разошёлся
-- с реальностью — не отражал username/password_hash (users), assist_mode/president_name/
-- show_in_leaderboard/language (games), initiative (game_state), stats_snapshot/action_mode
-- (turns), и таблицу feedback_items вообще. Дальнейшие изменения схемы — только через
-- пронумерованные миграции в backend/migrations/ (см. backend/scripts/migrate.js), схема
-- версионируется через таблицу applied_migrations, а не правкой этого файла руками.

CREATE TABLE countries (
  id            TEXT PRIMARY KEY,           -- 'RU', 'US', 'UA', ...
  name          TEXT NOT NULL,
  base_stats    JSONB NOT NULL,             -- { economy, military, stability, diplomacy, approval }
  base_relations JSONB NOT NULL,            -- [{ name, value, trend, note }]
  relations_graph JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "США": { allies: ["ЕС","Украина"], rivals: ["Китай","Иран"] } }
  context_summary TEXT,                     -- актуальный геополитический контекст ("что происходит сейчас") — для всплывающего окна
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  country_profile JSONB                     -- { description, strengths: [...], weaknesses: [...] } — статичный профиль для брифинга
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,                -- сейчас не используется формой входа (логин по username), исторический анонимный путь
  display_name  TEXT NOT NULL,
  is_anonymous  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  username      TEXT,                       -- реальный логин (auth.js) — nullable ради обратной совместимости со старыми анонимными users
  password_hash TEXT
);
CREATE UNIQUE INDEX users_email_key ON users(email);
CREATE UNIQUE INDEX users_username_idx ON users(username) WHERE (username IS NOT NULL);

CREATE TABLE games (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  country_id    TEXT NOT NULL REFERENCES countries(id),
  status        TEXT NOT NULL DEFAULT 'active', -- active | victory_* | defeat_* (см. detectGameOutcome в turns.js)
  multiplayer_session_id UUID,                  -- NULL для одиночной партии
  current_turn  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assist_mode   TEXT NOT NULL DEFAULT 'advisor', -- 'advisor' | 'hardcore' — закреплён при создании партии
  president_name TEXT,                          -- своё имя на партию, отдельно от users.username/display_name
  show_in_leaderboard BOOLEAN NOT NULL DEFAULT false,
  last_ping_at  TIMESTAMPTZ,                    -- heartbeat от клиента — индикатор "онлайн" в админке
  ukraine_manual_queue JSONB,                   -- админ пишет действие ЗА Украину — потребляется один раз следующим ходом
  admin_advisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb, -- { advisorId: "текст" } — админ переопределяет рекомендацию министра
  language      TEXT NOT NULL DEFAULT 'ru'      -- 'ru' | 'en' — закреплён при создании партии, как assist_mode (i18n, Фаза 1)
);
CREATE INDEX idx_games_status ON games(status);

CREATE TABLE game_state (
  game_id       UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  stats         JSONB NOT NULL,             -- текущий снэпшот { economy, military, ... }
  relations     JSONB NOT NULL,             -- текущий массив отношений
  policies      JSONB NOT NULL DEFAULT '[]'::jsonb,
  delayed_effects JSONB NOT NULL DEFAULT '[]'::jsonb, -- очередь будущих эффектов
  overview      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { headline, hotspots }
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  initiative    INT NOT NULL DEFAULT 100    -- дублирует stats.initiative некоторых старых партий — читается напрямую в части роутов
);

CREATE TABLE turns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  player_input  TEXT NOT NULL,
  gm_classification JSONB NOT NULL,         -- сырой валидированный ответ ИИ (без чисел)
  stat_deltas   JSONB NOT NULL,             -- результат rules-engine
  relation_deltas JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative_text TEXT NOT NULL,
  advisor_objection TEXT,
  world_event   JSONB,                     -- если это был "ход мира", а не игрока
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_mode   TEXT NOT NULL DEFAULT 'decree', -- decree_fast/reform/program, intel, military, diplomacy_op, crisis, regroup, skip
  stats_snapshot JSONB                      -- полный снимок stats после хода — источник для истории/графиков/computeVelocity
);
CREATE INDEX idx_turns_game_id ON turns(game_id, turn_n);

CREATE TABLE newsfeed_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  item_type     TEXT NOT NULL,              -- 'decree' | 'news' | 'reaction' | 'world_move' | 'ukraine_action' | 'nuclear_reaction'
  source        TEXT NOT NULL,
  text          TEXT NOT NULL,
  reactions     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ user, text, tone }] либо { type, deltas, responses } для ukraine_action
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_newsfeed_game_id ON newsfeed_items(game_id, turn_n);

CREATE TABLE leaderboard_snap (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_n        INT NOT NULL,
  score         NUMERIC NOT NULL,
  score_breakdown JSONB NOT NULL,           -- { stability, economy, military, diplomacy, approval }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leaderboard_score ON leaderboard_snap(score DESC);

CREATE TABLE multiplayer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL DEFAULT 'lobby', -- lobby | active | finished
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  game_id       UUID REFERENCES games(id),
  message       TEXT NOT NULL,
  contact       TEXT,
  page          TEXT,                       -- откуда отправлен фидбек (какой экран/вкладка)
  status        TEXT NOT NULL DEFAULT 'new', -- new | reviewed | resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
