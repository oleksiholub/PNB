# PNB Extension Layer (L1) - D.1-D.5 (ЗАВЕРШЕНА Итерация D)

## Sub-step D.5: инъекция, jitter, Firebase-авторизация, замыкание всех зависимостей

- `src/injection_engine.js` — `InjectionEngine.injectAndSend(text)`:
  использует native value setter (`Object.getOwnPropertyDescriptor` на
  прототипе `HTMLTextAreaElement`) перед `dispatchEvent('input')`, т.к.
  React перехватывает прямую запись в `.value` и игнорирует последующее
  событие без этого обхода (подтверждено официальным issue
  facebook/react#10135 и множественными независимо сходящимися
  community-источниками). Каждый шаг предшествуется randomized jitter
  из `jitter_ms` (D.3) вместо фиксированной задержки.
- `src/auth_manager.js` — `AuthManager`: получение/обновление Firebase
  ID token через Identity Toolkit REST API (`signInWithPassword` +
  `securetoken` refresh), без бандла Firebase Web SDK.
- `content_script.js` обновлён: **впервые реально вызывает**
  `controller.shouldAllowActiveInjection()` перед вызовом
  `injectionEngine.injectAndSend()` — зависимость, оставленная открытой
  в D.4, теперь замкнута.
- `service_worker.js` обновлён: владеет Firebase-сессией, добавляет
  Bearer ID token и пересылает события в `POST /capture` backend'а.

## ЯВНО ЗАФИКСИРОВАННЫЙ КОМПРОМИСС БЕЗОПАСНОСТИ (SECURITY TODO)

ТЗ (раздел 5) требует Firebase ID token для клиент↔backend, но НИГДЕ не
специфицирует, как расширение должно получить учётные данные пользователя
в первую очередь — ни login UI, ни custom-token-эндпоинт не описаны.
Выбранный для D.5 путь — email/password через Identity Toolkit REST API
— **прагматичное временное решение**, а не окончательная архитектура.
Хранение пары email/password в `chrome.storage.local` — это заведомая
уязвимость (данные не шифруются на диске, по документации самого
Chrome), явно помеченная как SECURITY TODO, а не тихо принятая как
приемлемая. **Требуется ревью Security Thread до production rollout.**
Альтернатива из официальной документации Firebase — `firebase/auth/web-extension`
+ Offscreen Document — не выбрана для D.5, поскольку требует бандлинга
Firebase Web SDK (сборочного шага, которого у этого plain-JS расширения
пока нет) и публичной страницы для popup-flow.

## Замкнутые зависимости D.1-D.4

- Gate `shouldAllowActiveInjection()` из D.4 — теперь реально
  используется, не только логируется в dry-run.
- `fetchRemoteConfig()` из D.3 — **остаётся неподключённым**: полный
  remote-цикл (`GET /selector-config/current` + периодическое обновление)
  не входит в D.5, поскольку не было явно запрошено; `AuthManager` из
  D.5 технически предоставляет всё необходимое (`getIdToken()`) для
  такого подключения в будущем под-шаге при необходимости.

## Из D.4

- `passive_logging_controller.js` — state machine ACTIVE/PASSIVE_LOGGING/BROWSER_INCOMPATIBLE.

## Из D.3

- `selector_config_manager.js`, `selector-config.default.json` — валидация, rollback.
- `GET /selector-config/current` на backend'е.

## Из D.2

- `dom_observer.js` — `MutationObserver`.

## Из D.1

- `manifest.json` — Manifest V3. Уточнённый риск: Helium несовместим с MV3;
  **Lemur Browser** рекомендован.