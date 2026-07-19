# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step B.1 — начата Итерация B.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Sub-step B.1: коллекции Firestore (`context`, `code_artifacts`,
  `dead_letter`, `selector_configs`) с типизированными converter'ами;
  `POST /capture` теперь реально пишет в Firestore (`persisted: true`),
  включая capture-level дедупликацию code artifacts по `content_hash`.
- Firestore Security Rules, Firebase Auth, GitHub push-пайплайн, extension
  layer (L1) — в следующих под-шагах/итерациях (B.2–J) обязывающего плана.

## Известный и явно зафиксированный пробел после B.1

Retry-очередь и dead-letter обработка (TZ раздел 3.4) **ещё не
реализованы** (Sub-step H.1). Если запись в Firestore в `POST /capture`
падает, событие возвращает `500` с `persisted: false, retry_queued: false`
и **теряется** — это явно указано в ответе API и в коде, а не скрыто.
Коллекция `dead_letter` в Firestore уже создана в моделях (B.1), но
обработчик capture пока не пишет в неё при ошибке — эта интеграция
выполняется в Итерации H.

## Важное архитектурное решение по Auth

`config/firestore.ts` использует `admin.credential.applicationDefault()`,
а не сервисный JSON-ключ, встроенный в образ — на Cloud Run учётные данные
предоставляются автоматически через Workload Identity, поэтому секретный
файл никогда не появляется внутри контейнера.

## Структура backend

- `src/index.ts` — точка входа, middleware трассировки, httpLogger,
  `capture`-роут, `/healthz`, глобальный error handler.
- `src/routes/capture.ts` — `POST /capture` с реальной персистентностью в
  Firestore и capture-level дедупликацией по `content_hash`.
- `src/models/types.ts` — TypeScript-модели, зеркалирующие Data Model
  раздела 4 ТЗ (`MemoryBlob`, `CodeArtifactDocument`, `ChatContextDocument`,
  `DeadLetterDocument`, `SelectorConfigDocument`).
- `src/models/collections.ts` — типизированные Firestore-коллекции через
  `withConverter()`.
- `src/config/firestore.ts` — инициализация Firebase Admin SDK.
- `src/middleware/requestContext.ts` — сквозной `trace_id`.
- `src/schemas/capture.ts` — zod-схема запроса.
- `src/types/logging.ts` — типизированный словарь полей логирования.
- `src/utils/hash.ts`, `src/utils/ids.ts` — SHA-256, UUID.
- `src/logger.ts` — pino + pino-http, `withLogContext()`.
- `src/config/env.ts` — валидация переменных окружения, fail-fast.
- `src/config/region.ts` — guard на `GCP_REGION=us-east1`.
- `Dockerfile` — multi-stage build, non-root runtime user.

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
└── README.md
```