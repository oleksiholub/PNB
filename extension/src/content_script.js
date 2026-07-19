(function () {
  "use strict";

  const PNB_VERSION = "0.2.0-d2-dom-observer";

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

    if (!window.PNB || !window.PNB.PnbDomObserver) {
      console.error(
        "[PNB] window.PNB.PnbDomObserver is missing - check that dom_observer.js is listed BEFORE content_script.js in manifest.json's content_scripts.js array"
      );
      return;
    }

    const observer = new window.PNB.PnbDomObserver(null, (event) => {
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