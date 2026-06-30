# Realpolitik — геополитическая текстовая стратегия

Игрок управляет Россией (ход — июнь 2026) через указы, военные/дипломатические/
разведывательные действия и реформы. ИИ-геймместер (Claude) классифицирует ход
и пишет нарратив; все числовые последствия считает детерминированный
rules-engine — ИИ никогда не придумывает цифры.

Деплой: backend — Railway (`realpolitik-game-production.up.railway.app`),
frontend — Vercel (`realpolitik-game.vercel.app`).

## Стек

```
Frontend:  React 18 + Vite, Tailwind, lucide-react, react-simple-maps
Backend:   Node.js + Fastify
DB:        PostgreSQL (партии, ходы, лидерборд, пользователи)
Cache:     Redis (ioredis) — pending-ходы между preview/confirm, админ-события
Auth:      JWT (jsonwebtoken) + bcryptjs, логин/пароль
ИИ:        Claude API (@anthropic-ai/sdk)
```

## Структура репозитория

```
docs/
  01-rules-table.md          -- таблица правил влияния ходов на показатели (ЯДРО)
  02-gamemaster-prompt.md     -- системный промпт ИИ-геймместера
  03-resolved-two-phase-turn.md -- двухфазный ход (preview/confirm) + Redis

backend/src/
  server.js                  -- точка входа: Fastify, Postgres, Redis, JWT-auth (инлайн), регистрация роутов
  rules/rules-engine.js       -- детерминированный расчёт дельт показателей, applyTurn()
  ai/
    gamemaster.js              -- классификация хода через Claude (категория/severity), retry/валидация
    advisors.js                 -- 5 советников (оборона/МИД/экономика/разведка/внутр.политика) с персонами
    worldUpdate.js               -- генерация мировых событий/реакций после хода (вкл. ядерный сценарий)
    claude-client.js              -- обёртка над Anthropic SDK
    validateGmResponse.js          -- валидация структуры ответа ИИ
    system-prompt.txt               -- системный промпт геймместера
  db/
    schema.sql                 -- схема Postgres: countries, users, games, game_state, turns,
                                    newsfeed_items, leaderboard_snap, multiplayer_sessions
    pending-turns.js            -- Redis-обёртка для pending-ходов между preview/confirm
    admin-events.js              -- Redis-журнал админских интервенций
    seed/
      seed.js                     -- загрузка countries/*.json в Postgres
      countries/russia-2026-06.json -- seed-данные РФ (22.06.2026)
  routes/
    turns.js     -- /turns/preview|confirm|cancel|end-month|skip|regroup, stat-history, policy-news,
                     cancel-policy, ukraine/respond (многоходовая логика месяца, инициатива, политики)
    games.js     -- /games (CRUD), /games/my, newsfeed, log, legacy, world-response,
                     ukraine-response, /leaderboard
    treasury.js  -- /treasury/issue-bonds, /treasury/repay-bonds (ОФЗ)
    advisors.js  -- /advisors/consult
    argue.js     -- /turns/argue (оспорить решение геймместера)
    suggestions.js -- /suggestions (подсказки хода)
    admin.js     -- /admin/* — стата, список партий, ручные события/иностранные действия,
                     правка stats/initiative, удаление партии, инспекция pending-хода
    users.js     -- POST /users, GET /users/:id (легаси, анонимные пользователи)
    auth.js      -- не используется сервером (логика инлайн в server.js); см. ниже

  middleware/auth.js -- JWT verify-помощник

backend/test-*.js   -- end-to-end плейтесты против прод-инстанса (не unit-тесты):
                        агрессивный военный прогон, новичок/военная победа, полное
                        сопротивление, смешанная стратегия, гонка за победу с разбором
                        прошлых поражений (экономика — главная угроза, не армия)

frontend/src/
  App.jsx   -- весь игровой UI (~5200 строк): вкладки Overview/Map/Stats/World/
               Advisors/Policies/Relations/Treasury/Newsfeed/Log/Wiki
  api.js    -- HTTP-клиент к backend
  main.jsx  -- точка входа, экран логина/создания партии
```

