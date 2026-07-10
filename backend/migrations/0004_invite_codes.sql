-- Гостевые инвайт-коды (2026-07-10) — запрошено Петей перед публичным постом: чтобы не
-- прогореть по деньгам на API при неограниченной публичной регистрации, регистрация нового
-- аккаунта требует код. tier на users определяет особое поведение в игре (сейчас — только
-- реакция геймместера на шуточные/абсурдные указы, см. gamemaster.js buildUserMessage).
-- Существующие пользователи не затронуты: ADD COLUMN ... DEFAULT 'unrestricted' проставляет
-- значение всем уже существующим строкам, регистрация задним числом кода не требует.
--
-- Сами значения кодов НЕ хранятся в этом файле (не в git) — см. backend/scripts/
-- seed-invite-codes.js, разовый скрипт, который генерирует и печатает коды в консоль при
-- запуске против реальной БД (запускает локальная/десктопная сессия или сам Петя — у
-- облачной сессии нет доступа к прод-Postgres).

CREATE TABLE IF NOT EXISTS invite_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT UNIQUE NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'guest',  -- 'guest' | 'admin' -> account_tier нового юзера
  max_uses   INT,                             -- NULL = без ограничения (админский код для друзей)
  times_used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_tier TEXT NOT NULL DEFAULT 'unrestricted';
-- 'unrestricted' — как сейчас у всех существующих аккаунтов и у зарегистрированных по
-- админскому коду; 'guest' — зарегистрирован по одному из 10 разовых гостевых кодов.
