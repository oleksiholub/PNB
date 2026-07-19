# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step E.3.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена до E.3:
  - E.1 — LangGraph.js-пайплайн суммаризации/извлечения сущностей
  - E.2 — `POST /handoff`
  - **E.3 — `GET /context/:chatId`**: read-side для resumed sessions,
    ownership checks, encrypted transport envelope по умолчанию
- GitHub push-пайплайн, полноценная retry-очередь с backoff — далее (Итерация F, H).

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`. Требует ревью Security
   Thread перед rollout.
2. **Interim summarizer (E.1)**: экстрактивные heuristics вместо
   генеративного LLM для суммаризации — требует решения оператора о
   провайдере/API до production.
3. **Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ**:
   `source_chat_id` / `target_chat_id` / `target_session_id` —
   архитектурное решение Development Thread.
4. **Client-side encryption contract для `GET /context/:chatId` (E.3) не
   специфицирован в ТЗ**: раздел 4 определяет лишь поле
   `memory_blob.encrypted: true`, но не даёт алгоритм, key derivation или
   точный envelope format. Для E.3 выбран conservative transport envelope
   с base64-encoded payload и явным placeholder note; production crypto
   contract должен быть закреплён отдельным security-design шагом.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/routes/context.ts` — `GET /context/:chatId`: ownership
  checks, encrypted transport envelope по умолчанию, plaintext режим
  только через `?mode=plaintext` для дебага (E.3).
- `backend/src/routes/handoff.ts` — `POST /handoff`: ownership checks,
  merge `memory_blob`, idempotency marker (E.2).
- `backend/src/schemas/handoff.ts` — Zod-схема `/handoff` request (E.2).
- `backend/src/types/logging.ts` — `operation_type` values including
  `handoff` and `summarize_memory`.
- `backend/src/index.ts` — mounted `handoffRouter` and `contextRouter`
  behind `requireFirebaseAuth` (E.2/E.3).
- `backend/src/services/summarizationService.ts` — LangGraph.js pipeline (E.1).
- `backend/src/routes/capture.ts` — async summarization trigger (E.1).
- `backend/package.json` — `@langchain/langgraph`, `@langchain/core` (E.1).
- `extension/src/injection_engine.js` — DOM-injection, jitter (D.5).
- `extension/src/auth_manager.js` — Firebase ID token (D.5).
- `extension/src/passive_logging_controller.js` — state machine (D.4).
- `extension/src/selector_config_manager.js`,
  `extension/src/config/selector-config.default.json` — selector-config (D.3).
- `extension/src/dom_observer.js` — `MutationObserver` (D.2).
- `extension/src/content_script.js`, `service_worker.js` — L1 orchestration (D.1-D.5).
- `extension/manifest.json` — Manifest V3 (D.1-D.5).
- `backend/src/routes/selectorConfig.ts` — `GET /selector-config/current` (D.3).
- `firestore.rules`, `firebase.json`, `firestore.indexes.json`.
- `backend/src/middleware/firebaseAuth.ts`, `serviceAuth.ts`.
- `backend/src/services/deadLetterService.ts`.
- `backend/src/models/types.ts`, `collections.ts`.
- `backend/src/config/firestore.ts`, `env.ts`, `region.ts`.
- `backend/src/middleware/requestContext.ts`.
- `backend/src/schemas/capture.ts`.
- `backend/src/utils/hash.ts`, `ids.ts`.
- `backend/src/logger.ts`.
- `backend/Dockerfile`.

## Дерево файлов и папок PNB

```text
PNB/
├── README.md
├── backend/
│   ├── .dockerignore
│   ├── .env.example
│   ├── .gitignore
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   ├── firestore.ts
│   │   │   └── region.ts
│   │   ├── index.ts
│   │   ├── logger.ts
│   │   ├── middleware/
│   │   │   ├── firebaseAuth.ts
│   │   │   ├── requestContext.ts
│   │   │   └── serviceAuth.ts
│   │   ├── models/
│   │   │   ├── collections.ts
│   │   │   └── types.ts
│   │   ├── routes/
│   │   │   ├── capture.ts
│   │   │   ├── context.ts
│   │   │   ├── handoff.ts
│   │   │   └── selectorConfig.ts
│   │   ├── schemas/
│   │   │   ├── capture.ts
│   │   │   └── handoff.ts
│   │   ├── services/
│   │   │   ├── deadLetterService.ts
│   │   │   └── summarizationService.ts
│   │   ├── types/
│   │   │   └── logging.ts
│   │   └── utils/
│   │       ├── hash.ts
│   │       └── ids.ts
│   └── tsconfig.json
├── docs/
│   └── architecture-notes.md
├── extension/
│   ├── README_extension.md
│   ├── icons/
│   ├── manifest.json
│   └── src/
│       ├── auth_manager.js
│       ├── config/
│       │   └── selector-config.default.json
│       ├── content_script.js
│       ├── dom_observer.js
│       ├── injection_engine.js
│       ├── passive_logging_controller.js
│       ├── selector_config_manager.js
│       └── service_worker.js
├── firebase.json
├── firestore.indexes.json
└── firestore.rules