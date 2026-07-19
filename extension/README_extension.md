# PNB Extension Layer (L1) - D.1-D.4

## Sub-step D.4: Passive Logging + BROWSER_INCOMPATIBLE state machine

- `src/passive_logging_controller.js` — `PassiveLoggingController`:
  состояния `ACTIVE -> PASSIVE_LOGGING -> ACTIVE` (нормализация) или
  `-> BROWSER_INCOMPATIBLE` (терминальное, без авто-восстановления),
  строго по разделу 3.1 ТЗ.
  - `checkBrowserCompatibility()` — проверяет наличие
    `chrome.runtime.sendMessage`, `chrome.storage.local`,
    `MutationObserver`, `fetch`; при отсутствии любого API — немедленный
    переход в `BROWSER_INCOMPATIBLE`.
  - `onCaptchaDetected(marker)` — переход в `PASSIVE_LOGGING` +
    запуск polling-проверки нормализации (интервал 5000ms) как
    избыточный safety-net к MutationObserver (CAPTCHA-страница может
    заменить DOM целиком, минуя добавление узлов).
  - `shouldAllowActiveInjection()` — единственный публичный gate,
    который **обязан** вызываться Sub-step D.5 перед любой инъекцией.
- `content_script.js` обновлён: проверка совместимости выполняется
  **первой**, до инициализации selector-config и observer'а; CAPTCHA-
  события из observer'а теперь передаются в controller, а не только
  логируются.
- `service_worker.js` классифицирует переходы по severity (раздел 3.4
  ТЗ): `BROWSER_INCOMPATIBLE` → CRITICAL, `PASSIVE_LOGGING` → WARN.

## ЯВНО ЗАФИКСИРОВАННАЯ НЕЗАВЕРШЁННОСТЬ КОНТРАКТА (не скрыта)

`shouldAllowActiveInjection()` в D.4 вызывается только в **dry-run**
режиме — рядом с местом, где будущий код инъекции D.5 обязан находиться,
но самой инъекции ещё нет. D.4 не может доказать, что D.5 действительно
будет вызывать этот gate, поскольку вызывающий код физически не
существует; это зависимость, зафиксированная явно в комментариях кода,
а не тихо предполагаемая выполненной.

## Разграничение двух категорий несовместимости (не смешаны)

- `BROWSER_INCOMPATIBLE` (D.4) — отсутствие/поломка **платформенных API**
  расширения (раздел 3.1 ТЗ: "ломает API расширения").
- Selector-config rollback (D.3) — несовместимость **DOM-структуры**
  Perplexity с текущими селекторами (раздел 3.4 ТЗ).

Это две разные категории отказа с разными механизмами восстановления —
намеренно не объединены в один статус.

## Из D.3

- `selector_config_manager.js`, `selector-config.default.json` —
  валидация, кэширование, rollback.
- Контрактный пробел ТЗ закрыт: `GET /selector-config/current` на backend'е.

## Из D.2

- `dom_observer.js` — `MutationObserver`, принимает конфигурацию извне.

## Из D.1

- `manifest.json` — Manifest V3. Критический риск Kiwi Browser снят
  архитектурно; уточнённый риск — несовместимость Helium с MV3 (см. README.md).