# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step B.3 — **Итерация B полностью
завершена**.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Sub-step B.1: коллекции Firestore, типизированные модели, реальная
  персистентность `POST /capture`, capture-level дедупликация.
- ✅ Sub-step B.2: Firestore Security Rules — deny-by-default,
  `request.auth.uid == owner_uid` для `context`/`code_artifacts`.
- ✅ Sub-step B.3: interim dead-letter capture (`recordDeadLetter`) — при
  сбое записи в Firestore событие best-effort сохраняется в коллекцию
  `dead_letter` вместо безусловной потери; ответ API явно сообщает
  `dead_lettered: true/false`.
- Firebase Auth (проверка ID token), GitHub push-пайплайн, extension layer
  (L1), полноценная retry-очередь с backoff — в следующих итерациях (C–J).

## Критически важное ограничение после B.2 (остаётся открытым)

Firestore Security Rules защищают только клиентский доступ через SDK.
Backend использует Admin SDK, который **обходит Security Rules**, поэтому
`POST /capture` до сих пор полагается на непроверяемый заголовок
`x-owner-uid` — верификация через Firebase ID token добавляется в
Sub-step C.1.

## Уточнённый статус пробела H.1 после B.3

Sub-step B.3 добавляет **best-effort однократную попытку** записи в
`dead_letter` при сбое основной персистентности — это **не** полноценная
retry-очередь с экспоненциальным backoff, требуемая разделом 3.4 ТЗ.
Если сам сбой Firestore длится дольше одной попытки, запись в
`dead_letter` тоже может провалиться — в этом случае событие
**действительно теряется**, и API возвращает `dead_lettered: false`.
Автоматические повторные попытки с backoff реализуются в Sub-step H.1,
который переиспользует уже существующую коллекцию `dead_letter` и её
Security Rules (обе готовы с B.1/B.2).

## Структура проекта

- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Security
  Rules и конфигурация деплоя (B.2).
- `backend/src/services/deadLetterService.ts` — interim dead-letter
  capture (B.3).
- `backend/src/routes/capture.ts` — `POST /capture` с персистентностью,
  дедупликацией (B.1) и dead-letter fallback при сбое (B.3).
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