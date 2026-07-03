import TelegramBot from "node-telegram-bot-api";
import { spawn } from "child_process";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env") });

const isWindows = process.platform === "win32";
const HOME = process.env.HOME || process.env.USERPROFILE;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// chat_id опционален: без него бот стартует в режиме обнаружения — отвечает
// только на /chatid, чтобы можно было узнать свой id и вписать в .env.
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null;
const REPO_PATH = process.env.REPO_PATH || join(HOME, "Documents", "geopolitics-game", "geopolitics-game");

// Путь к claude CLI. На Windows он не в PATH — задаётся через CLAUDE_BIN в .env
// или ищется в стандартном месте установки десктоп-приложения.
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  if (isWindows) {
    const base = join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "Claude", "claude-code");
    // Перебираем установленные версии, берём самую свежую.
    try {
      const versions = readdirSync(base).sort().reverse();
      for (const v of versions) {
        const p = join(base, v, "claude.exe");
        if (existsSync(p)) return p;
      }
    } catch {}
  }
  return "claude"; // рассчитываем, что в PATH (Unix)
}

const CLAUDE_BIN = resolveClaudeBin();

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN обязателен в .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let isRunning = false;
let currentProcess = null;

function isAllowed(msg) {
  if (ALLOWED_CHAT_ID === null) return false; // режим обнаружения — команды заблокированы
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

  // CLAUDE_BIN — прямой путь к claude.exe, поэтому shell не нужен: аргументы
  // (включая произвольный текст сообщения) передаются массивом и не подвержены
  // shell-инъекции/поломке на спецсимволах. shell:true использовался бы только
  // если бы CLAUDE_BIN был .cmd-обёрткой без полного пути.
  const needsShell = isWindows && /\.(cmd|bat)$/i.test(CLAUDE_BIN);
  currentProcess = spawn(CLAUDE_BIN, args, {
    cwd: REPO_PATH,
    env: { ...process.env, HOME },
    shell: needsShell,
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
    await bot.sendMessage(chatId, `❌ Ошибка запуска: ${err.message}\n\nПроверь CLAUDE_BIN в .env (сейчас: ${CLAUDE_BIN}).`);
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
  if (ALLOWED_CHAT_ID === null) {
    // Режим обнаружения: подсказываем chat_id, ничего не запускаем.
    if (!(msg.text && msg.text.startsWith("/chatid"))) {
      await bot.sendMessage(msg.chat.id, `⚙️ Режим настройки. Твой chat ID: \`${msg.chat.id}\`\nВпиши его в .env как TELEGRAM_CHAT_ID и перезапусти бота.`, { parse_mode: "Markdown" });
    }
    console.warn(`Режим обнаружения: chat_id=${msg.chat.id}`);
    return;
  }
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

console.log(`Бот запущен. Разрешённый chat_id: ${ALLOWED_CHAT_ID ?? "(режим обнаружения)"}, repo: ${REPO_PATH}`);
console.log(`claude bin: ${CLAUDE_BIN}`);
