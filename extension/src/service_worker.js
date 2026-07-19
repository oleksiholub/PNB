const KNOWN_MESSAGE_TYPES = new Set([
  "PNB_PAGE_READY",
  "PNB_MODEL_RESPONSE_DETECTED",
  "PNB_CODE_ARTIFACT_DETECTED",
  "PNB_PUSH_COMMAND_DETECTED",
  "PNB_CAPTCHA_DETECTED",
  "PNB_TEXTAREA_STATUS",
  "PNB_SELECTOR_CONFIG_LOADED",
  "PNB_SELECTOR_CONFIG_INIT_FAILED",
]);

chrome.runtime.onInstalled.addListener(() => {
  console.log("[PNB] service worker installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== "pnb_content_script") {
    return;
  }

  if (!KNOWN_MESSAGE_TYPES.has(message.type)) {
    console.warn("[PNB] unrecognized message type:", message.type);
    sendResponse({ acknowledged: false, reason: "unrecognized_type" });
    return true;
  }

  switch (message.type) {
    case "PNB_PAGE_READY":
      console.log("[PNB] page ready:", message.payload);
      break;
    case "PNB_MODEL_RESPONSE_DETECTED":
      console.log("[PNB] model response detected:", message.payload);
      break;
    case "PNB_CODE_ARTIFACT_DETECTED":
      console.log("[PNB] code artifact detected:", message.payload);
      break;
    case "PNB_PUSH_COMMAND_DETECTED":
      console.log("[PNB] push command detected:", message.payload);
      break;
    case "PNB_CAPTCHA_DETECTED":
      console.warn(
        "[PNB] CAPTCHA/verification indicator detected - Passive Logging mode transition is implemented in Sub-step D.4",
        message.payload
      );
      break;
    case "PNB_TEXTAREA_STATUS":
      console.log("[PNB] textarea status:", message.payload);
      break;
    case "PNB_SELECTOR_CONFIG_LOADED":
      console.log("[PNB] selector config loaded, version:", message.payload?.version);
      break;
    case "PNB_SELECTOR_CONFIG_INIT_FAILED":
      console.error("[PNB] CRITICAL: selector config init failed:", message.payload);
      break;
    default:
      break;
  }

  sendResponse({ acknowledged: true });
  return true;
});