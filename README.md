# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step D.4.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Sub-step D.1: Manifest V3 скелет extension layer (L1).
- ✅ Sub-step D.2: `MutationObserver`-наблюдатель.
- ✅ Sub-step D.3: JSON selector-config с валидацией/rollback; закрыт
  контрактный пробел ТЗ (`GET /selector-config/current`).
- ✅ Sub-step D.4: `PassiveLoggingController` — state machine
  `ACTIVE ⇄ PASSIVE_LOGGING`, терминальный `BROWSER_INCOMPATIBLE`,
  capability detection перед инициализацией остальных компонентов.
  **Инъекция (`value`+`dispatchEvent`) ещё не реализована** — gate
  `shouldAllowActiveInjection()` существует, но вызывается только в
  dry-run режиме до Sub-step D.5.
- GitHub push-пайплайн, полноценная retry-очередь с backoff — далее.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно (параметризация
`browser_family`). Уточнённый риск: Helium несовместим с MV3. **Lemur
Browser** рекомендован для bootstrap.

## Структура проекта

- `extension/src/passive_logging_controller.js` — state machine Passive
  Logging / BROWSER_INCOMPATIBLE (D.4).
- `extension/src/selector_config_manager.js`,
  `extension/src/config/selector-config.default.json` — selector-config,
  валидация, rollback (D.3).
- `extension/src/dom_observer.js` — `MutationObserver` (D.2, обновлён D.3).
- `extension/src/content_script.js` — оркестрация всех компонентов L1,
  порядок инициализации: compatibility check → selector config → observer (D.1-D.4).
- `extension/src/service_worker.js` — маршрутизация сообщений,
  классификация severity переходов (D.1-D.4).
- `extension/manifest.json` — Manifest V3, порядок content_scripts критичен.
- `extension/README_extension.md` — детали, риски, разграничение
  категорий несовместимости.
- `backend/src/routes/selectorConfig.ts` — `GET /selector-config/current` (D.3).
- `firestore.rules`, `firebase.json`, `firestore.indexes.json`.
- `backend/src/middleware/firebaseAuth.ts`, `serviceAuth.ts`.
- `backend/src/services/deadLetterService.ts`.
- `backend/src/routes/capture.ts`.
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
│   │   │   └── deadLetterService.ts
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
│       ├── config/
│       │   └── selector-config.default.json
│       ├── content_script.js
│       ├── dom_observer.js
│       ├── passive_logging_controller.js
│       ├── selector_config_manager.js
│       └── service_worker.js
├── firebase.json
├── firestore.indexes.json
└── firestore.rules
```