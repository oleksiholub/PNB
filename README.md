# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step D.3.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Итерация B завершена (B.1–B.3): Firestore-персистентность,
  Security Rules, interim dead-letter capture.
- ✅ Итерация C завершена (C.1–C.2): Firebase Auth для end-user запросов,
  Google-signed OIDC для service-to-service (пока не подключён).
- ✅ Sub-step D.1: Manifest V3 скелет extension layer (L1).
- ✅ Sub-step D.2: `MutationObserver`-наблюдатель, распознавание
  артефактов/команд/CAPTCHA.
- ✅ Sub-step D.3: JSON selector-config (`SelectorConfigManager`) с
  структурной валидацией и автоматическим rollback на последнюю
  known-good версию; закрыт контрактный пробел ТЗ — добавлен
  `GET /selector-config/current` на backend'е (ранее в ТЗ был описан
  только `POST /selector-config/refresh`). Полный remote-цикл обновления
  (fetch + Firebase ID token) отложен до D.5.
- GitHub push-пайплайн, полноценная retry-очередь с backoff — в
  следующих итерациях.

## Итог по браузерному риску (зафиксирован на D.1–D.2)

Критический риск Kiwi Browser снят на архитектурном уровне — ТЗ
параметризует `browser_family` (разделы 3.1, 10 ТЗ). Уточнённый риск:
Helium Browser поддерживает только Manifest V2, несовместим с текущим
MV3-расширением. **Lemur Browser** рекомендован как наиболее устойчивый
MV3-совместимый выбор для bootstrap (раздел 6, шаг 12 ТЗ).

## Структура проекта

- `extension/manifest.json` — Manifest V3, `web_accessible_resources`
  добавлен в D.3.
- `extension/src/config/selector-config.default.json` — bundled default
  конфигурация селекторов (D.3).
- `extension/src/selector_config_manager.js` — валидация, кэширование,
  rollback selector-config (D.3).
- `extension/src/dom_observer.js` — `MutationObserver`, принимает
  конфигурацию извне (обновлён в D.3, был хардкод в D.2).
- `extension/src/content_script.js` — инициализация конфигурации перед
  запуском observer'а (обновлён в D.3).
- `extension/src/service_worker.js` — маршрутизация сообщений, включая
  lifecycle selector-config (обновлён в D.3).
- `extension/README_extension.md` — детали, риски, контрактные пробелы
  L1-слоя.
- `backend/src/routes/selectorConfig.ts` — `GET /selector-config/current`,
  закрывает контрактный пробел ТЗ (D.3).
- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Security
  Rules и конфигурация деплоя.
- `backend/src/middleware/firebaseAuth.ts` — верификация Firebase ID token.
- `backend/src/middleware/serviceAuth.ts` — верификация Google-signed OIDC
  identity token (пока не подключён к роутам).
- `backend/src/services/deadLetterService.ts` — interim dead-letter capture.
- `backend/src/routes/capture.ts` — `POST /capture`.
- `backend/src/models/types.ts`, `collections.ts` — Data Model раздела 4 ТЗ.
- `backend/src/config/firestore.ts`, `env.ts`, `region.ts` — конфигурация.
- `backend/src/middleware/requestContext.ts` — сквозной `trace_id`.
- `backend/src/schemas/capture.ts` — zod-схема запроса.
- `backend/src/types/logging.ts` — типизированный словарь полей логирования.
- `backend/src/utils/hash.ts`, `backend/src/utils/ids.ts` — SHA-256, UUID.
- `backend/src/logger.ts` — pino + pino-http, `withLogContext()`.
- `backend/Dockerfile` — multi-stage build, non-root runtime user.

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
│       ├── selector_config_manager.js
│       └── service_worker.js
├── firebase.json
├── firestore.indexes.json
└── firestore.rules
```