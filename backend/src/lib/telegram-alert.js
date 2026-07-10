/**
 * telegram-alert.js
 *
 * Исходящий Telegram-пуш админу (2026-07-10, аномалии на гостевых аккаунтах) — НЕ связан с
 * telegram-bridge/ (тот — отдельный процесс на домашней машине, гоняет `claude --continue`).
 * Этот файл — прямой вызов Bot API из самого бэкенда (Railway), для одной цели: сообщить
 * Пете, что гостевой аккаунт превысил порог расхода/частоты ходов. Без токена/chat_id в
 * .env — молча no-op (не ломает основной поток, если алерты не настроены).
 */
async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return; // алерты не настроены — тихо пропускаем

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error("Telegram alert failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Telegram alert error:", err.message);
  }
}

module.exports = { sendTelegramAlert };
