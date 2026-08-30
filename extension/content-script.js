// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var ROLL20_EXECUTE_REQUEST_TYPE = "GMTOOLS_ROLL20_EXECUTE";
  var ROLL20_EXECUTE_RESPONSE_TYPE = "GMTOOLS_ROLL20_EXECUTE_RESPONSE";
  var ROLL20_EXECUTE_COMMAND = "!gmtools-exec";
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  var RESPONSE_PREFIX = "GMTOOLS_EXECUTION_RESPONSE:";
  var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isValidRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }
  function encodeUtf8(value) {
    const encoded = encodeURIComponent(value);
    const bytes = [];
    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] === "%") {
        bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(encoded.charCodeAt(index));
      }
    }
    return bytes;
  }
  function decodeUtf8(bytes) {
    const encoded = bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");
    return decodeURIComponent(encoded);
  }
  function encodeBase64Url(value) {
    const bytes = encodeUtf8(value);
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index] ?? 0;
      const second = bytes[index + 1] ?? 0;
      const third = bytes[index + 2] ?? 0;
      const combined = first << 16 | second << 8 | third;
      const remaining = bytes.length - index;
      encoded += BASE64URL_ALPHABET[combined >>> 18 & 63];
      encoded += BASE64URL_ALPHABET[combined >>> 12 & 63];
      if (remaining > 1) encoded += BASE64URL_ALPHABET[combined >>> 6 & 63];
      if (remaining > 2) encoded += BASE64URL_ALPHABET[combined & 63];
    }
    return encoded;
  }
  function decodeBase64Url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
    const bytes = [];
    for (let index = 0; index < value.length; index += 4) {
      const first = BASE64URL_ALPHABET.indexOf(value[index] ?? "");
      const second = BASE64URL_ALPHABET.indexOf(value[index + 1] ?? "");
      const thirdCharacter = value[index + 2];
      const fourthCharacter = value[index + 3];
      const third = thirdCharacter ? BASE64URL_ALPHABET.indexOf(thirdCharacter) : 0;
      const fourth = fourthCharacter ? BASE64URL_ALPHABET.indexOf(fourthCharacter) : 0;
      if (first < 0 || second < 0 || third < 0 || fourth < 0) return null;
      const combined = first << 18 | second << 12 | third << 6 | fourth;
      bytes.push(combined >>> 16 & 255);
      if (index + 2 < value.length) bytes.push(combined >>> 8 & 255);
      if (index + 3 < value.length) bytes.push(combined & 255);
    }
    try {
      return decodeUtf8(bytes);
    } catch {
      return null;
    }
  }
  function isExecutionError(value) {
    return isRecord(value) && typeof value.name === "string" && typeof value.message === "string" && (value.stack === void 0 || typeof value.stack === "string");
  }
  function isRoll20ExecutionOutcome(value) {
    return isRecord(value) && (value.ok === true && "result" in value || value.ok === false && isExecutionError(value.error));
  }
  function isRoll20ExecuteRequestMessage(value) {
    return isRecord(value) && value.type === ROLL20_EXECUTE_REQUEST_TYPE && isValidRequestId(value.requestId) && typeof value.code === "string" && value.code.length > 0;
  }
  function formatRoll20ExecuteCommand(requestId, code) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    if (!code) throw new Error("Roll20 code cannot be empty.");
    return `${ROLL20_EXECUTE_COMMAND} ${requestId} ${encodeBase64Url(code)}`;
  }
  function parseRoll20ExecuteResponseText(content) {
    const pattern = new RegExp(
      `${RESPONSE_PREFIX}([a-f0-9-]{8,64}):([A-Za-z0-9_-]+)`,
      "i"
    );
    const match = content.match(pattern);
    if (!match) return null;
    const decoded = decodeBase64Url(match[2]);
    if (!decoded) return null;
    try {
      const outcome = JSON.parse(decoded);
      if (!isRoll20ExecutionOutcome(outcome)) return null;
      return {
        type: ROLL20_EXECUTE_RESPONSE_TYPE,
        requestId: match[1],
        outcome
      };
    } catch {
      return null;
    }
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
  function sendApiCommand(requestId, code) {
    const { input, button } = findChatControls();
    if (!input || !button) {
      return { ok: false, error: "Open Roll20's Chat tab and try again." };
    }
    const previousValue = input.value;
    try {
      setNativeValue(input, formatRoll20ExecuteCommand(requestId, code));
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
      const response = parseRoll20ExecuteResponseText(candidate.textContent ?? "");
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
  var contentScriptScope = globalThis;
  if (!contentScriptScope.__gmToolsContentScriptLoaded) {
    contentScriptScope.__gmToolsContentScriptLoaded = true;
    chatObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse) => {
        if (!isRoll20ExecuteRequestMessage(message)) return;
        sendResponse(sendApiCommand(message.requestId, message.code));
      }
    );
  }
})();
