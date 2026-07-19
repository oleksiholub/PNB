(function () {
  "use strict";

  const PNB_VERSION = "0.3.0-d3-selector-config";

  function notifyServiceWorker(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload, source: "pnb_content_script" });
    } catch (err) {
      console.error("[PNB] failed to notify service worker:", err);
    }
  }

  async function init() {
    console.log(`[PNB] content script loaded (v${PNB_VERSION}) on`, window.location.href);
    notifyServiceWorker("PNB_PAGE_READY", {
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });

    if (!window.PNB || !window.PNB.SelectorConfigManager || !window.PNB.PnbDomObserver) {
      console.error(
        "[PNB] required globals missing - check manifest.json content_scripts.js order: selector_config_manager.js and dom_observer.js must load BEFORE content_script.js"
      );
      return;
    }

    const configManager = new window.PNB.SelectorConfigManager();
    let activeConfig;
    try {
      activeConfig = await configManager.init();
    } catch (err) {
      console.error("[PNB] selector config initialization failed - cannot start DOM observer:", err);
      notifyServiceWorker("PNB_SELECTOR_CONFIG_INIT_FAILED", { message: String(err) });
      return;
    }

    notifyServiceWorker("PNB_SELECTOR_CONFIG_LOADED", { version: activeConfig.version });

    const observer = new window.PNB.PnbDomObserver(activeConfig.selectors, (event) => {
      notifyServiceWorker(event.type, event.payload);
    });
    observer.start();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();