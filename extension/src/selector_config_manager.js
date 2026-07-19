(function (global) {
  "use strict";

  const STORAGE_KEY_CURRENT = "pnb_selector_config_current";
  const STORAGE_KEY_LAST_GOOD = "pnb_selector_config_last_known_good";
  const DEFAULT_CONFIG_PATH = "src/config/selector-config.default.json";

  const REQUIRED_SELECTOR_KEYS = [
    "chat_container",
    "message_blocks",
    "user_input_textarea",
    "send_button",
    "model_picker",
    "captcha_indicators",
    "push_command_markers",
    "qa_status_markers",
  ];

  function isValidSelectorConfig(config) {
    if (!config || typeof config !== "object") return false;
    if (typeof config.version !== "string") return false;
    if (!config.selectors || typeof config.selectors !== "object") return false;

    for (const key of REQUIRED_SELECTOR_KEYS) {
      const entries = config.selectors[key];
      if (!Array.isArray(entries) || entries.length === 0) return false;
      for (const entry of entries) {
        if (!entry || typeof entry.value !== "string" || typeof entry.priority !== "number") {
          return false;
        }
        if (!["css", "xpath", "text", "regex"].includes(entry.type)) return false;
      }
    }
    return true;
  }

  class SelectorConfigManager {
    constructor() {
      this.current = null;
    }

    async _loadBundledDefault() {
      const url = chrome.runtime.getURL(DEFAULT_CONFIG_PATH);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load bundled default selector config: HTTP ${response.status}`);
      }
      return response.json();
    }

    async _storageGet(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => resolve(result[key]));
      });
    }

    async _storageSet(key, value) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }

    async init() {
      const cached = await this._storageGet(STORAGE_KEY_CURRENT);
      if (cached && isValidSelectorConfig(cached)) {
        this.current = cached;
        return this.current;
      }

      const bundled = await this._loadBundledDefault();
      if (!isValidSelectorConfig(bundled)) {
        throw new Error("Bundled default selector config failed validation - this is a packaging bug, not a runtime/network issue");
      }

      this.current = bundled;
      await this._storageSet(STORAGE_KEY_CURRENT, bundled);
      await this._storageSet(STORAGE_KEY_LAST_GOOD, bundled);
      return this.current;
    }

    getCurrent() {
      return this.current;
    }

    async applyRemoteConfig(newConfig) {
      if (!isValidSelectorConfig(newConfig)) {
        const lastGood = await this._storageGet(STORAGE_KEY_LAST_GOOD);
        this.current = lastGood || this.current;
        return {
          accepted: false,
          rolledBack: true,
          reason: "structural_validation_failed",
        };
      }

      this.current = newConfig;
      await this._storageSet(STORAGE_KEY_CURRENT, newConfig);
      await this._storageSet(STORAGE_KEY_LAST_GOOD, newConfig);
      return { accepted: true, rolledBack: false };
    }

    async fetchRemoteConfig(endpointUrl, idToken) {
      const response = await fetch(endpointUrl, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) {
        throw new Error(`Remote selector config fetch failed: HTTP ${response.status}`);
      }
      return response.json();
    }
  }

  global.PNB = global.PNB || {};
  global.PNB.SelectorConfigManager = SelectorConfigManager;
  global.PNB.isValidSelectorConfig = isValidSelectorConfig;
})(window);