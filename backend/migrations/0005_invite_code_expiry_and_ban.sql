-- Срок действия гостевых кодов + бан гостевых аккаунтов + флаг аномалии (2026-07-10,
-- продолжение фичи гостевых инвайт-кодов, миграция 0004). Новый файл, не правим уже
-- запушенную/потенциально применённую 0004 — конвенция миграций: только новые пронумерованные
-- файлы (см. комментарий в scripts/migrate.js).

ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- NULL = без срока (админский код для друзей); гостевые коды получают now()+7 дней при генерации
-- в seed-invite-codes.js, не здесь — миграция только добавляет колонку.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
-- Бан блокирует только НОВЫЕ ходы (см. /turns/preview) — партии остаются доступны на просмотр.

ALTER TABLE users ADD COLUMN IF NOT EXISTS anomaly_flagged_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anomaly_reason TEXT;
-- Ставится один раз при первом срабатывании эвристики аномалии (см. lib/anomaly-guard.js) —
-- NOT NULL здесь не нужен, флаг либо есть, либо нет; повторные срабатывания не перезаписывают,
-- чтобы не спамить Telegram-пушем на каждый следующий ход того же аккаунта.
