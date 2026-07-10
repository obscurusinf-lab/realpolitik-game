/**
 * seed-invite-codes.js
 *
 * Разовый скрипт (2026-07-10, Петя — перед публичным постом): генерирует 10 одноразовых
 * гостевых кодов (max_uses=1 каждый — жёсткий потолок в 10 публичных регистраций) + 1
 * админский код без ограничения (для друзей, max_uses=NULL). Коды печатаются в консоль —
 * НЕ сохраняются больше нигде в открытом виде. Требует применённую миграцию 0004
 * (backend/migrations/0004_invite_codes.sql — таблица invite_codes + users.account_tier).
 *
 * Запуск: node backend/scripts/seed-invite-codes.js
 * (только там, где есть доступ к прод-Postgres — облачная сессия его не имеет)
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");
const crypto = require("crypto");

// Без 0/O/1/I/L — на слух/глаз легко перепутать при переписывании из поста.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomCode(groups = 3, groupLen = 4) {
  const part = () => Array.from({ length: groupLen }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return `RP-${Array.from({ length: groups }, part).join("-")}`;
}

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  const guestCodes = Array.from({ length: 10 }, () => randomCode());
  const adminCode = randomCode();

  for (const code of guestCodes) {
    await db.query(
      `INSERT INTO invite_codes (code, tier, max_uses) VALUES ($1, 'guest', 1)`,
      [code]
    );
  }
  await db.query(
    `INSERT INTO invite_codes (code, tier, max_uses) VALUES ($1, 'admin', NULL)`,
    [adminCode]
  );

  console.log("Гостевые коды (одноразовые, tier=guest) — для поста:");
  for (const code of guestCodes) console.log("  " + code);
  console.log("\nАдминский код (без ограничения, tier=unrestricted) — для друзей:");
  console.log("  " + adminCode);
  console.log("\nСохрани это сообщение — коды не хранятся больше нигде в открытом виде.");

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
