# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step G.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена целиком (E.1–E.3)
- ✅ Итерация F завершена целиком (F.1–F.4)
- 🔶 Итерация G в процессе:
  - **G.1 — Cloud Build trigger + CI reporting**: `cloudbuild.yaml`
    (install → build → test → report), `gcloud builds triggers create`
    provisioning script (`infra/create_cloud_build_trigger.sh`),
    `POST /ci-callback` за `requireGoogleServiceAuth` — первый реальный
    потребитель этого middleware, forward-provisioned ещё в C.2
  - G.2 — авто-merge при зелёном CI, `REQUIRES_REVIEW` при конфликте — впереди

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
   publish (F.4) not fully specified in the TZ**: mirrors the
   extension-side validator's non-strict treatment of this field.
9. **CI-result-to-artifact correlation granularity (G.1) not specified in
   the TZ**: Cloud Build's trigger event carries only a branch name, not
   a PNB `artifact_id`, so `POST /ci-callback` applies the CI outcome to
   ALL `code_artifacts` currently at `push_status: PUSHED_NO_CI` on the
   reported `target_branch`. This is the only interpretation consistent
   with "one CI run per branch push," but it is an explicit
   interpretation, not something the TZ states directly.
10. **`REPOSITORY_CONNECTION` / `BACKEND_SERVICE_URL` placeholders (G.1)
    are deployment-specific and left as `REPLACE_ME_*` values in
    `infra/create_cloud_build_trigger.sh` and `cloudbuild.yaml`
    substitutions** — the TZ does not name these, consistent with the
    same pattern already applied to `GITHUB_REPO_OWNER`/`NAME` in F.2.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `cloudbuild.yaml` — install → build → test → report pipeline (G.1).
- `infra/create_cloud_build_trigger.sh` — provisions `pnb-auto-branch-ci`
  trigger on `^auto/.*$` (G.1); merge policy deferred to G.2.
- `backend/src/routes/ciCallback.ts` — `POST /ci-callback` (G.1).
- `backend/src/schemas/ciCallback.ts` — Zod schema for CI-callback (G.1).
- `backend/src/models/types.ts` — `ci_build_id`/`ci_commit_sha` fields (G.1).
- `backend/src/middleware/serviceAuth.ts` — `requireGoogleServiceAuth`
  now mounted on `/ci-callback` (G.1).
- `firestore.indexes.json` — composite index `(target_branch, push_status)` (G.1).
- `backend/src/routes/selectorConfig.ts` — GET/POST selector-config (D.3/F.4).
- `backend/src/schemas/selectorConfig.ts` — structural validation (F.4).
- `backend/src/routes/push.ts` — QA gate + Git write (F.3).
- `backend/src/services/githubBranchService.ts` — `ensureSessionBranch()` (F.2).
- `backend/src/config/env.ts` — GitHub App/repo vars; `SERVICE_AUDIENCE`/
  `TRUSTED_SERVICE_ACCOUNTS` now effectively required (G.1).
- `backend/src/services/githubAppAuth.ts` — GitHub App auth (F.1).
- `backend/src/routes/context.ts` — `GET /context/:chatId` (E.3).
- `backend/src/routes/handoff.ts` — `POST /handoff` (E.2).
- `backend/src/index.ts` — mounted routers incl. `/ci-callback` (G.1).
- `backend/src/services/summarizationService.ts` — LangGraph.js (E.1).
- `extension/src/*` — L1 orchestration, selector-config, auth (D.1-D.5).
- `firestore.rules`, `firebase.json`, `backend/src/middleware/firebaseAuth.ts`,
  `backend/src/services/deadLetterService.ts`, `backend/src/models/collections.ts`,
  `backend/src/config/firestore.ts`, `region.ts`, `requestContext.ts`,
  `backend/src/schemas/capture.ts`, `handoff.ts`, `backend/src/utils/hash.ts`,
  `ids.ts`, `backend/src/logger.ts`, `backend/Dockerfile`.

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
│   │   │   ├── ciCallback.ts
│   │   │   ├── context.ts
│   │   │   ├── handoff.ts
│   │   │   ├── push.ts
│   │   │   └── selectorConfig.ts
│   │   ├── schemas/
│   │   │   ├── capture.ts
│   │   │   ├── ciCallback.ts
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
├── cloudbuild.yaml
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
├── firestore.rules
└── infra/
    └── create_cloud_build_trigger.sh