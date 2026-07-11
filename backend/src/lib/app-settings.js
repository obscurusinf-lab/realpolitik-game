/**
 * app-settings.js
 *
 * Глобальные тумблеры в Postgres (2026-07-11) — вместо env-переменных для настроек, которые
 * нужно переключать без редеплоя (сейчас: UKRAINE_AI_COUNTERATTACK_ENABLED). Требует миграцию
 * 0006_app_settings.sql.
 */

async function getSetting(db, key, fallback = null) {
  const res = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  if (res.rowCount === 0) return fallback;
  return res.rows[0].value;
}

async function getBoolSetting(db, key, fallback = false) {
  const value = await getSetting(db, key, null);
  if (value === null) return fallback;
  return value === "true";
}

async function setSetting(db, key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, String(value)]
  );
}

module.exports = { getSetting, getBoolSetting, setSetting };
