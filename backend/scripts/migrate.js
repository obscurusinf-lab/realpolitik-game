/**
 * Раннер миграций (2026-07-07) — задача от облачной сессии (см. HANDOFF.md): schema.sql
 * устарел и разошёлся с реальной БД, единственные "миграции" были два разовых скрипта без
 * общего версионирования. Теперь: backend/migrations/NNNN_name.sql — пронумерованные файлы,
 * таблица applied_migrations отслеживает, что уже накатано, этот раннер применяет неприменённые
 * по порядку имени файла. Старые migrate-admin-features.js/migrate-i18n.js оставлены как есть
 * (не переписывались задним числом) — их SQL продублирован в 0001/0002 под новой конвенцией,
 * идемпотентность (ADD COLUMN IF NOT EXISTS) делает повторный прогон безопасным.
 *
 * Запуск: node backend/scripts/migrate.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, "../migrations");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort() : [];
  const appliedRes = await db.query(`SELECT name FROM applied_migrations`);
  const applied = new Set(appliedRes.rows.map(r => r.name));

  let ranAny = false;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`— пропущено (уже применено): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    console.log(`→ применяю: ${file}`);
    await db.query(sql);
    await db.query(`INSERT INTO applied_migrations (name) VALUES ($1)`, [file]);
    console.log(`✓ применено: ${file}`);
    ranAny = true;
  }

  if (!ranAny) console.log("Все миграции уже применены — новых нет.");
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
