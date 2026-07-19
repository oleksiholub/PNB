# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step A.3 — **Итерация A полностью
завершена**.

## Статус

- ✅ Sub-step A.1: Node.js/TypeScript проект, Dockerfile для Cloud Run,
  region guard (`us-east1`), базовый structured logger, `GET /healthz`.
- ✅ Sub-step A.2: `POST /capture` — валидация payload (zod) по схеме
  раздела 3.2/4 ТЗ, вычисление `content_hash` (SHA-256) для code artifacts,
  генерация `trace_id`, нормализация `qa_status` (отсутствие → `FAILED`
  по правилу раздела 4 ТЗ).
- ✅ Sub-step A.3: сквозной `trace_id` через `requestContextMiddleware` +
  `pino-http`, типизированный словарь полей логирования
  (`operation_type`/`result_status`), `withLogContext()` — гарантирует
  полный обязательный набор полей (`trace_id`, `chat_id`, `session_id`,
  `operation_type`, `result_status`, `retry_count`) в каждой лог-записи,
  включая обработчик ошибок и `/healthz`.
- Firestore-персистентность, Firebase Auth, GitHub push-пайплайн, extension
  layer (L1) — в следующих итерациях (B–J) обязывающего плана.

## Важное ограничение объёма Итерации A

`POST /capture` до сих пор **не пишет данные в Firestore** — ответ
`202 Accepted` содержит явное поле `persisted: false`. Это разграничение
сохраняется до Итерации B и не является недосмотром.

## Структура backend

- `src/index.ts` — точка входа, монтирует middleware трассировки, httpLogger,
  `capture`-роут, `/healthz`, глобальный error handler.
- `src/middleware/requestContext.ts` — назначение/переиспользование
  `trace_id` (заголовок `X-Trace-Id`), интеграция с `genReqId` pino-http.
- `src/routes/capture.ts` — обработчик `POST /capture` с полным
  структурированным логированием через `withLogContext`.
- `src/schemas/capture.ts` — zod-схема запроса, правило дефолта `qa_status`.
- `src/types/logging.ts` — типизированный словарь `operation_type`/`result_status`.
- `src/utils/hash.ts` — SHA-256 хэширование содержимого code artifact.
- `src/utils/ids.ts` — генерация `artifact_id` (UUID).
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
│   │   │   └── region.ts
│   │   ├── middleware/
│   │   │   └── requestContext.ts
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