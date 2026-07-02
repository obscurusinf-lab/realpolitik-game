# Telegram-мост к домашнему Клоду

Позволяет отправлять задачи домашнему Клоду через Telegram и получать ответы.

## Установка (один раз, на домашней машине)

### 1. Создай бота

1. Открой [@BotFather](https://t.me/BotFather) в Telegram
2. Отправь `/newbot`, придумай имя и username (например `realpolitik_claude_bot`)
3. Скопируй токен вида `1234567890:AAxxxxxxxx...`

### 2. Узнай свой chat_id

Временно запусти бота без ограничения chat_id — отправь `/chatid` и скопируй число.

### 3. Настрой .env

```bash
cd telegram-bridge
cp .env.example .env
# отредактируй .env: вставь токен, chat_id, путь к репо
```

### 4. Установи зависимости и запусти

```bash
npm install
npm start
```

### 5. Автозапуск при старте системы (опционально)

**macOS** — через launchd:

Создай `~/Library/LaunchAgents/com.user.telegram-bridge.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.telegram-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/username/realpolitik-game/telegram-bridge/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/username/realpolitik-game/telegram-bridge</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/telegram-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/telegram-bridge.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.user.telegram-bridge.plist
```

## Использование

- Просто напиши боту любой текст → уйдёт в `claude --continue -p "текст"`
- `/status` — занят ли Клод
- `/stop` — прервать текущую задачу
- `/chatid` — показать свой chat_id

## Безопасность

Бот отвечает **только** chat_id из `.env`. Все остальные сообщения молча игнорируются.
