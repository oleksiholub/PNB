# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step F.4 — **Итерация F завершена целиком**.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена целиком (E.1–E.3)
- ✅ **Итерация F завершена целиком (F.1–F.4)**:
  - F.1 — GitHub App authentication service
  - F.2 — `githubBranchService.ts`
  - F.3 — QA gate + Git write (`POST /push/:artifactId`)
  - **F.4 — `POST /selector-config/refresh`**: закрывает последний пробел
    в API-контракте (публикация selector-config, а не только чтение
    из D.3), с той же структурной валидацией, что применяется на стороне
    extension, и с `version` как идемпотентным ключом публикации

## ⚠️ Открытые компромиссы, требующие внимания

1. **Security TODO (D.5)**: временное хранение email/password для
   Firebase-авторизации в `chrome.storage.local`.
2. **Interim summarizer (E.1)**: экстрактивные heuristics вместо LLM.
3. **Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ**.
4. **Client-side encryption contract для `GET /context/:chatId` (E.3)
   не специфицирован в ТЗ**.
5. **Token caching policy для GitHub App (F.1) не специфицирована в ТЗ**.
6. **Target repository coordinates и default branch (F.2) не
   специфицированы в ТЗ**.
7. **Exact commit-log schema for pushed artifacts (F.3) not specified in
   the TZ**: uses `content_hash + target_branch + push_status` as the
   durable deduplication key instead of a dedicated commit-SHA field.
8. **`handoff_trigger_markers` enforcement scope for selector-config
   publish (F.4) not fully specified in the TZ**: mirroring the
   extension-side validator, this field is present in the TZ's example
   JSON but not enforced as strictly required by
   `SelectorConfigPayloadSchema` on the backend — a deliberate, disclosed
   parity choice rather than a stricter independent backend rule that
   could reject configs the extension itself would accept.
9. **Bugfix note (discovered during F.4)**: the original D.3 GET handler
   logged non-existent `ResultStatus` values (`"PENDING"`, `"OK"`,
   `"NOT_FOUND"`, `"ERROR"`); this was corrected in-place to use only the
   three values defined in `types/logging.ts` (`ACCEPTED`,
   `VALIDATION_FAILED`, `INTERNAL_ERROR`), fixing a latent TypeScript
   type-safety gap alongside the new F.4 code in the same file.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/routes/selectorConfig.ts` — `GET /selector-config/current`
  (D.3, bugfixed logging) и **`POST /selector-config/refresh`** (F.4):
  публикация новой selector-config версии, обновление указателя
  `configs/selectors/versions/current` в одной batched-транзакции.
- `backend/src/schemas/selectorConfig.ts` — Zod-схема структурной
  валидации selector-config payload, зеркалирующая клиентский валидатор
  extension (F.4).
- `backend/src/types/logging.ts` — добавлены `selector_config_fetch`,
  `selector_config_publish` в `OperationType` (F.4).
- `backend/src/routes/push.ts` — `POST /push/:artifactId`: QA gate,
  branch provisioning, Git blob/tree/commit write, `push_status` update (F.3).
- `backend/src/services/githubBranchService.ts` — `ensureSessionBranch()`
  for `auto/<session_id>` with 422-race idempotency (F.2).
- `backend/src/config/env.ts` — `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`,
  `GITHUB_DEFAULT_BRANCH`, plus F.1 vars (F.1/F.2).
- `backend/.env.example` — GitHub App and repository coordinate placeholders.
- `backend/src/services/githubAppAuth.ts` — GitHub App auth, RS256 JWT,
  installation access token (F.1).
- `backend/src/routes/context.ts` — `GET /context/:chatId` (E.3).
- `backend/src/routes/handoff.ts` — `POST /handoff` (E.2).
- `backend/src/schemas/handoff.ts` — Zod-scheme for `/handoff` (E.2).
- `backend/src/index.ts` — mounted routers; `/` status string now
  reflects push+selector-config-refresh completion (F.4).
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
│   │   │   ├── push.ts
│   │   │   └── selectorConfig.ts
│   │   ├── schemas/
│   │   │   ├── capture.ts
│   │   │   ├── handoff.ts
│   │   │   └── selectorConfig.ts
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