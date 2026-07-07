-- Три админ-фичи (2026-07-06) — уже применены на проде через backend/scripts/migrate-admin-features.js,
-- этот файл — та же миграция, оформленная под новую пронумерованную конвенцию (см. backend/scripts/migrate.js).
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ;
ALTER TABLE games ADD COLUMN IF NOT EXISTS ukraine_manual_queue JSONB;
ALTER TABLE games ADD COLUMN IF NOT EXISTS admin_advisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb;
