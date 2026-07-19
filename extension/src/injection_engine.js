(function (global) {
  "use strict";

  function setNativeValue(element, value) {
    const descriptorOwn = Object.getOwnPropertyDescriptor(element, "value");
    const prototype = Object.getPrototypeOf(element);
    const descriptorProto = Object.getOwnPropertyDescriptor(prototype, "value");

    const setter =
      descriptorOwn && descriptorOwn.set && descriptorOwn.set !== descriptorProto?.set
        ? descriptorProto?.set
        : descriptorProto?.set || descriptorOwn?.set;

    if (!setter) {
      throw new Error("Could not resolve native value setter for element");
    }
    setter.call(element, value);
  }

  function dispatchInputEvent(element) {
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
  }

  function jitterDelayMs(jitterConfig) {
    const min = jitterConfig?.min ?? 350;
    const max = jitterConfig?.max ?? 1400;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  class InjectionEngine {
    constructor(selectors, jitterConfig) {
      this.selectors = selectors;
      this.jitterConfig = jitterConfig || { min: 350, max: 1400 };
    }

    _resolveElement(selectorEntries) {
      const sorted = [...selectorEntries].sort((a, b) => a.priority - b.priority);
      for (const entry of sorted) {
        if (entry.type !== "css") continue;
        const found = document.querySelector(entry.value);
        if (found) return found;
      }
      return null;
    }

    async injectAndSend(text) {
      await sleep(jitterDelayMs(this.jitterConfig));

      const textarea = this._resolveElement(this.selectors.user_input_textarea);
      if (!textarea) {
        return { success: false, reason: "textarea_not_found" };
      }

      try {
        setNativeValue(textarea, text);
        dispatchInputEvent(textarea);
      } catch (err) {
        return { success: false, reason: `native_setter_failed: ${String(err)}` };
      }

      await sleep(jitterDelayMs(this.jitterConfig));

      const sendButton = this._resolveElement(this.selectors.send_button);
      if (!sendButton) {
        return { success: false, reason: "send_button_not_found" };
      }

      const disabled = sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true";
      if (disabled) {
        return { success: false, reason: "send_button_disabled" };
      }

      sendButton.click();
      return { success: true };
    }
  }

  global.PNB = global.PNB || {};
  global.PNB.InjectionEngine = InjectionEngine;
  global.PNB.setNativeValue = setNativeValue;
})(window);