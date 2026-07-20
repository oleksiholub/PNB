# PNB (Perplexity Neural Bridge)

Реализация системы автоматизации кросс-чатного контекста и хендоффа для Perplexity Pro по техническому заданию `tz-handoff_v4.md`. Данный README отражает состояние репозитория после завершения подшагов H.0 (аудит и исправление ошибок), H.1 (Cloud Tasks retry queue), H.2 (repair-pass и RAW_FALLBACK) и **H.3 (адаптивная суммаризация/батчинг при приближении к квотам Firestore)**.

## Статус

- ✅ Итерации A–G завершены
- ✅ H.0 — 6 ошибок найдено и исправлено при аудите архива
- ✅ H.1 — Cloud Tasks retry queue infrastructure
- ✅ H.2 — полный TZ 3.4 error-handling contract для summarization pipeline (repair-pass + RAW_FALLBACK-on-exception)
- ✅ **H.3 (новый) — адаптивная суммаризация, батчинг conversation-событий и deferred mode при приближении к квотам Firestore**
- ⏳ H.4 — интеграция `QuotaGovernor.recordWrite()` в остальные Firestore-пишущие пути (`push.ts`, `retryTask.ts`, `ciCallback.ts`) для более полной картины нагрузки — впереди

## Sub-step H.3: реализация TZ 3.4 (квоты Firestore)

ТЗ 3.4 требует: при приближении квот Firestore к порогу — включать более агрессивную суммаризацию, сокращать частоту фоновых обновлений, объединять capture-события в батч, а при жёстком пороге — переводить не-критичные операции в deferred mode.

### Архитектурное честное ограничение (раскрыто явно, не скрыто)

`QuotaGovernor` — это **per-instance** (на один экземпляр Cloud Run) скользящее окно недавних Firestore-записей в памяти процесса, а НЕ авторитетный проектный учёт реального потребления квот. Поскольку backend по ТЗ 3.2 обязан быть stateless/scale-to-zero, несколько параллельных инстансов ведут независимые несогласованные счётчики, а инстанс, ушедший в ноль, теряет счётчик полностью. Полностью корректная реализация требовала бы чтения реальных данных через Cloud Monitoring Metrics API — это явно вне рамок текущего подшага и зафиксировано как открытый компромисс ниже.

### Что реализовано

- **`quotaGovernor.ts`** (новый) — скользящее окно записей, три режима: `normal` / `aggressive` / `deferred`, пороги настраиваются через `QUOTA_WINDOW_MS`, `QUOTA_AGGRESSIVE_THRESHOLD_OPS`, `QUOTA_DEFERRED_THRESHOLD_OPS`.
- **`captureBatchBuffer.ts`** (новый) — буферизация conversation-событий и батчевый `batch().commit()` в Firestore; **код-артефакты исключены из батчинга** как критичные для push-пайплайна (обоснование дано ТЗ формулировкой "не-критичные операции").
- **`summarizationService.ts`** — `pickCompressionLevel()` теперь принимает `QuotaMode` и устанавливает пол уровня сжатия (`aggressive`-режим → минимум `aggressive`; `deferred`-режим → минимум `emergency`), не занижая уровень, уже требуемый по `refCount`.
- **`capture.ts`** — при `aggressive`/`deferred` режиме conversation-запись уходит в буфер вместо немедленной записи; частота фоновой суммаризации адаптивно снижается (`aggressive` — вдвое реже, `deferred` — пропуск на этот ход); ответ API честно сообщает `persisted`/`batched`/`quota_mode`.
- **`env.ts`** — добавлены три переменные окружения с безопасными дефолтами, деплой не требует ручных действий оператора.

## ⚠️ Открытые компромиссы

1. Security TODO (D.5): временное хранение email/password в `chrome.storage.local`.
2. Client-side encryption contract для `GET /context/:chatId` (E.3) — плейсхолдер `unspecified-placeholder`.
3. Token caching policy для GitHub App (F.1) не специфицирована.
4. `handoff_trigger_markers` enforcement scope (F.4) не специфицирован полностью.
5. `REQUIRES_REVIEW` (G.2) — терминальный статус без auto-recovery webhook.
6. `OPERATION_HANDLERS` в `routes/retryTask.ts` пуст (H.1).
7. Иллюстративные значения backoff (H.1) требуют тюнинга.
8. Repair-pass (H.2) — простой немедленный повтор графа, не отдельная трансформация.
9. **QuotaGovernor (H.3) — per-instance, а не project-wide учёт** (см. раскрытие ограничения выше); пороги (`QUOTA_*_THRESHOLD_OPS`) иллюстративные, не подтверждены нагрузочным тестированием.
10. **Батчинг (H.3) — trade-off консистентности**: буферизованная запись невидима для `GET /context/:chatId` до флуша; повторный capture для того же `chat_id` внутри окна батча перезатирает буферизованную запись (last-write-wins), а не добавляется к ней.
11. `QuotaGovernor.recordWrite()` вызывается только из conversation-пути `capture.ts` — остальные Firestore-пишущие пути (`push.ts`, `retryTask.ts`, `ciCallback.ts`) пока не инкрементируют счётчик, поэтому реальная картина нагрузки от push/CI/retry-операций сейчас не учитывается governor'ом.

## Структура проекта

- `backend/src/services/quotaGovernor.ts` — **новый (H.3)**: per-instance heuristic Firestore write-pressure tracker
- `backend/src/services/captureBatchBuffer.ts` — **новый (H.3)**: буферизация и батчевый flush conversation-событий
- `backend/src/config/env.ts` — **изменён (H.3)**: добавлены `QUOTA_WINDOW_MS`, `QUOTA_AGGRESSIVE_THRESHOLD_OPS`, `QUOTA_DEFERRED_THRESHOLD_OPS`
- `backend/src/services/summarizationService.ts` — **изменён (H.3)**: `pickCompressionLevel()` учитывает `QuotaMode`
- `backend/src/routes/capture.ts` — **изменён (H.3)**: интеграция governor + batch buffer + адаптивная частота суммаризации
- Остальные файлы — без изменений в этом подшаге, соответствуют состоянию после H.0/H.1/H.2

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
│   │   │   ├── captureBatchBuffer.ts
│   │   │   ├── deadLetterService.ts
│   │   │   ├── githubAppAuth.ts
│   │   │   ├── githubBranchService.ts
│   │   │   ├── githubMergeService.ts
│   │   │   ├── quotaGovernor.ts
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