/**
 * Одноразовая миграция для трёх новых админ-фич (2026-07-06):
 *  - last_ping_at    — heartbeat от клиента, индикатор "онлайн" в админке
 *  - ukraine_manual_queue — админ пишет действие ЗА Украину, потребляется один раз следующим ходом
 *  - admin_advisor_notes  — админ пишет текст рекомендации конкретного министра (персистентно, пока не сменят)
 *
 * Запуск: node backend/scripts/migrate-admin-features.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS ukraine_manual_queue JSONB`);
  await db.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS admin_advisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb`);
  console.log("OK: last_ping_at, ukraine_manual_queue, admin_advisor_notes добавлены в games (если их не было).");
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
