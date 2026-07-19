# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step F.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена целиком (E.1–E.3)
- 🔶 Итерация F в процессе:
  - **F.1 — GitHub App authentication service**: signing App JWT (RS256)
    и обмен на installation access token, `GITHUB_APP_*` env vars, ключ
    только через Secret Manager (никогда в репозитории/образе)
  - F.2–F.4 (installation token в push-цикле, QA-гейт, `POST /push`,
    `POST /selector-config/refresh`) — впереди

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`. Требует ревью Security
   Thread перед rollout.
2. **Interim summarizer (E.1)**: экстрактивные heuristics вместо
   генеративного LLM для суммаризации.
3. **Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ**.
4. **Client-side encryption contract для `GET /context/:chatId` (E.3)
   не специфицирован в ТЗ** — conservative placeholder envelope.
5. **Token caching policy для GitHub App (F.1) не специфицирована в
   ТЗ**: ТЗ не даёт TTL-политику кэширования или concurrency-стратегию
   для installation-токенов при параллельных push-операциях. F.1
   осознанно минтит новый токен на каждый вызов (без кэширования) —
   проще и безопаснее против race condition истечения токена, но ценой
   дополнительных вызовов GitHub API при высокой конкурентности. Это
   архитектурное решение Development Thread, а не значение из ТЗ; при
   росте push-объёма в F.2–F.4 требует пересмотра.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/services/githubAppAuth.ts` — GitHub App auth: signing
  RS256 JWT, обмен на installation access token через
  `POST /app/installations/:id/access_tokens`, least-privilege (без
  запроса дополнительных permissions сверх выданных App), без
  кэширования токена между вызовами (F.1).
- `backend/src/config/env.ts` — добавлены `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` (optional до
  Sub-step F.4, "model exists before consumer" паттерн) (F.1).
- `backend/.env.example` — добавлены GitHub App переменные с явным
  предупреждением: приватный ключ только через Secret Manager (F.1).
- `backend/package.json` — добавлена зависимость `jsonwebtoken` для
  подписи App JWT (F.1).
- `backend/src/routes/context.ts` — `GET /context/:chatId` (E.3).
- `backend/src/routes/handoff.ts` — `POST /handoff` (E.2).
- `backend/src/schemas/handoff.ts` — Zod-схема `/handoff` request (E.2).
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