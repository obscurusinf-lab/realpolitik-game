-- Зрительский режим (2026-07-11, Петя: "дам доступ немногим для теста, но хочу конверсию —
-- зрители, которые следят за чужими партиями бесплатно, раз читать уже сыгранный ход не стоит
-- ни одного вызова ИИ"). Галочка "сделать партию публичной" на старте, отдельно от Зала Славы
-- (show_in_leaderboard — про финальный результат в рейтинге, is_public — про возможность
-- смотреть партию целиком, включая ход за ходом, пока она идёт).

ALTER TABLE games ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_games_is_public ON games(is_public) WHERE is_public = true;
