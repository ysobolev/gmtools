// Generated from TypeScript by `npm run build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var RANDOM_REQUEST_TYPE = "GMTOOLS_RANDOM_REQUEST";
  var RANDOM_RESPONSE_TYPE = "GMTOOLS_RANDOM_RESPONSE";
  var RANDOM_COMMAND = "!gmtools-poc";
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  var RESPONSE_PATTERN = /GMTOOLS_RESPONSE\s*:\s*([a-f0-9-]{8,64})\s*:\s*(\d{1,3})/i;
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isValidRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }
  function isRandomRequestMessage(value) {
    return isRecord(value) && value.type === RANDOM_REQUEST_TYPE && isValidRequestId(value.requestId);
  }
  function isRandomResponseMessage(value) {
    return isRecord(value) && value.type === RANDOM_RESPONSE_TYPE && isValidRequestId(value.requestId) && typeof value.value === "number" && Number.isInteger(value.value) && value.value >= 1 && value.value <= 100;
  }
  function formatRandomCommand(requestId) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    return `${RANDOM_COMMAND} ${requestId}`;
  }
  function parseRandomResponseText(content) {
    const match = content.match(RESPONSE_PATTERN);
    if (!match) return null;
    const requestId = match[1];
    const value = Number(match[2]);
    const response = {
      type: RANDOM_RESPONSE_TYPE,
      requestId,
      value
    };
    return isRandomResponseMessage(response) ? response : null;
  }

  // src/extension/content-script.ts
  function findChatControls() {
    const container = document.querySelector("#textchat-input");
    return {
      input: container?.querySelector("textarea") ?? null,
      button: container?.querySelector("button[type='submit']") ?? container?.querySelector("button") ?? container?.querySelector(".btn") ?? null
    };
  }
  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (!setter) {
      throw new Error("Unable to access Roll20's chat input.");
    }
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function sendApiCommand(requestId) {
    const { input, button } = findChatControls();
    if (!input || !button) {
      return { ok: false, error: "Open Roll20's Chat tab and try again." };
    }
    const previousValue = input.value;
    try {
      setNativeValue(input, formatRandomCommand(requestId));
      button.click();
      setTimeout(() => setNativeValue(input, previousValue), 0);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not use Roll20 chat."
      };
    }
  }
  function inspectAddedNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || !element.closest("#textchat, .textchatcontainer")) return;
    const candidates = /* @__PURE__ */ new Set();
    const containingMessage = element.closest(".message");
    if (containingMessage) candidates.add(containingMessage);
    if (element.matches(".message")) candidates.add(element);
    element.querySelectorAll(".message").forEach((message) => candidates.add(message));
    if (candidates.size === 0) candidates.add(element);
    for (const candidate of candidates) {
      const response = parseRandomResponseText(candidate.textContent ?? "");
      if (!response) continue;
      (candidate.closest(".message") ?? candidate).remove();
      void chrome.runtime.sendMessage(response).catch(() => void 0);
    }
  }
  var chatObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(inspectAddedNode);
    }
  });
  chatObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (!isRandomRequestMessage(message)) return;
      sendResponse(sendApiCommand(message.requestId));
    }
  );
})();
