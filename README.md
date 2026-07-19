# PNB (Perplexity Neural Bridge)

Реализация по ТЗ `tz-handoff_v4.md`. Данный README отражает состояние
репозитория после завершения Sub-step D.2.

## Статус

- ✅ Итерация A завершена (A.1–A.3): backend-скелет, `POST /capture`,
  сквозная структурированная трассировка.
- ✅ Итерация B завершена (B.1–B.3): Firestore-персистентность,
  Security Rules, interim dead-letter capture.
- ✅ Итерация C завершена (C.1–C.2): Firebase Auth для end-user запросов,
  Google-signed OIDC для service-to-service (пока не подключён).
- ✅ Sub-step D.1: Manifest V3 скелет extension layer (L1).
- ✅ Sub-step D.2: `MutationObserver`-наблюдатель (`dom_observer.js`),
  распознаёт model response блоки, code-артефакты (по `QA Status`
  marker), push-команды оператора, CAPTCHA-индикаторы, наличие textarea.
  Только детекция и логирование — без инъекции, без вызовов к backend.
- GitHub push-пайплайн, selector-config (D.3), полноценная retry-очередь
  с backoff — в следующих итерациях.

## Итог по браузерному риску (пункт 0 текущего цикла)

Критический риск Kiwi Browser с D.1 **снят на архитектурном уровне**: ТЗ
изначально параметризует `browser_family` и не привязано к единственному
браузеру (разделы 3.1, 10 ТЗ). Обнаружен и зафиксирован **уточнённый
риск уровня реализации**: Helium Browser поддерживает только Manifest
V2, тогда как расширение реализовано на MV3 — Helium практически
исключён как целевой браузер без отдельной MV2-сборки. Lemur Browser
остаётся активно поддерживаемым MV3-совместимым кандидатом и
рекомендован как наиболее устойчивый выбор для bootstrap (раздел 6, шаг
12 ТЗ). Итоговый выбор браузера — решение оператора, не Development
Thread.

## Самокоррекция на D.2 (не скрыта)

При реализации `dom_observer.js` первая версия использовала синтаксис ES
`import`/`export`, что **несовместимо** с content scripts, объявленными
через `content_scripts[].js` в `manifest.json` — они выполняются в
"изолированном мире" без поддержки модулей (в отличие от background
service worker с `type: "module"`). Ошибка была обнаружена и исправлена
до вывода финальной версии: используется паттерн общего namespace
`window.PNB`, а `dom_observer.js` подключён в manifest **перед**
`content_script.js`, поскольку content scripts из одного entry делят
общий global scope.

## Структура проекта

- `extension/manifest.json` — Manifest V3 конфигурация (D.1, D.2).
- `extension/src/dom_observer.js` — `MutationObserver`, распознавание
  артефактов/команд/CAPTCHA (D.2).
- `extension/src/content_script.js` — подключает observer, транслирует
  события service worker'у (D.1, обновлён в D.2).
- `extension/src/service_worker.js` — маршрутизация сообщений (D.1,
  обновлён в D.2).
- `extension/README_extension.md` — детали, риски, самокоррекции L1-слоя.
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
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   ├── firestore.ts
│   │   │   └── region.ts
│   │   ├── middleware/
│   │   │   ├── firebaseAuth.ts
│   │   │   ├── requestContext.ts
│   │   │   └── serviceAuth.ts
│   │   ├── models/
│   │   │   ├── collections.ts
│   │   │   └── types.ts
│   │   ├── routes/
│   │   │   └── capture.ts
│   │   ├── schemas/
│   │   │   └── capture.ts
│   │   ├── services/
│   │   │   └── deadLetterService.ts
│   │   ├── types/
│   │   │   └── logging.ts
│   │   ├── utils/
│   │   │   ├── hash.ts
│   │   │   └── ids.ts
│   │   ├── index.ts
│   │   └── logger.ts
│   ├── .dockerignore
│   ├── .env.example
│   ├── .gitignore
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   └── architecture-notes.md
├── extension/
│   ├── icons/
│   ├── src/
│   │   ├── content_script.js
│   │   ├── dom_observer.js
│   │   └── service_worker.js
│   ├── README_extension.md
│   └── manifest.json
├── README.md
├── firebase.json
├── firestore.indexes.json
└── firestore.rules
```