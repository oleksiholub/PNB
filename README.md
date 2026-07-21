# PNB (Perplexity Neural Bridge)

Реализация системы автоматизации кросс-чатного контекста и хендоффа для Perplexity Pro по техническому заданию `tz-handoff_v4.md`. Данный README отражает состояние репозитория после завершения подшагов H.0–H.3.5 и **H.4 (интеграция `QuotaGovernor.recordWrite()` в `push.ts` и `ciCallback.ts`)**.

## Статус

- ✅ Итерации A–G завершены
- ✅ H.0 — 6 ошибок найдено и исправлено при аудите архива
- ✅ H.1 — Cloud Tasks retry queue infrastructure
- ✅ H.2 — полный TZ 3.4 error-handling contract для summarization pipeline (repair-pass + RAW_FALLBACK-on-exception)
- ✅ H.3 — адаптивная суммаризация, батчинг conversation-событий и deferred mode при приближении к квотам Firestore
- ✅ H.3.5 — подключение реальной бизнес-логики в `OPERATION_HANDLERS` + вызов `enqueueRetryTask()` из `capture.ts`
- ✅ **H.4 (новый) — `QuotaGovernor.recordWrite()` подключён в `push.ts` (2 точки записи) и `ciCallback.ts` (2 batch-коммита, с подсчётом по числу документов)**
- ⏳ Итерация I (acceptance testing) и J (production hardening) — впереди

## Sub-step H.4: полнота учёта write-нагрузки

H.3 честно раскрывал, что `QuotaGovernor` видел только записи из `capture.ts`, а `push.ts` и `ciCallback.ts` оставались слепыми зонами. H.4 закрывает оба пробела без изменения бизнес-логики этих файлов — `recordWrite()` вызывается строго после успешного `set()`/`batch.commit()`, никогда не влияя на исход самой операции.

### Что реализовано

- **`push.ts`** — `getQuotaGovernor().recordWrite()` добавлен в двух местах: (1) при отклонении артефакта QA-гейтом (`push_status: REJECTED_BY_QA_GATE`), (2) после успешной записи `push_status: PUSHED_NO_CI`. Путь дедупликации (уже запушенный артефакт на той же ветке) НЕ вызывает `recordWrite()`, так как никакой Firestore-записи там не происходит.
- **`ciCallback.ts`** — оба `batch.commit()` (ветка `CI_FAILED` и ветка `SUCCESS`/merge) теперь инкрементируют `QuotaGovernor` **по одному разу на каждый документ** в батче (`matching.size` итераций), а не один раз на весь batch — это осознанное архитектурное решение, чтобы единица учёта совпадала с тем, как `capture.ts` считает одну Firestore-запись как одну единицу нагрузки, а не занижала реальную write-нагрузку многодокументных батчей.
- **`retryTask.ts` / `captureRetryHandlers.ts` НЕ тронуты в этом подшаге** — они уже вызывают `recordWrite()` с подшага H.3.5; включение их в объём работ H.4 привело бы к путанице формулировки, а не к реальному изменению кода.

## ⚠️ Открытые компромиссы

1. Security TODO (D.5): временное хранение email/password в `chrome.storage.local`.
2. Client-side encryption contract для `GET /context/:chatId` (E.3) — плейсхолдер `unspecified-placeholder`.
3. Token caching policy для GitHub App (F.1) не специфицирована.
4. `handoff_trigger_markers` enforcement scope (F.4) не специфицирован полностью.
5. `REQUIRES_REVIEW` (G.2) — терминальный статус без auto-recovery webhook.
6. Иллюстративные значения backoff (H.1) требуют тюнинга.
7. Repair-pass (H.2) — простой немедленный повтор графа, не отдельная трансформация.
8. QuotaGovernor (H.3) — per-instance, а не project-wide учёт; пороги иллюстративные, не подтверждены нагрузочным тестированием. **С H.4 этот компромисс частично сужен**: пробел был именно в неполном охвате Firestore-путей внутри одного инстанса — это устранено, но фундаментальное ограничение per-instance/scale-to-zero остаётся неизменным и не решается H.4.
9. Батчинг (H.3) — trade-off консистентности: буферизованная запись невидима для `GET /context/:chatId` до флуша; повторный capture для того же `chat_id` внутри окна батча перезатирает буферизованную запись.
10. `push` и `ci_callback` НЕ подключены к retry-очереди (H.3.5) — продолжают писать напрямую в `dead_letter` при ошибке, минуя `enqueueRetryTask()`. **H.4 не устраняет этот пробел** — H.4 касается только `QuotaGovernor`, а не retry-маршрутизации.
11. Идемпотентность retry реплик (H.3.5) — heuristic на основе последнего элемента `raw_history_refs`, а не гарантия.
12. **Закрыто H.4**: ~~`QuotaGovernor.recordWrite()` всё ещё не вызывается из `push.ts`/`ciCallback.ts`~~ — теперь вызывается из обоих файлов.
13. **Новый (H.4)**: подсчёт `recordWrite()` "по документу" в `ciCallback.ts` — это единственная разумная трактовка при отсутствии в ТЗ явного указания, считать ли batch как одну операцию или как N операций; альтернативная трактовка (один вызов на весь batch) недооценила бы реальную write-нагрузку при масштабных CI-раскатках, затрагивающих много артефактов одной веткой.

## Структура проекта

- `backend/src/routes/push.ts` — **изменён (H.4)**: оба Firestore-write пути инструментированы `recordWrite()`
- `backend/src/routes/ciCallback.ts` — **изменён (H.4)**: оба `batch.commit()` инструментированы `recordWrite()` по числу документов
- Остальные файлы — без изменений в этом подшаге, соответствуют состоянию после H.0–H.3.5

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
│   │   │   ├── captureRetryHandlers.ts
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
│   ├── src/
│   │   ├── auth_manager.js
│   │   ├── config/
│   │   │   └── selector-config.default.json
│   │   ├── content_script.js
│   │   ├── dom_observer.js
│   │   ├── injection_engine.js
│   │   ├── passive_logging_controller.js
│   │   ├── selector_config_manager.js
│   │   └── service_worker.js
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
└── infra/
    ├── create_cloud_build_trigger.sh
    └── create_retry_queue.sh
```