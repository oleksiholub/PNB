# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step E.2.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- 🔶 Итерация E в процессе (E.1–E.2 готовы, E.3 впереди):
  - E.1 — LangGraph.js-пайплайн суммаризации/извлечения сущностей
  - **E.2 — `POST /handoff`**: Cross-Chat Handoff, копирование сжатого
    `memory_blob` из `source_chat_id` в `target_chat_id`, ownership
    checks на оба чата, идемпотентность через provenance-маркер
    `[HANDOFF_FROM:<source_chat_id>]`
- GitHub push-пайплайн, полноценная retry-очередь с backoff — далее (Итерация F, H).

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`. Требует ревью Security
   Thread перед rollout.
2. **Interim summarizer (E.1)**: экстрактивные heuristics вместо
   генеративного LLM для суммаризации — требует решения оператора о
   провайдере/API до production.
3. **Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ**:
   ТЗ (раздел 3.3) описывает только триггер (handoff_trigger_marker) и
   цель (перенос сжатого memory state), но не называет поля запроса.
   Схема `source_chat_id` / `target_chat_id` / `target_session_id` —
   архитектурное решение Development Thread, а не значение из
   спецификации; задокументировано явно в `schemas/handoff.ts`.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/routes/handoff.ts` — `POST /handoff`: ownership checks на
  source и target чаты, merge `memory_blob`, идемпотентность через
  provenance-маркер, dead-letter при сбое Firestore (E.2).
- `backend/src/schemas/handoff.ts` — Zod-схема запроса, с явным
  Contract Ambiguity Disclosure по отсутствующей в ТЗ форме payload (E.2).
- `backend/src/types/logging.ts` — добавлены `operation_type` значения
  `"handoff"` и `"summarize_memory"` (E.2 fix: `summarize_memory`
  использовался в E.1, но отсутствовал в union — исправлено).
- `backend/src/index.ts` — смонтирован `handoffRouter` за
  `requireFirebaseAuth` (E.2).
- `backend/src/services/summarizationService.ts` — LangGraph.js pipeline (E.1).
- `backend/src/routes/capture.ts` — асинхронный триггер суммаризации (E.1).
- `backend/package.json` — `@langchain/langgraph`, `@langchain/core` (E.1).
- `extension/src/injection_engine.js` — DOM-инъекция, jitter (D.5).
- `extension/src/auth_manager.js` — Firebase ID token (D.5).
- `extension/src/passive_logging_controller.js` — state machine (D.4).
- `extension/src/selector_config_manager.js`,
  `extension/src/config/selector-config.default.json` — selector-config (D.3).
- `extension/src/dom_observer.js` — `MutationObserver` (D.2).
- `extension/src/content_script.js`, `service_worker.js` — оркестрация L1 (D.1-D.5).
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

```
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
```