/**
 * seed.js
 *
 * Загружает countries/*.json в таблицу countries.
 * Запуск: node backend/src/db/seed/seed.js
 * Ожидает переменную окружения DATABASE_URL (или правит подключение ниже).
 *
 * Намеренно НЕ включает stat_rationale/overview_seed в само поле base_stats —
 * они хранятся отдельно (rationale — только для людей, не для рантайма;
 * overview_seed копируется в games.overview при создании партии, не в countries).
 */

const fs = require("fs");
const path = require("path");

const COUNTRIES_DIR = path.join(__dirname, "countries");

async function loadCountryFiles() {
  const files = fs.readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, f), "utf-8")));
}

/**
 * @param {import('pg').Pool} db
 */
async function seedCountries(db) {
  const countries = await loadCountryFiles();

  for (const country of countries) {
    await db.query(
      `INSERT INTO countries (id, name, base_stats, base_relations, relations_graph, context_summary, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         base_stats = EXCLUDED.base_stats,
         base_relations = EXCLUDED.base_relations,
         relations_graph = EXCLUDED.relations_graph,
         context_summary = EXCLUDED.context_summary,
         updated_at = now()`,
      [
        country.id,
        country.name,
        JSON.stringify(country.base_stats),
        JSON.stringify(country.base_relations),
        JSON.stringify(country.relations_graph),
        country.context_summary,
      ]
    );
    console.log(`Seeded country: ${country.id} (${country.name})`);
  }
}

// Запуск как самостоятельный скрипт: node seed.js
if (require.main === module) {
  const { Pool } = require("pg");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  seedCountries(db)
    .then(() => {
      console.log("Seeding complete.");
      return db.end();
    })
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}

module.exports = { seedCountries, loadCountryFiles };
