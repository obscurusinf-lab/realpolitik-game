# Геополитическая стратегия — ТЗ и каркас

## Структура репозитория

```
docs/
  01-rules-table.md                -- таблица правил влияния ходов на показатели (ЯДРО)
  02-gamemaster-prompt.md           -- системный промпт ИИ-геймместера + валидация
  03-resolved-two-phase-turn.md     -- решённый вопрос: двухфазный ход (preview/confirm) + Redis

backend/src/
  rules/rules-engine.js     -- детерминированный расчёт дельт (протестирован)
  ai/
    gamemaster.js            -- вызов Claude API, retry, fallback
    validateGmResponse.js    -- валидация структуры ответа ИИ (протестирована)
    system-prompt.txt        -- сам промпт, читается gamemaster.js
  db/
    schema.sql                -- полная схема Postgres
    pending-turns.js           -- Redis-обёртка для pending-ходов между preview/confirm
    seed/
      seed.js                   -- загрузка countries/*.json в Postgres
      countries/russia-2026-06.json -- обоснованные seed-данные РФ (22.06.2026, с web-поиском)
  routes/turns.js             -- POST /turns/preview, /turns/confirm, /turns/cancel

frontend/src/
  App.jsx                    -- портированный UI прототипа + двухфазный ввод хода
  api.js                      -- клиент к backend (previewTurn/confirmTurn/cancelTurn)
```

## Стек (обновлено)

```
Frontend:  React + Vite, Tailwind
Backend:   Node.js + Fastify
DB:        PostgreSQL 15+ (партии, ходы, лидерборд)
Cache:     Redis (pending-ходы между preview/confirm; позже — presence в мультиплеере)
Realtime:  Socket.io поверх Fastify (этап 5)
ИИ:        Claude API (Sonnet)
```

## Что уже проверено сквозными тестами с моками (Postgres/Redis/Claude API)

- `rules-engine.js`: детерминизм подтверждён (одинаковый вход → одинаковый
  выход; разные ходы → разные, но воспроизводимые значения в допустимых диапазонах)
- `validateGmResponse.js`: корректно отклоняет неизвестные категории/severity
- **Двухфазный поток preview → confirm полностью протестирован**:
  - preview не открывает Postgres-транзакцию
  - statDeltas совпадают 1:1 между preview и confirm (тот же seed)
  - рассинхрон current_turn между preview/confirm даёт 409, не тихий баг
  - confirm без preview → 409, а не падение
  - в процессе тестирования найден и исправлен реальный баг в
    `pending-turns.js` (save() терял часть payload) — см. docs/03 для деталей

## Что НЕ сделано (следующие шаги для Claude Code)

1. **`callClaudeApi` не реализован** — в `gamemaster.js` это инжектируемая
   зависимость с расчётом на реальный fetch к api.anthropic.com.
   Нужно дописать обёртку и подключить в `server.js` (фастифай-инстанс
   ещё не создан), а также реальный Redis-клиент (`ioredis`) для
   `pending-turns.js` (сейчас используется только в тестах через мок).
2. **Эндпоинты-заглушки не написаны**: `GET /games/:id`, `GET /games/:id/newsfeed`,
   `GET /games/:id/log`, `POST /games` (создание партии), `GET /leaderboard`.
   Все они тривиальные SELECT/INSERT по схеме из `schema.sql` — turns.js
   достаточно подробен как образец стиля.
   **Важно для `POST /games`**: при создании партии нужно скопировать
   `countries.base_stats` → `game_state.stats`, `base_relations` → `relations`,
   а `overview_seed` из JSON-файла страны (см. пункт 3) → `game_state.overview`.
   `overview_seed` НЕ хранится в таблице countries (это сделано намеренно —
   см. `seed.js`), поэтому либо держите файл countries/*.json доступным для
   чтения при создании партии, либо добавьте отдельное поле в схему.
3. **`countries.json`/seed-данные — ГОТОВЫ.** `backend/src/db/seed/countries/russia-2026-06.json`
   содержит обоснованные base_stats/base_relations/relations_graph для РФ
   на 22 июня 2026, собранные через web-поиск (источники указаны в README
   ниже). `backend/src/db/seed/seed.js` загружает их в Postgres
   (`node backend/src/db/seed/seed.js`, нужен `DATABASE_URL`).
   Проверено: JSON парсится, все stats в диапазоне 0-100, структура
   relations соответствует ожиданиям rules-engine.
   **Технический долг по содержанию**: эти цифры — обоснованная интерпретация
   качественной картины, не точная статистическая модель. Если первая
   реальная партия стартует значительно позже 22.06.2026, контекст
   устареет — пересоздайте файл через свежий web-поиск перед запуском.
4. **Spillover-логика** (влияние на союзников/противников затронутой страны,
   п.4 в 01-rules-table.md) — упомянута в коде комментарием
   (`applySpillover(...)` placeholder в rules-engine.js), не реализована.
5. **Web search для старта партии с реальным контекстом** — не реализовано,
   это отдельный шаг этапа 3 основного плана (создание countries.json
   на основе актуальных данных через инструмент поиска).
6. **WebSocket/мультиплеер** — намеренно не начато, это этап 5. Redis уже
   введён заранее именно с расчётом на этот этап.

## Окружение для разработки (решает Claude Code на месте)

Postgres и Redis для разработки — Docker locally или облачные сервисы
(Railway/Upstash) — осознанно не зафиксированы здесь, это должен решить
Claude Code исходя из доступности Docker на машине пользователя.
Критерий по умолчанию: если `docker --version` работает — поднять
`docker-compose.yml` с Postgres 15 и Redis локально (быстрее цикл
разработки, не нужен интернет для каждого запроса к БД). Если Docker
недоступен — Railway (Postgres) + Upstash (Redis), у обоих щедрый
бесплатный тир, не требуют карты для старта.

## Порядок работы для Claude Code

Рекомендуемая последовательность: пункт 3 (seed-данные) → пункт 2 (CRUD
эндпоинты) → пункт 1 (реальный вызов ИИ + реальный Redis вместо мока) →
ручной плейтест одного хода end-to-end через preview/confirm → подключение
frontend → остальное по плану из docs.
