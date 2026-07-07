/**
 * Одноразовая миграция для Фазы 1 перевода игры (ru/en, 2026-07-07):
 *  - language — язык партии (закреплён при создании, как assist_mode), дефолт 'ru' для всех
 *    уже существующих партий.
 *
 * Запуск: node backend/scripts/migrate-i18n.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'ru'`);
  console.log("OK: language добавлен в games (если его не было).");
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
