(function (global) {
  "use strict";

  const STATES = Object.freeze({
    ACTIVE: "ACTIVE",
    PASSIVE_LOGGING: "PASSIVE_LOGGING",
    BROWSER_INCOMPATIBLE: "BROWSER_INCOMPATIBLE",
  });

  function detectRequiredApiSupport() {
    const missing = [];

    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      missing.push("chrome.runtime.sendMessage");
    }
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      missing.push("chrome.storage.local");
    }
    if (typeof MutationObserver === "undefined") {
      missing.push("MutationObserver");
    }
    if (typeof fetch !== "function") {
      missing.push("fetch");
    }

    return { compatible: missing.length === 0, missing };
  }

  class PassiveLoggingController {
    constructor(onTransition, normalizationCheckFn, pollIntervalMs) {
      this.state = STATES.ACTIVE;
      this.onTransition = onTransition;
      this.normalizationCheckFn = normalizationCheckFn;
      this.pollIntervalMs = pollIntervalMs || 5000;
      this._pollHandle = null;
      this._lastCaptchaMarker = null;
    }

    getState() {
      return this.state;
    }

    shouldAllowActiveInjection() {
      return this.state === STATES.ACTIVE;
    }

    checkBrowserCompatibility() {
      const { compatible, missing } = detectRequiredApiSupport();
      if (!compatible) {
        this._transition(STATES.BROWSER_INCOMPATIBLE, { missing_apis: missing });
      }
      return compatible;
    }

    onCaptchaDetected(marker) {
      if (this.state === STATES.BROWSER_INCOMPATIBLE) return;
      this._lastCaptchaMarker = marker;
      if (this.state !== STATES.PASSIVE_LOGGING) {
        this._transition(STATES.PASSIVE_LOGGING, { trigger: "captcha_detected", marker });
      }
      this._startNormalizationPolling();
    }

    _startNormalizationPolling() {
      if (this._pollHandle) return;
      this._pollHandle = setInterval(() => {
        if (this.state !== STATES.PASSIVE_LOGGING) {
          this._stopNormalizationPolling();
          return;
        }
        const stillPresent = this.normalizationCheckFn ? this.normalizationCheckFn() : true;
        if (!stillPresent) {
          this._transition(STATES.ACTIVE, { trigger: "normalization_confirmed" });
          this._stopNormalizationPolling();
        }
      }, this.pollIntervalMs);
    }

    _stopNormalizationPolling() {
      if (this._pollHandle) {
        clearInterval(this._pollHandle);
        this._pollHandle = null;
      }
    }

    _transition(newState, context) {
      const previousState = this.state;
      this.state = newState;
      if (this.onTransition) {
        this.onTransition({ from: previousState, to: newState, context: context || {} });
      }
    }
  }

  global.PNB = global.PNB || {};
  global.PNB.PassiveLoggingController = PassiveLoggingController;
  global.PNB.PNB_STATES = STATES;
  global.PNB.detectRequiredApiSupport = detectRequiredApiSupport;
})(window);