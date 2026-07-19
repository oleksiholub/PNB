# PNB Extension Layer (L1) - D.1 Skeleton + D.2 DOM Observer

## Пункт 0: доработка D.1 по итогам браузерного анализа

Код `manifest.json` (Manifest V3) **не требует изменений** — ТЗ явно фиксирует
Chrome Extension API Manifest V3 как часть обязательного технологического
стека (раздел 1 ТЗ), а выбор конкретного Android-браузера параметризован
через `browser_family` и "фиксируется в конфигурации внедрения" (раздел 3.1
ТЗ), а не хардкодится в коде расширения. Поэтому единственная необходимая
правка — документационная, не кодовая:

**Уточнённое ограничение (зафиксировано, не скрыто):** Helium Browser
поддерживает только Manifest V2 и не совместим с текущим MV3-расширением
без отдельной MV2-сборки — это выводит Helium из числа практически
пригодных целевых браузеров для данной реализации, если только оператор
не запросит отдельно параллельную MV2-сборку (не входит в текущий scope
ТЗ). Kiwi Browser и Lemur Browser остаются MV3-совместимыми кандидатами;
Kiwi при этом не обновляется с января 2025 года, что делает **Lemur
Browser** наиболее устойчивым текущим выбором для bootstrap-процедуры
(раздел 6, шаг 12 ТЗ). Итоговый выбор браузера остаётся решением оператора
на этапе bootstrap, а не Development Thread.

## Sub-step D.2: DOM Observer и распознавание артефактов/команд

- `src/dom_observer.js` — `MutationObserver` над `document.body`,
  распознаёт появление новых блоков сообщений, textarea, send button,
  model picker, CAPTCHA-индикаторы, code-артефакты (по `QA Status` regex
  из раздела 3.1.1 ТЗ) и push-команды оператора ("запушь", "commit").
- Использует **временный локальный набор селекторов** (`DEFAULT_SELECTORS`)
  как placeholder, изоморфный схеме selector-config из раздела 3.1.1 ТЗ.
  Это осознанное forward-provisioning решение (по аналогии с
  `dead_letter` в B.1/B.3 и `serviceAuth.ts` в C.2): реальная
  remote-конфигурация с fallback-приоритетами и rollback подключается
  только в D.3, чтобы не проектировать формат конфигурации дважды.
- `content_script.js` подключает observer и транслирует найденные события
  service worker'у через новые типы сообщений: `PNB_MODEL_RESPONSE_DETECTED`,
  `PNB_CODE_ARTIFACT_DETECTED`, `PNB_PUSH_COMMAND_DETECTED`,
  `PNB_CAPTCHA_DETECTED`.
- `service_worker.js` расширен обработкой новых типов сообщений, но **не
  выполняет** сетевые вызовы к backend — отправка в `/capture` требует
  Firebase ID token, что реализуется в D.5 (инъекция + auth), не в D.2.
- Обнаружение CAPTCHA в D.2 — только детекция и логирование; формальный
  переход в режим Passive Logging с прекращением активной инъекции —
  предмет Sub-step D.4, поскольку сама инъекция ещё не реализована (D.5).

## Самокоррекция на D.2 (не скрыта)

Первая черновая версия `dom_observer.js` использовала синтаксис ES
`import`/`export`, что **несовместимо** с content scripts, объявленными
через `content_scripts[].js` в `manifest.json` — они выполняются в
"изолированном мире" без поддержки модулей (в отличие от background
service worker с `type: "module"`). Исправлено на паттерн общего
namespace `window.PNB`, а `dom_observer.js` подключён в manifest **перед**
`content_script.js`, поскольку content scripts из одного entry делят
общий global scope.

## Из D.1

- `manifest.json` — Manifest V3 конфигурация.
- Критический риск Kiwi Browser (устаревание) снят на архитектурном уровне
  анализом ТЗ (см. пункт 0 выше и предыдущий ответ по браузерам).