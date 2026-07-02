import TelegramBot from "node-telegram-bot-api";
import { spawn } from "child_process";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env") });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);
const REPO_PATH = process.env.REPO_PATH || process.env.HOME + "/realpolitik-game";

if (!TOKEN || !ALLOWED_CHAT_ID) {
  console.error("TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID обязательны в .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let isRunning = false;
let currentProcess = null;

function isAllowed(msg) {
  return msg.chat.id === ALLOWED_CHAT_ID;
}

async function sendLong(chatId, text) {
  const MAX = 4000;
  if (text.length <= MAX) {
    await bot.sendMessage(chatId, text);
    return;
  }
  for (let i = 0; i < text.length; i += MAX) {
    await bot.sendMessage(chatId, text.slice(i, i + MAX));
  }
}

async function runClaude(chatId, message) {
  if (isRunning) {
    await bot.sendMessage(chatId, "⏳ Клод занят предыдущей задачей. Подожди или отправь /stop");
    return;
  }

  isRunning = true;
  await bot.sendMessage(chatId, "⚙️ Запускаю Клода...");

  let output = "";
  let errorOutput = "";

  const args = [
    "--continue",
    "--dangerously-skip-permissions",
    "-p", message,
  ];

  currentProcess = spawn("claude", args, {
    cwd: REPO_PATH,
    env: { ...process.env, HOME: process.env.HOME },
  });

  currentProcess.stdout.on("data", (data) => {
    output += data.toString();
  });

  currentProcess.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  currentProcess.on("close", async (code) => {
    isRunning = false;
    currentProcess = null;

    const result = output.trim() || errorOutput.trim() || "(нет ответа)";
    const prefix = code === 0 ? "" : `⚠️ Код выхода: ${code}\n\n`;
    await sendLong(chatId, prefix + result);
  });

  currentProcess.on("error", async (err) => {
    isRunning = false;
    currentProcess = null;
    await bot.sendMessage(chatId, `❌ Ошибка запуска: ${err.message}\n\nПроверь, что \`claude\` CLI установлен и доступен в PATH.`);
  });
}

bot.onText(/\/start/, async (msg) => {
  if (!isAllowed(msg)) return;
  await bot.sendMessage(msg.chat.id,
    "👋 Бот-мост к домашнему Клоду готов.\n\n" +
    "Просто напиши сообщение — оно уйдёт в `claude --continue`.\n\n" +
    "Команды:\n" +
    "/status — статус Клода\n" +
    "/stop — прервать текущую задачу\n" +
    "/chatid — узнать свой chat ID"
  );
});

bot.onText(/\/status/, async (msg) => {
  if (!isAllowed(msg)) return;
  const status = isRunning ? "🟡 Клод сейчас работает" : "🟢 Клод свободен";
  await bot.sendMessage(msg.chat.id, status);
});

bot.onText(/\/chatid/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Твой chat ID: \`${msg.chat.id}\``, { parse_mode: "Markdown" });
});

bot.onText(/\/stop/, async (msg) => {
  if (!isAllowed(msg)) return;
  if (!isRunning || !currentProcess) {
    await bot.sendMessage(msg.chat.id, "Клод и так не запущен.");
    return;
  }
  currentProcess.kill("SIGTERM");
  isRunning = false;
  currentProcess = null;
  await bot.sendMessage(msg.chat.id, "🛑 Задача прервана.");
});

bot.on("message", async (msg) => {
  if (!isAllowed(msg)) {
    console.warn(`Заблокировано: chat_id=${msg.chat.id}`);
    return;
  }
  if (msg.text && msg.text.startsWith("/")) return;
  if (!msg.text) {
    await bot.sendMessage(msg.chat.id, "Отправь текстовое сообщение.");
    return;
  }
  await runClaude(msg.chat.id, msg.text);
});

console.log(`Бот запущен. Разрешённый chat_id: ${ALLOWED_CHAT_ID}, repo: ${REPO_PATH}`);
