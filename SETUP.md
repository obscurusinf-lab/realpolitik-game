# Настройка и запуск

## 1. Установка Node.js

Скачайте и установите Node.js 20 LTS: https://nodejs.org/en/download

## 2. База данных (Railway — бесплатно, без карты)

1. Зарегистрируйтесь на https://railway.app
2. New Project → Database → PostgreSQL
3. В открывшемся сервисе: вкладка **Variables** → скопируйте `DATABASE_URL`

Примените схему базы данных:
```
psql <DATABASE_URL> -f backend/src/db/schema.sql
```
Или вставьте содержимое `backend/src/db/schema.sql` в Railway → Data → Query.

## 3. Redis (Upstash — бесплатно, без карты)

1. Зарегистрируйтесь на https://upstash.com
2. Create Database → выберите регион
3. В разделе **Connect** → **ioredis** → скопируйте строку `rediss://...`

## 4. Claude API ключ

https://console.anthropic.com → API Keys → Create Key

## 5. Настройка окружения

```bash
cd backend
cp .env.example .env
# Откройте .env и вставьте DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY
```

## 6. Установка зависимостей и seed

```bash
cd backend
npm install

# Загрузить начальные данные стран в БД
npm run seed
```

## 7. Запуск бэкенда

```bash
cd backend
npm run dev
# Сервер стартует на http://localhost:3000
```

## 8. Запуск фронтенда

В отдельном терминале:
```bash
cd frontend
npm install
npm run dev
# Открыть http://localhost:5173
```

## Структура файлов (созданных в этой сессии)

```
backend/
  package.json          — зависимости (fastify, pg, ioredis, @anthropic-ai/sdk, dotenv)
  .env.example          — шаблон переменных окружения
  src/
    server.js           — точка входа, Fastify + Postgres + Redis
    ai/
      claude-client.js  — реальный вызов Claude API
    routes/
      users.js          — POST /users, GET /users/:id
      games.js          — POST /games, GET /games/:id, /newsfeed, /log, /leaderboard
      turns.js          — POST /games/:id/turns/preview|confirm|cancel (уже был)

frontend/
  package.json          — React + Vite + lucide-react
  vite.config.js        — proxy /games и /leaderboard на localhost:3000
  index.html
  src/
    main.jsx            — стартовый экран + создание партии
    App.jsx             — игровой UI (уже был)
    api.js              — HTTP-клиент (уже был)
```

## Ход проверки (end-to-end)

1. `POST /users` → получаете `userId`
2. `POST /games` с `{ countryId: "RU", userId }` → получаете `gameId`
3. `GET /games/:gameId` → видите начальное состояние
4. `POST /games/:gameId/turns/preview` с `{ playerInput: "Объявляю мобилизацию" }` → нарратив + дельты
5. `POST /games/:gameId/turns/confirm` → ход применяется
6. `GET /games/:gameId` снова — показатели изменились
