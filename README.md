# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step D.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Итерация B завершена (B.1–B.3): Firestore-персистентность,
  Security Rules, interim dead-letter capture.
- ✅ Итерация C завершена (C.1–C.2): Firebase Auth для end-user запросов,
  Google-signed OIDC для service-to-service (пока не подключён).
- ✅ Sub-step D.1: Manifest V3 скелет extension layer (L1) —
  `manifest.json`, `content_script.js`, `service_worker.js`. Только
  lifecycle-сигнал `PNB_PAGE_READY`; без MutationObserver, без
  распознавания артефактов, без вызовов к backend.
- GitHub push-пайплайн, полноценная retry-очередь с backoff — в
  следующих итерациях (F–J).

## КРИТИЧЕСКИЙ РИСК, обнаруженный на D.1 (не скрыт)

Веб-поиск при выполнении D.1 показал: **Kiwi Browser — целевая
Android-платформа с поддержкой расширений — прекратил активную
разработку в январе 2025 года и не получает обновлений безопасности**.
Если TZ предполагает Kiwi Browser как основную целевую платформу для
extension layer (L1) на Android, этот факт **напрямую угрожает
жизнеспособности всей архитектуры L1** и должен быть переоценён
Theoretical/Hypothesis Thread — Development Thread не имеет мандата
самостоятельно менять целевую платформу и лишь фиксирует находку.
Поле `browser_family: "kiwi"` в `ChatContextDocument` (введено в B.1)
остаётся в коде, но его практическая ценность зависит от разрешения
этого риска.

## Платформенное ограничение MV3 (важно для D.3)

Manifest V3 запрещает исполнение удалённо загруженного кода, но не
запрещает получение удалённых JSON-данных как данных (не как
исполняемого кода) — это разграничение критично для Sub-step D.3,
где selector-config должен подгружаться удалённо без нарушения этого
правила Chrome Web Store.

## Структура проекта

- `extension/manifest.json` — Manifest V3 конфигурация (D.1).
- `extension/src/content_script.js` — скелет content script (D.1).
- `extension/src/service_worker.js` — event-driven service worker (D.1).
- `extension/README_extension.md` — детали и предупреждения по L1-слою.
- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Security
  Rules и конфигурация деплоя.
- `backend/src/middleware/firebaseAuth.ts` — верификация Firebase ID token.
- `backend/src/middleware/serviceAuth.ts` — верификация Google-signed OIDC
  identity token (пока не подключён к роутам).
- `backend/src/services/deadLetterService.ts` — interim dead-letter capture.
- `backend/src/routes/capture.ts` — `POST /capture`.
- `backend/src/models/types.ts`, `collections.ts` — Data Model раздела 4 ТЗ.
- `backend/src/config/firestore.ts`, `env.ts`, `region.ts` — конфигурация.
- `backend/src/middleware/requestContext.ts` — сквозной `trace_id`.
- `backend/src/schemas/capture.ts` — zod-схема запроса.
- `backend/src/types/logging.ts` — типизированный словарь полей логирования.
- `backend/src/utils/hash.ts`, `backend/src/utils/ids.ts` — SHA-256, UUID.
- `backend/src/logger.ts` — pino + pino-http, `withLogContext()`.
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
├── extension/
│   ├── icons/
│   ├── src/
│   │   ├── content_script.js
│   │   └── service_worker.js
│   ├── README_extension.md
│   └── manifest.json
├── README.md
├── firebase.json
├── firestore.indexes.json
└── firestore.rules
```