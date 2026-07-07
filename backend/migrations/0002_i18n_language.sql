-- Язык партии (i18n, Фаза 1, 2026-07-07) — уже применено на проде через
-- backend/scripts/migrate-i18n.js, этот файл — та же миграция под новой конвенции.
ALTER TABLE games ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'ru';
