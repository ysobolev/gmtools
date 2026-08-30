// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var RANDOM_REQUEST_TYPE = "GMTOOLS_RANDOM_REQUEST";
  var RANDOM_RESPONSE_TYPE = "GMTOOLS_RANDOM_RESPONSE";
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isValidRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }
  function isRandomResponseMessage(value) {
    return isRecord(value) && value.type === RANDOM_RESPONSE_TYPE && isValidRequestId(value.requestId) && typeof value.value === "number" && Number.isInteger(value.value) && value.value >= 1 && value.value <= 100;
  }

  // src/extension/sidepanel.ts
  var REQUEST_TIMEOUT_MS = 1e4;
  function requiredElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing side-panel element: ${selector}`);
    return element;
  }
  var requestButton = requiredElement("#request-button");
  var statusElement = requiredElement("#status");
  var numberElement = requiredElement("#number");
  var pendingRequest = null;
  function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
  }
  function finishRequest() {
    if (pendingRequest) clearTimeout(pendingRequest.timeoutId);
    pendingRequest = null;
    requestButton.disabled = false;
  }
  async function getActiveRoll20Tab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://app.roll20.net/editor/")) {
      throw new Error("Open a Roll20 game in the active tab first.");
    }
    return tab;
  }
  async function requestRandomNumber() {
    finishRequest();
    requestButton.disabled = true;
    numberElement.textContent = "";
    setStatus("Contacting the Roll20 sandbox\u2026");
    try {
      const tab = await getActiveRoll20Tab();
      const requestId = crypto.randomUUID();
      const request = {
        requestId,
        tabId: tab.id,
        timeoutId: window.setTimeout(() => {
          if (pendingRequest !== request) return;
          finishRequest();
          setStatus(
            "No response. Check that the Mod script is installed and enabled.",
            true
          );
        }, REQUEST_TIMEOUT_MS)
      };
      pendingRequest = request;
      const message = {
        type: RANDOM_REQUEST_TYPE,
        requestId
      };
      const acknowledgement = await chrome.tabs.sendMessage(
        request.tabId,
        message
      );
      if (!acknowledgement?.ok) {
        throw new Error(acknowledgement?.error ?? "Roll20 chat is not ready.");
      }
      if (pendingRequest === request) {
        setStatus("Waiting for the Mod script\u2026");
      }
    } catch (error) {
      finishRequest();
      setStatus(
        error instanceof Error ? error.message : "Could not send the request.",
        true
      );
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!isRandomResponseMessage(message) || !pendingRequest || message.requestId !== pendingRequest.requestId || sender.tab?.id !== pendingRequest.tabId) {
      return;
    }
    numberElement.textContent = String(message.value);
    finishRequest();
    setStatus("Received privately from Roll20");
  });
  requestButton.addEventListener("click", () => void requestRandomNumber());
})();
