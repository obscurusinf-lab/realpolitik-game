-- Глобальные тумблеры (2026-07-11, Петя: "перенести тумблер ИИ-противника в админку, без
-- редеплоя") — маленькая key-value таблица вместо env-переменной для настроек, которые нужно
-- переключать на лету. Первый потребитель: UKRAINE_AI_COUNTERATTACK_ENABLED (см.
-- ai/ukraine-counterattack-ai.js) — env-переменная с тем же именем больше не читается кодом,
-- оставлена в .env.example только как исторический комментарий.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
