# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step H.0 (исправление ошибок,
найденных при аудите пользовательского ZIP-архива) и предшествующего
ему H.1 (Cloud Tasks retry queue).

## Статус

- ✅ Итерации A–G завершены (подтверждено прямым чтением архива, предоставленного пользователем)
- ✅ **H.0 (новый, аудит и исправление ошибок)** — 6 ошибок найдено при глубоком построчном чтении архива, все 6 исправлены в этом подшаге
- ✅ H.1 — Cloud Tasks retry queue infrastructure (без изменений, ошибок не найдено)
- ⏳ H.2 — RAW_FALLBACK/repair-pass — уже частично присутствовал в архиве как `buildDeterministicFallback()` внутри `summarizationService.ts`, требует отдельной ревизии в следующем подшаге
- ⏳ H.3 — адаптивная суммаризация/батчинг — впереди

## Аудит и исправления Sub-step H.0

Пользователь предоставил ZIP-архив с полным кодом проекта. Проведён построчный анализ всех 69 файлов. Найдено 6 расхождений, классифицированных по уровню достоверности (Established = подтверждено прямым чтением байтов, Likely = вероятная, но не гарантированно ломающая проблема):

| # | Файл(ы) | Confidence | Что было не так | Как исправлено |
|---|---|---|---|---|
| 1 | `services/summarizationService.ts` | **Established** | Буквальный (не экранированный) разрыв строки внутри regex-литерала `ACTION_VERB_RE` и двух вызовов `.join(" \n ")` — невалидный TS-синтаксис, `tsc` не скомпилировал бы файл | Заменено на экранированную последовательность `\n` |
| 2 | `services/githubMergeService.ts` + `routes/ciCallback.ts` | **Established** | `getInstallationAccessToken()` вызывался без аргументов, хотя сигнатура требует `(credentials, traceId)`; `mergeSessionBranchIntoDefault()` не принимал `traceId` вовсе | Добавлен обязательный параметр `traceId` в `mergeSessionBranchIntoDefault()`, вызов `getInstallationAccessToken()` теперь получает реальные credentials через `loadGithubAppCredentialsFromEnv()`; `ciCallback.ts` передаёт `traceId` |
| 3 | `models/collections.ts` + `routes/selectorConfig.ts` | **Established** | Selector-config писался/читался по ДВУМ несогласованным путям Firestore одновременно (`selector_configs/{version}` и `configs/selectors/versions/current`), третий путь в `collections.ts` не использовался вовсе | Добавлена `currentSelectorConfigDoc()` в `collections.ts`; `selectorConfig.ts` переписан на единый источник истины через `models/collections.ts` |
| 4 | `middleware/serviceAuth.ts` | Likely | Читал `process.env` напрямую, минуя `loadEnv()`/`EnvSchema`, в отличие от всего остального кода | Переведён на `loadEnv()` |
| 5 | `services/githubBranchService.ts` + `routes/capture.ts` | Likely | Формула `auto/${sessionId}` дублировалась в двух файлах без общего источника | Вынесена в новый `utils/branchNaming.ts` (`buildSessionBranchName()`) |
| 6 | `routes/capture.ts` | Likely (оптимизация) | Лишний `await docRef.get()` для получения `refCount`, который уже был известен локально | Заменено на локальную переменную `refCountLocal` |

**Не найдено ошибок** (проверено детально, оставлено без изменений): `routes/handoff.ts`, `schemas/handoff.ts`, `routes/context.ts`, `routes/retryTask.ts`, `services/retryQueueService.ts`, `routes/push.ts` (дедупликация по `push_status`+`target_branch` работает корректно), `config/env.ts`, `config/region.ts`, `config/firestore.ts`, `utils/hash.ts`, `utils/ids.ts`, `models/types.ts`.

## ⚠️ Открытые компромиссы (перенесены из предыдущей документации, актуальность подтверждена по архиву)

1. Security TODO (D.5): временное хранение email/password в `chrome.storage.local`.
2. Interim summarizer (E.1): экстрактивные heuristics вместо LLM.
3. Client-side encryption contract для `GET /context/:chatId` (E.3) — плейсхолдер `unspecified-placeholder` алгоритм, не финализирован.
4. Token caching policy для GitHub App (F.1) не специфицирована — токен запрашивается заново на каждый вызов, не кэшируется.
5. `handoff_trigger_markers` enforcement scope (F.4) не специфицирован полностью.
6. `REQUIRES_REVIEW` (G.2) — терминальный статус без auto-recovery webhook.
7. Business-logic retry dispatch (`OPERATION_HANDLERS`) в `routes/retryTask.ts` пуст (H.1) — явный, задокументированный пробел.
8. Иллюстративные значения backoff (H.1) в `infra/create_retry_queue.sh`, требуют тюнинга.
9. **RAW_FALLBACK (H.2)** уже частично реализован через `buildDeterministicFallback()` в `summarizationService.ts`, но требует отдельной ревизии на предмет полноты relative к TZ 3.4/4 в следующем подшаге.

## Структура проекта

- `backend/src/utils/branchNaming.ts` — **новый (H.0)**: единая формула `auto/${sessionId}`, устраняет дублирование
- `backend/src/services/summarizationService.ts` — **исправлен (H.0)**: устранён невалидный синтаксис regex/join
- `backend/src/services/githubMergeService.ts` — **исправлен (H.0)**: добавлен обязательный `traceId`, корректный вызов `getInstallationAccessToken`
- `backend/src/routes/ciCallback.ts` — **исправлен (H.0)**: передаёт `traceId` в `mergeSessionBranchIntoDefault`
- `backend/src/models/collections.ts` — **исправлен (H.0)**: добавлена `currentSelectorConfigDoc()`
- `backend/src/routes/selectorConfig.ts` — **переписан (H.0)**: единый источник истины Firestore
- `backend/src/middleware/serviceAuth.ts` — **исправлен (H.0)**: использует `loadEnv()`
- `backend/src/routes/capture.ts` — **исправлен (H.0)**: убран лишний Firestore round-trip, использует `buildSessionBranchName()`
- `backend/src/services/githubBranchService.ts` — **исправлен (H.0)**: использует общую `buildSessionBranchName()`
- Остальные файлы — без изменений в этом подшаге, соответствуют состоянию из предоставленного архива

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
│   │       ├── branchNaming.ts
│   │       ├── hash.ts
│   │       └── ids.ts
│   └── tsconfig.json
├── cloudbuild.yaml
├── docs/
│   └── architecture-notes.md
├── extension/
│   ├── README_extension.md
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
```