## Игровые механики (актуально на этот коммит)

- **Двухфазный ход**: `preview` (нарратив + дельты, без записи в БД) →
  `confirm` (применяет ход, требует совпадения `current_turn`, иначе 409).
- **Многоходовые месяцы** (`MULTI_ACTION_TURNS`): инициатива — месячный бюджет
  действий (decree/military/diplomacy/intel/regroup/breather); месяц
  завершается явно через `/turns/end-month`. Инициатива переносится между
  действиями одного месяца (carryover 40%).
- **Казна (Treasury)** — второй ресурс отдельно от инициативы: действия стоят
  деньги, ежемесячный доход от экономики/налоговой политики, содержание
  программ, штрафы за дефицит. Можно выпускать/гасить ОФЗ (`treasury.js`).
  Казна и экономика связаны спиралью: слабая казна тянет экономику вниз,
  здоровый профицит её поднимает, и наоборот.
- **Политики** (policies) — категории decree/reform/decree-указ, у каждой
  виден ожидаемый эффект при успехе и последствия отмены; есть спорные
  реальные политики (утильсбор, НДС 22%, порог НДС для ИП). Длительность
  политики капается длиной партии (24 хода).
- **Советники** — 5 фиксированных персон со своими голосами, один вызов
  Claude возвращает мнения всех пяти сразу.
- **Автономные мировые события** и эскалация войны — случаются без участия
  игрока, с UI-предупреждением об эскалации.
- **Военная усталость** и **коррупционные утечки** как штрафующие
  модификаторы показателей, видимые в превью хода.
- **Ukraine-response / world-response** — отдельные ветки реакции на
  действия игрока в украинском направлении и реакции остального мира.
- **Spillover-логика** (влияние на союзников/противников затронутой страны)
  — пока не реализована, есть только заглушка в rules-engine.js.
- **Авторизация**: логин/пароль (bcrypt + JWT, 30 дней), смена отображаемого
  имени; партия привязана к пользователю, есть режим помощи (`advisor` —
  с советниками/подсказками, `hardcore` — без них).
- **Админ-панель**: ручной запуск событий/иностранных действий, правка
  показателей и инициативы партии "на лету", инспекция pending-хода в Redis,
  список и удаление партий.

## Что НЕ сделано / известный технический долг

1. `backend/src/routes/auth.js` — не зарегистрирован в `server.js`;
   реальная auth-логика продублирована инлайн прямо в `server.js`. Файл
   можно удалить либо доделать рефакторинг на использование модуля.
2. **Spillover-логика** (п.4 в `docs/01-rules-table.md`) — `applySpillover(...)`
   только заглушка в `rules-engine.js`, не реализована.
3. **WebSocket/мультиплеер** — таблица `multiplayer_sessions` в схеме есть,
   логика не начата (изначально планировался Socket.io поверх Fastify).
4. **Seed-данные** (`russia-2026-06.json`) собраны на 22.06.2026 через
   web-поиск — качественная интерпретация, не точная статистика; если
   партия стартует значительно позже этой даты, контекст стоит обновить.
5. `backend/test-*.js` — это ручные сценарные прогоны против прод-URL
   (`https://realpolitik-game-production.up.railway.app`), не автоматический
   test suite — нет CI/test runner на корне репозитория.

## Настройка и запуск

См. `SETUP.md` — пошагово: Node.js 20, Postgres (Railway), Redis (Upstash),
ключ Claude API, `.env`, `npm install` + `npm run seed`, `npm run dev` в
`backend/` и `frontend/`.

## Документация

`docs/01-rules-table.md` — единственный источник правды о том, как ход
игрока меняет числа (ИИ классифицирует, алгоритм считает).
`docs/02-gamemaster-prompt.md` — системный промпт геймместера.
`docs/03-resolved-two-phase-turn.md` — обоснование архитектуры preview/confirm.
