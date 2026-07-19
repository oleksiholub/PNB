(function () {
  "use strict";

  const PNB_VERSION = "0.4.0-d4-passive-logging";

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

    const requiredGlobals = [
      "SelectorConfigManager",
      "PnbDomObserver",
      "PassiveLoggingController",
      "detectRequiredApiSupport",
    ];
    const missingGlobals = requiredGlobals.filter((name) => !window.PNB || !window.PNB[name]);
    if (missingGlobals.length > 0) {
      console.error(
        "[PNB] required globals missing - check manifest.json content_scripts.js load order:",
        missingGlobals
      );
      return;
    }

    const controller = new window.PNB.PassiveLoggingController(
      (transition) => {
        console.log(`[PNB] state transition: ${transition.from} -> ${transition.to}`, transition.context);
        notifyServiceWorker("PNB_STATE_TRANSITION", transition);
      },
      () => {
        const bodyText = document.body.textContent || "";
        return bodyText.toLowerCase().includes("captcha") || bodyText.toLowerCase().includes("verify you are human");
      },
      5000
    );

    const compatible = controller.checkBrowserCompatibility();
    if (!compatible) {
      console.error("[PNB] BROWSER_INCOMPATIBLE - required extension APIs missing, halting active operation");
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
      if (event.type === "PNB_CAPTCHA_DETECTED") {
        controller.onCaptchaDetected(event.payload.marker);
      }
      notifyServiceWorker(event.type, event.payload);

      if (controller.shouldAllowActiveInjection()) {
        // Sub-step D.5 injection logic will run here, gated by the check
        // above. D.4 only logs the gate's decision - no injection exists yet.
      } else {
        console.log("[PNB] active injection suppressed - controller state:", controller.getState());
      }
    });
    observer.start();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();