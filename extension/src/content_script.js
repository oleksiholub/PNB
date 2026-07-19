(function () {
  "use strict";

  const PNB_VERSION = "0.1.0-d1-skeleton";

  function notifyServiceWorker(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload, source: "pnb_content_script" });
    } catch (err) {
      console.error("[PNB] failed to notify service worker:", err);
    }
  }

  function init() {
    console.log(`[PNB] content script loaded (v${PNB_VERSION}) on`, window.location.href);
    notifyServiceWorker("PNB_PAGE_READY", {
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();