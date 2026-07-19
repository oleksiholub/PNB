# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step E.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- 🔶 Итерация E начата: **Sub-step E.1** — LangGraph.js-пайплайн
  суммаризации/извлечения сущностей (`summarizationService.ts`),
  триггер каждые 5 захваченных сообщений, repair-pass/
  RAW_FALLBACK при невалидном выводе.
- GitHub push-пайплайн, полноценная retry-очередь с backoff — далее (Итерация F, H).

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`. Требует ревью Security
   Thread перед rollout.
2. **Interim summarizer (E.1)**: ТЗ требует LangGraph.js-оркестрацию, но
   не специфицирует LLM-провайдера/API-ключ для самой суммаризации.
   E.1 использует экстрактивные heuristics (regex-based entity/action
   extraction) как временный placeholder, соответствующий форме
   `memory_blob`, но не являющийся генеративной суммаризацией. Требует
   решения оператора о выборе модели/API до production.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/services/summarizationService.ts` — LangGraph.js pipeline
  (extractEntities → extractActionItems → summarize → validate),
  repair-pass/RAW_FALLBACK, compression_level heuristic (E.1).
- `backend/src/routes/capture.ts` — обновлён: после захвата
  conversation-turn асинхронно триггерит суммаризацию каждые 5 сообщений
  (E.1), не блокируя ответ клиенту.
- `backend/package.json` — добавлены `@langchain/langgraph` (^0.4.0) и
  peer-зависимость `@langchain/core` (^0.3.0), обязательная начиная с
  LangGraph.js v0.4.x.
- `extension/src/injection_engine.js` — DOM-инъекция с native setter
  workaround, jitter (D.5).
- `extension/src/auth_manager.js` — Firebase ID token через Identity
  Toolkit REST API (D.5).
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
- `backend/src/types/logging.ts`.
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
│   │   │   └── selectorConfig.ts
│   │   ├── schemas/
│   │   │   └── capture.ts
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