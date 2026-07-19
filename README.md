# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step F.2.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена целиком (E.1–E.3)
- 🔶 Итерация F в процессе:
  - F.1 — GitHub App authentication service
  - **F.2 — `githubBranchService.ts`**: обеспечение существования ветки
    `auto/<session_id>`, создание от HEAD базовой ветки, идемпотентность
    при повторных вызовах и при 422-race на конкурентное создание
  - F.3–F.4 (QA-гейт, `POST /push`, `POST /selector-config/refresh`) — впереди

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`.
2. **Interim summarizer (E.1)**: экстрактивные heuristics вместо LLM.
3. **Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ**.
4. **Client-side encryption contract для `GET /context/:chatId` (E.3)
   не специфицирован в ТЗ**.
5. **Token caching policy для GitHub App (F.1) не специфицирована в ТЗ**.
6. **Target repository coordinates и default branch (F.2) не
   специфицированы в ТЗ**: ТЗ упоминает лишь "приватный GitHub-репозиторий"
   без owner/name/default branch. `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`
   и `GITHUB_DEFAULT_BRANCH` вынесены в конфигурацию окружения, а
   `githubBranchService.ts` принимает `baseBranch` явным параметром, а не
   зашивает "main" внутри логики — архитектурное решение Development
   Thread, а не значение из спецификации.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/services/githubBranchService.ts` — `ensureSessionBranch()`:
  читает HEAD ref базовой ветки через `GET /git/ref/heads/:ref`, создаёт
  `auto/<session_id>` через `POST /git/refs`, идемпотентно обрабатывает
  уже существующую ветку и 422-race при конкурентном создании (F.2).
- `backend/src/config/env.ts` — добавлены `GITHUB_REPO_OWNER`,
  `GITHUB_REPO_NAME`, `GITHUB_DEFAULT_BRANCH` (default `"main"` только
  как fallback, не как жёсткое предположение внутри сервиса) (F.2).
- `backend/.env.example` — добавлены переменные target-репозитория (F.2).
- `backend/src/services/githubAppAuth.ts` — GitHub App auth, RS256 JWT,
  installation access token (F.1).
- `backend/src/routes/context.ts` — `GET /context/:chatId` (E.3).
- `backend/src/routes/handoff.ts` — `POST /handoff` (E.2).
- `backend/src/schemas/handoff.ts` — Zod-схема `/handoff` (E.2).
- `backend/src/types/logging.ts` — `operation_type` values.
- `backend/src/index.ts` — mounted routers (E.2/E.3).
- `backend/src/services/summarizationService.ts` — LangGraph.js pipeline (E.1).
- `backend/src/routes/capture.ts` — async summarization trigger (E.1).
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
- `backend/src/config/firestore.ts`, `region.ts`.
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
│   │   │   ├── githubAppAuth.ts
│   │   │   ├── githubBranchService.ts
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