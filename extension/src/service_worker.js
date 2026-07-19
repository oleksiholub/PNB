chrome.runtime.onInstalled.addListener(() => {
  console.log("[PNB] service worker installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== "pnb_content_script") {
    return;
  }

  switch (message.type) {
    case "PNB_PAGE_READY":
      console.log("[PNB] page ready signal received from content script:", message.payload);
      sendResponse({ acknowledged: true });
      break;
    default:
      console.warn("[PNB] unrecognized message type:", message.type);
      sendResponse({ acknowledged: false, reason: "unrecognized_type" });
  }

  return true;
});