# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step A.2 (`POST /capture`).

## Статус

- ✅ Sub-step A.1: Node.js/TypeScript проект, Dockerfile для Cloud Run,
  region guard (`us-east1`), базовый structured logger, `GET /healthz`.
- ✅ Sub-step A.2: `POST /capture` — валидация payload (zod) по схеме
  раздела 3.2/4 ТЗ, вычисление `content_hash` (SHA-256) для code artifacts,
  генерация `trace_id`, нормализация `qa_status` (отсутствие → `FAILED`
  по правилу раздела 4 ТЗ).
- Firestore-персистентность, Firebase Auth, GitHub push-пайплайн, extension
  layer (L1) — в следующих итерациях (A.3, B–J) обязывающего плана.

## Важное ограничение объёма Sub-step A.2

`POST /capture` на этом под-шаге **не пишет данные в Firestore** — ответ
`202 Accepted` содержит явное поле `persisted: false`, чтобы не создавать
ложное впечатление durability до реализации Итерации B. Это осознанное
разграничение ответственности, а не недосмотр.

## Структура backend

- `src/index.ts` — точка входа Express-приложения, монтирует `capture`-роут.
- `src/routes/capture.ts` — обработчик `POST /capture`.
- `src/schemas/capture.ts` — zod-схема запроса, правило дефолта `qa_status`.
- `src/utils/hash.ts` — SHA-256 хэширование содержимого code artifact.
- `src/utils/ids.ts` — генерация `trace_id`/`artifact_id` (UUID).
- `src/config/env.ts` — валидация переменных окружения, fail-fast.
- `src/config/region.ts` — guard на `GCP_REGION=us-east1`.
- `src/logger.ts` — базовый pino-логгер (полный набор полей — Sub-step A.3).
- `Dockerfile` — multi-stage build, non-root runtime user.

## Дерево файлов и папок PNB

```
PNB/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   └── region.ts
│   │   ├── routes/
│   │   │   └── capture.ts
│   │   ├── schemas/
│   │   │   └── capture.ts
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