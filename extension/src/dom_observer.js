(function (global) {
  "use strict";

  const DEFAULT_SELECTORS = {
    message_blocks: [{ type: "css", value: "[data-testid='message-block']", priority: 1 }],
    user_input_textarea: [{ type: "css", value: "textarea", priority: 1 }],
    send_button: [{ type: "css", value: "button[type='submit']", priority: 1 }],
    model_picker: [{ type: "css", value: "[data-testid='model-picker']", priority: 1 }],
    captcha_indicators: [
      { type: "text", value: "verify you are human", priority: 1 },
      { type: "text", value: "captcha", priority: 2 },
    ],
    push_command_markers: [
      { type: "text", value: "запушь", priority: 1 },
      { type: "text", value: "commit", priority: 2 },
    ],
    qa_status_markers: [
      { type: "regex", value: "QA Status\\s*:\\s*(PASSED|FAILED|FIXING)", priority: 1 },
    ],
  };

  function resolveCssSelector(selectorEntries) {
    const sorted = [...selectorEntries].sort((a, b) => a.priority - b.priority);
    for (const entry of sorted) {
      if (entry.type !== "css") continue;
      const found = document.querySelector(entry.value);
      if (found) return found;
    }
    return null;
  }

  function textContainsAny(text, entries) {
    const lower = text.toLowerCase();
    for (const entry of entries) {
      if (entry.type === "text" && lower.includes(entry.value.toLowerCase())) {
        return entry.value;
      }
      if (entry.type === "regex") {
        const re = new RegExp(entry.value, "i");
        const match = text.match(re);
        if (match) return match[0];
      }
    }
    return null;
  }

  class PnbDomObserver {
    constructor(selectors, onEvent) {
      this.selectors = selectors || DEFAULT_SELECTORS;
      this.onEvent = onEvent;
      this.observer = null;
      this.seenNodes = new WeakSet();
    }

    start() {
      this.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => this._processNode(node));
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: false,
      });

      this._checkCaptcha();
      this._checkTextarea();
    }

    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }

    _processNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (this.seenNodes.has(node)) return;
      this.seenNodes.add(node);

      const text = node.textContent || "";
      if (!text.trim()) return;

      const qaMatch = textContainsAny(text, this.selectors.qa_status_markers);
      if (qaMatch) {
        this.onEvent({
          type: "PNB_CODE_ARTIFACT_DETECTED",
          payload: { qa_marker: qaMatch, snippet: text.slice(0, 500) },
        });
      }

      const pushMatch = textContainsAny(text, this.selectors.push_command_markers);
      if (pushMatch) {
        this.onEvent({
          type: "PNB_PUSH_COMMAND_DETECTED",
          payload: { marker: pushMatch },
        });
      }

      const captchaMatch = textContainsAny(text, this.selectors.captcha_indicators);
      if (captchaMatch) {
        this.onEvent({
          type: "PNB_CAPTCHA_DETECTED",
          payload: { marker: captchaMatch },
        });
      }

      const messageBlock = resolveCssSelector(this.selectors.message_blocks);
      if (messageBlock && messageBlock.contains(node)) {
        this.onEvent({
          type: "PNB_MODEL_RESPONSE_DETECTED",
          payload: { snippet: text.slice(0, 1000), timestamp: new Date().toISOString() },
        });
      }
    }

    _checkCaptcha() {
      const bodyText = document.body.textContent || "";
      const match = textContainsAny(bodyText, this.selectors.captcha_indicators);
      if (match) {
        this.onEvent({ type: "PNB_CAPTCHA_DETECTED", payload: { marker: match } });
      }
    }

    _checkTextarea() {
      const el = resolveCssSelector(this.selectors.user_input_textarea);
      this.onEvent({
        type: "PNB_TEXTAREA_STATUS",
        payload: { found: !!el },
      });
    }
  }

  global.PNB = global.PNB || {};
  global.PNB.PnbDomObserver = PnbDomObserver;
  global.PNB.DEFAULT_SELECTORS = DEFAULT_SELECTORS;
})(window);