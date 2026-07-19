# PNB Extension Layer (L1) - Sub-step D.1 Skeleton

## Что реализовано

- `manifest.json` — Manifest V3 скелет: `service_worker` в `background`,
  `content_scripts` на `https://www.perplexity.ai/*`, минимальный набор
  permissions (`storage`, `activeTab`, `scripting`).
- `src/content_script.js` — тонкий скелет, сигнализирует о загрузке
  страницы через `PNB_PAGE_READY`. **Не содержит** MutationObserver или
  распознавания артефактов (D.2) и **не читает** selector-config (D.3).
- `src/service_worker.js` — event-driven service worker (не persistent
  background page — обязательное требование MV3), маршрутизирует
  сообщения от content script. **Не выполняет** вызовы к PNB backend.

## Критически важные платформенные оговорки (не скрыты)

1. **MV3 запрещает удалённо исполняемый код** (Chrome for Developers,
   "what-is-mv3") — весь JS должен быть внутри пакета и проходить review
   Web Store. Это **не запрещает** получение удалённых JSON-данных
   (selector-config, D.3) — если они парсятся как данные и никогда не
   выполняются как код. Реализация D.3 обязана строго следовать этому
   разграничению.
2. **Kiwi Browser (целевая Android-платформа с поддержкой расширений)
   прекратил активную разработку в январе 2025 года и не получает
   обновлений безопасности** — это прямо обнаружено поисковым запросом
   при выполнении D.1 и представляет риск для всего проекта: если TZ
   предполагает Kiwi Browser как основную целевую платформу L1-слоя,
   этот факт должен быть либо переоценён Theoretical/Hypothesis Thread,
   либо зафиксирован как принятый риск, а не молча проигнорирован.
   `browser_family: "kiwi"` уже присутствует как опция в
   `ChatContextDocument` (раздел 4 ТЗ, реализовано в B.1) — актуальность
   этого поля прямо зависит от статуса Kiwi Browser.