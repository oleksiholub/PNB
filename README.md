# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step C.2 — **Итерация C полностью
завершена**.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Итерация B завершена (B.1–B.3): Firestore-персистентность,
  Security Rules, interim dead-letter capture.
- ✅ Sub-step C.1: `requireFirebaseAuth` — верификация Firebase ID token
  для end-user запросов, замена `x-owner-uid` на `req.auth.uid`.
- ✅ Sub-step C.2: `requireGoogleServiceAuth` — верификация Google-signed
  OIDC identity token (через `google-auth-library`) для будущих
  service-to-service вызовов (Cloud Run/Cloud Build/retry-воркер).
  Проверяются подпись, `audience` (`SERVICE_AUDIENCE`) и явный allowlist
  вызывающих service account (`TRUSTED_SERVICE_ACCOUNTS`) — сама
  успешная верификация подписи и аудитории **не** считается достаточной
  авторизацией.
- GitHub push-пайплайн, extension layer (L1), полноценная retry-очередь с
  backoff — в следующих итерациях (D–J).

## Явно зафиксированный статус C.2: middleware существует, но не подключён

`requireGoogleServiceAuth` реализован полностью, но **ни один роут пока не
использует его** — на C.2 в кодовой базе просто нет ни одного
service-to-service эндпоинта (тот появится с retry-воркером в H.1 или
GitHub/Cloud Build интеграцией в Итерации F). Это форвард-провижининг по
аналогии с коллекцией `dead_letter`, созданной в B.1 и подключённой лишь в
B.3 — не забытый код, а осознанное опережение зависимостей плана.
Переменные `SERVICE_AUDIENCE`/`TRUSTED_SERVICE_ACCOUNTS` пока опциональны
в `env.ts` именно по этой причине.

## Модель авторизации после Итерации C

| Тип вызывающего | Механизм | Middleware |
|---|---|---|
| Конечный пользователь (Android extension, будущий L1) | Firebase Auth ID token | `requireFirebaseAuth` (C.1) |
| Внутренний GCP-сервис (retry-воркер H.1, Cloud Build F) | Google-signed OIDC identity token + allowlist | `requireGoogleServiceAuth` (C.2, пока не подключён) |

Cloud Run сервис по архитектурному решению остаётся в режиме "allow
unauthenticated" на платформенном уровне, потому что встроенная IAM-проверка
Cloud Run распознаёт только Google-signed токены, а не Firebase Auth
end-user токены — авторизация полностью выполняется в коде на уровне
каждого роута.

## Остающийся открытый пробел (H.1)

Retry-очередь с экспоненциальным backoff (TZ раздел 3.4) — ещё не
реализована.

## Структура проекта

- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Security
  Rules и конфигурация деплоя.
- `backend/src/middleware/firebaseAuth.ts` — верификация Firebase ID token
  для end-user запросов (C.1).
- `backend/src/middleware/serviceAuth.ts` — верификация Google-signed OIDC
  identity token для service-to-service вызовов (C.2, пока не подключён).
- `backend/src/services/deadLetterService.ts` — interim dead-letter capture.
- `backend/src/routes/capture.ts` — `POST /capture`: персистентность,
  дедупликация, dead-letter fallback, верифицированный `owner_uid`.
- `backend/src/models/types.ts` — TypeScript-модели Data Model раздела 4 ТЗ.
- `backend/src/models/collections.ts` — типизированные Firestore-коллекции.
- `backend/src/config/firestore.ts` — инициализация Firebase Admin SDK.
- `backend/src/config/env.ts` — валидация переменных окружения, включая
  опциональные `SERVICE_AUDIENCE`/`TRUSTED_SERVICE_ACCOUNTS` (C.2).
- `backend/src/middleware/requestContext.ts` — сквозной `trace_id`.
- `backend/src/schemas/capture.ts` — zod-схема запроса.
- `backend/src/types/logging.ts` — типизированный словарь полей логирования.
- `backend/src/utils/hash.ts`, `backend/src/utils/ids.ts` — SHA-256, UUID.
- `backend/src/logger.ts` — pino + pino-http, `withLogContext()`.
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
│   │   │   ├── requestContext.ts
│   │   │   └── serviceAuth.ts
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