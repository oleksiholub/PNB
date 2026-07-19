# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step B.2.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Sub-step B.1: коллекции Firestore, типизированные модели, реальная
  персистентность `POST /capture`, capture-level дедупликация.
- ✅ Sub-step B.2: Firestore Security Rules (`firestore.rules`) —
  deny-by-default, явное открытие каждой коллекции с проверкой
  `request.auth.uid == owner_uid` для `context` и `code_artifacts`;
  `dead_letter` закрыт полностью для клиентов, `selector_configs`
  доступен на чтение только авторизованным пользователям.
- Firebase Auth (проверка ID token), GitHub push-пайплайн, extension layer
  (L1) — в следующих под-шагах/итерациях (C–J) обязывающего плана.

## Критически важное ограничение после B.2

Firestore Security Rules защищают **только доступ через клиентские SDK**
(будущий extension layer L1, веб-консоль). Backend использует Admin SDK
(`src/config/firestore.ts`), который **полностью обходит Security Rules**
по архитектуре Firebase — поэтому `POST /capture` до сих пор не защищён
Security Rules и полагается на клиентский заголовок `x-owner-uid`, который
**не верифицируется** до Sub-step C.1 (проверка Firebase ID token). Это
явно зафиксированный, не скрытый разрыв в безопасности backend-эндпоинта.

## Известный и явно зафиксированный пробел после B.1 (остаётся открытым)

Retry-очередь и dead-letter обработка (TZ раздел 3.4) ещё не реализованы
(Sub-step H.1). При сбое записи в Firestore событие теряется — API
возвращает `persisted: false, retry_queued: false`.

## Структура проекта

- `firestore.rules` — Security Rules для клиентского доступа (B.2).
- `firebase.json`, `firestore.indexes.json` — конфигурация деплоя правил и
  составной индекс для дедупликации по `chat_id` + `content_hash`.
- `backend/src/index.ts` — точка входа, middleware трассировки, httpLogger,
  `capture`-роут, `/healthz`, глобальный error handler.
- `backend/src/routes/capture.ts` — `POST /capture` с персистентностью в
  Firestore и capture-level дедупликацией.
- `backend/src/models/types.ts` — TypeScript-модели Data Model раздела 4 ТЗ.
- `backend/src/models/collections.ts` — типизированные Firestore-коллекции.
- `backend/src/config/firestore.ts` — инициализация Firebase Admin SDK.
- `backend/src/middleware/requestContext.ts` — сквозной `trace_id`.
- `backend/src/schemas/capture.ts` — zod-схема запроса.
- `backend/src/types/logging.ts` — типизированный словарь полей логирования.
- `backend/src/utils/hash.ts`, `backend/src/utils/ids.ts` — SHA-256, UUID.
- `backend/src/logger.ts` — pino + pino-http, `withLogContext()`.
- `backend/src/config/env.ts` — валидация переменных окружения.
- `backend/src/config/region.ts` — guard на `GCP_REGION=us-east1`.
- `backend/Dockerfile` — multi-stage build, non-root runtime user.

## Дерево файлов и папок PNB

```
PNB/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   ├── firestore.ts
│   │   │   └── region.ts
│   │   ├── middleware/
│   │   │   └── requestContext.ts
│   │   ├── models/
│   │   │   ├── collections.ts
│   │   │   └── types.ts
│   │   ├── routes/
│   │   │   └── capture.ts
│   │   ├── schemas/
│   │   │   └── capture.ts
│   │   ├── types/
│   │   │   └── logging.ts
│   │   ├── utils/
│   │   │   ├── hash.ts
│   │   │   └── ids.ts
│   │   ├── index.ts
│   │   └── logger.ts
│   ├── .dockerignore
│   ├── .env.example
│   ├── .gitignore
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   └── architecture-notes.md
├── README.md
├── firebase.json
├── firestore.indexes.json
└── firestore.rules
```