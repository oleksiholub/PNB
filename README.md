# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step D.5 — **Итерация D полностью
завершена**.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ **Итерация D завершена целиком (D.1–D.5)**:
  - D.1 — Manifest V3 скелет
  - D.2 — `MutationObserver`-наблюдатель
  - D.3 — JSON selector-config с валидацией/rollback
  - D.4 — `PassiveLoggingController` (state machine)
  - D.5 — реальная DOM-инъекция (native setter workaround), jitter,
    Firebase-авторизация (Identity Toolkit REST API), пересылка событий
    в `POST /capture` с Bearer ID token
- GitHub push-пайплайн, полноценная retry-очередь с backoff — далее (Итерация F, H).

## ⚠️ Security TODO, требующий ревью перед production

Хранение email/password для Firebase-авторизации в `chrome.storage.local`
(незашифрованное хранилище) — временное решение D.5, зафиксированное как
уязвимость, а не как окончательная архитектура. Требуется ревью Security
Thread перед rollout; см. `extension/README_extension.md`.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `extension/src/injection_engine.js` — DOM-инъекция с native setter
  workaround, jitter (D.5).
- `extension/src/auth_manager.js` — Firebase ID token через Identity
  Toolkit REST API (D.5, только service worker).
- `extension/src/passive_logging_controller.js` — state machine Passive
  Logging / BROWSER_INCOMPATIBLE (D.4), gate теперь реально используется (D.5).
- `extension/src/selector_config_manager.js`,
  `extension/src/config/selector-config.default.json` — selector-config,
  валидация, rollback (D.3).
- `extension/src/dom_observer.js` — `MutationObserver` (D.2, обновлён D.3).
- `extension/src/content_script.js` — оркестрация всех компонентов L1
  (D.1-D.5).
- `extension/src/service_worker.js` — владеет Firebase-сессией,
  пересылает события в backend (D.1-D.5).
- `extension/manifest.json` — Manifest V3, добавлены host_permissions
  для Identity Toolkit/Secure Token (D.5).
- `extension/README_extension.md` — детали, риски, Security TODO.
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