# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step H.1.

## Статус

- ✅ Итерация A завершена (A.1–A.3)
- ✅ Итерация B завершена (B.1–B.3)
- ✅ Итерация C завершена (C.1–C.2)
- ✅ Итерация D завершена целиком (D.1–D.5)
- ✅ Итерация E завершена целиком (E.1–E.3)
- ✅ Итерация F завершена целиком (F.1–F.4)
- ✅ Итерация G завершена целиком (G.1–G.2)
- 🔶 Итерация H в процессе:
  - **H.1 — Cloud Tasks retry queue infrastructure**: `retryQueueService.ts`
    (`enqueueRetryTask`), `POST /retry-task/:operation`
    (`routes/retryTask.ts`) reading `X-CloudTasks-TaskRetryCount`,
    exhaustion → `dead_letter` write; queue itself provisioned via
    `infra/create_retry_queue.sh` (exponential backoff at queue level).
    **Explicit gap**: business-logic dispatch и wiring существующих
    точек сбоя на `enqueueRetryTask` — раскрытый follow-up.
  - H.2 — `RAW_FALLBACK`, repair-pass, deterministic serializer + закрытие
    пробела H.1 (подключение `OPERATION_HANDLERS`) — впереди
  - H.3 — адаптивная суммаризация/батчинг при приближении к лимитам Firestore — впереди

## ⚠️ Открытые компромиссы, требующие внимания

1. Security TODO (D.5): временное хранение email/password в `chrome.storage.local`.
2. Interim summarizer (E.1): экстрактивные heuristics вместо LLM.
3. Request shape для `POST /handoff` (E.2) не специфицирован в ТЗ.
4. Client-side encryption contract для `GET /context/:chatId` (E.3) не специфицирован в ТЗ.
5. Token caching policy для GitHub App (F.1) не специфицирована в ТЗ.
6. Target repository coordinates и default branch (F.2) не специфицированы в ТЗ.
7. Exact commit-log schema (F.3) не специфицирована в ТЗ.
8. `handoff_trigger_markers` enforcement scope (F.4) не специфицирован полностью в ТЗ.
9. CI-result-to-artifact correlation granularity (G.1) не специфицирована в ТЗ.
10. `REPOSITORY_CONNECTION`/`BACKEND_SERVICE_URL` остаются `REPLACE_ME_*` (G.1).
11. `REQUIRES_REVIEW` — терминальный статус без auto-recovery (G.2).
12. Без `@octokit/rest`, используется native `fetch()` (G.2).
13. **Business-logic retry dispatch не подключён (H.1)** — `OPERATION_HANDLERS` пуст; любая задача получает `501 operation_not_wired`, а не реальный повтор. Явно раскрытый пробел, требующий follow-up.
14. **Независимые конфигурации max-attempts (H.1)**: `RETRY_MAX_ATTEMPTS` (env) и `--max-attempts` (Cloud Tasks queue) не синхронизируются автоматически.
15. **Иллюстративные значения backoff (H.1)**: `min-backoff=1s`, `max-backoff=600s`, `max-doublings=5`, `max-attempts=5` — не мандат ТЗ, подлежат тюнингу по данным Итерации I.

## Итог по браузерному риску (D.1–D.2)

Критический риск Kiwi Browser снят архитектурно. Уточнённый риск: Helium
несовместим с MV3. **Lemur Browser** рекомендован для bootstrap.

## Структура проекта

- `backend/src/services/retryQueueService.ts` — `enqueueRetryTask()` (H.1)
- `backend/src/routes/retryTask.ts` — `POST /retry-task/:operation`, `OPERATION_HANDLERS` пуст (H.1)
- `infra/create_retry_queue.sh` — provisions `pnb-retry-queue` (H.1)
- `backend/src/config/env.ts` — retry-queue env vars (H.1)
- `backend/package.json` — `@google-cloud/tasks` dependency (H.1)
- `backend/src/index.ts` — mounts `/retry-task/:operation` (H.1)
- `backend/src/types/logging.ts` — `retry_task` operation type (H.1)
- `backend/src/services/githubMergeService.ts` — merge-on-green-CI (G.2)
- `backend/src/routes/ciCallback.ts` — CI reporting + merge dispatch (G.1/G.2)
- `cloudbuild.yaml`, `infra/create_cloud_build_trigger.sh` (G.1)
- `backend/src/routes/selectorConfig.ts` (D.3/F.4)
- `backend/src/routes/push.ts` (F.3)
- `backend/src/services/githubBranchService.ts`, `githubAppAuth.ts` (F.1/F.2)
- `backend/src/routes/context.ts` (E.3)
- `backend/src/routes/handoff.ts` (E.2)
- `backend/src/services/summarizationService.ts` (E.1)
- `extension/src/*` (D.1-D.5)
- `firestore.rules`, `firebase.json`, `firestore.indexes.json`, и др. базовые файлы (A–C)

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
│   │   │   ├── retryTask.ts
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
│   │   │   ├── githubMergeService.ts
│   │   │   ├── retryQueueService.ts
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
│   │   └── .gitkeep
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
    ├── create_cloud_build_trigger.sh
    └── create_retry_queue.sh