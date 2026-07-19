# PNB Extension Layer (L1) - D.1 Skeleton + D.2 Observer + D.3 Selector Config

## Sub-step D.3: JSON selector-config, remote-обновление + rollback

- `src/config/selector-config.default.json` — bundled default конфигурация,
  реализующая схему раздела 3.1.1 ТЗ (fallback-массивы с {type, value, priority}).
- `src/selector_config_manager.js` — `SelectorConfigManager`:
  - `init()` — загружает последнюю known-good версию из `chrome.storage.local`,
    либо bundled default при первом запуске;
  - `applyRemoteConfig(newConfig)` — структурная валидация новой конфигурации
    перед применением; при провале валидации автоматический rollback на
    последнюю known-good версию + событие `PNB_SELECTOR_CONFIG_INIT_FAILED`
    (severity CRITICAL, раздел 3.4 ТЗ), а не тихое падение;
  - `fetchRemoteConfig(endpointUrl, idToken)` — готовый, но **пока не
    вызываемый автоматически** метод (см. ниже).
- `dom_observer.js` больше не использует хардкод `DEFAULT_SELECTORS` —
  принимает конфигурацию извне через конструктор.
- `content_script.js` инициализирует `SelectorConfigManager` до старта
  observer'а; при провале инициализации observer не стартует вообще
  (fail-safe, не fail-silent).

## КОНТРАКТНЫЙ ПРОБЕЛ, обнаруженный и закрытый на D.3 (не скрыт)

ТЗ (раздел 3.2) описывает только `POST /selector-config/refresh` —
эндпоинт **публикации** новой версии конфигурации. Явного **read-side**
эндпоинта для получения текущей опубликованной версии в тексте ТЗ нет,
хотя Acceptance Criteria 7 ("клиент откатывается на последнюю рабочую
selector-конфигурацию") логически предполагает существование механизма
получения новой версии для последующего rollback при её несовместимости.
Это скрытая двусмысленность контракта, а не выдуманное требование:
`GET /selector-config/current` добавлен backend'ом в этом же под-шаге
(`backend/src/routes/selectorConfig.ts`) именно чтобы закрыть этот
пробел, а не оставить его молча нерешённым до более поздней итерации.

## Почему `fetchRemoteConfig()` пока НЕ вызывается автоматически

Два независимых блокера, оба зафиксированы, а не спрятаны:

1. До этого под-шага не существовало read-side эндпоинта — закрыто выше.
2. Раздел 5 ТЗ требует Firebase ID token для любого клиент↔backend
   запроса, а extension пока не умеет получать такой токен (это
   Sub-step D.5). Поэтому `fetchRemoteConfig()` реализован и готов к
   использованию, но подключается к реальному циклу обновления только в
   D.5, когда обе половины (backend route + auth на клиенте) существуют
   одновременно.

## Из D.2

- `dom_observer.js` — `MutationObserver`, распознавание артефактов/команд/CAPTCHA.
- Самокоррекция: устранена несовместимость ES-модулей с content scripts
  (общий namespace `window.PNB`, порядок файлов в manifest важен —
  теперь порядок: `selector_config_manager.js` → `dom_observer.js` →
  `content_script.js`).

## Из D.1

- `manifest.json` — Manifest V3 конфигурация, `web_accessible_resources`
  добавлен в D.3 для доступа к bundled JSON.
- Критический риск Kiwi Browser снят на архитектурном уровне; уточнённый
  риск — несовместимость Helium Browser с MV3 (см. README.md).