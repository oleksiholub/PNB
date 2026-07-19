# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step C.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Итерация B завершена (B.1–B.3): Firestore-персистентность,
  Security Rules, interim dead-letter capture.
- ✅ Sub-step C.1: `requireFirebaseAuth` — верификация Firebase ID token
  (`Authorization: Bearer <token>`) через `admin.auth().verifyIdToken()`.
  **Критический разрыв, зафиксированный после B.2, закрыт**: непроверяемый
  заголовок `x-owner-uid` полностью удалён из кода, а не просто
  задепрайорен — `owner_uid` теперь берётся исключительно из
  криптографически верифицированного `req.auth.uid`. Добавлена также
  защита от cross-owner коллизий по `content_hash`/`chat_id` (403, если
  совпадение принадлежит другому владельцу).
- IAM service-to-service авторизация (C.2), GitHub push-пайплайн, extension
  layer (L1), полноценная retry-очередь с backoff — в следующих итерациях
  (C.2, D–J).

## Изменение модели угроз после C.1

До этого под-шага `POST /capture` был уязвим к подмене владельца через
произвольный заголовок `x-owner-uid`. Теперь любой запрос без валидного
Firebase ID token получает `401`, а `owner_uid` в Firestore-документах
гарантированно соответствует реальному аутентифицированному пользователю.
Это устраняет угрозу, явно описанную в разделах README для B.2 и Итерации
B — тот баннер по критическому разрыву больше не актуален для `/capture`.

## Остающийся открытый пробел (H.1)

Retry-очередь с экспоненциальным backoff (TZ раздел 3.4) — ещё не
реализована; `POST /capture` при сбое Firestore делает лишь одну
best-effort попытку записи в `dead_letter` (Sub-step B.3).

## Структура проекта

- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Security
  Rules и конфигурация деплоя.
- `backend/src/middleware/firebaseAuth.ts` — верификация Firebase ID token,
  `requireFirebaseAuth` (C.1).
- `backend/src/services/deadLetterService.ts` — interim dead-letter capture.
- `backend/src/routes/capture.ts` — `POST /capture`: персистентность,
  дедупликация, dead-letter fallback, теперь с верифицированным `owner_uid`
  и защитой от cross-owner коллизий.
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
│   │   │   ├── firebaseAuth.ts
│   │   │   └── requestContext.ts
│   │   ├── models/
│   │   │   ├── collections.ts
│   │   │   └── types.ts
│   │   ├── routes/
│   │   │   └── capture.ts
│   │   ├── schemas/
│   │   │   └── capture.ts
│   │   ├── services/
│   │   │   └── deadLetterService.ts
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