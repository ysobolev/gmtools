// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var ROLL20_EXECUTE_REQUEST_TYPE = "GMTOOLS_ROLL20_EXECUTE";
  var ROLL20_EXECUTE_RESPONSE_TYPE = "GMTOOLS_ROLL20_EXECUTE_RESPONSE";
  var ROLL20_ACKNOWLEDGEMENT_TYPE = "GMTOOLS_ROLL20_ACKNOWLEDGEMENT";
  var ROLL20_EXECUTE_COMMAND = "!gmtools-exec";
  var ROLL20_PROTOCOL_VERSION = 2;
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  var RESPONSE_PREFIX = "GMTOOLS_EXECUTION_RESPONSE:";
  var ACKNOWLEDGEMENT_PREFIX = "GMTOOLS_EXECUTION_ACKNOWLEDGED:";
  var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function isRoll20SandboxVersion(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 128;
  }
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
    return isRecord(value) && value.type === ROLL20_EXECUTE_REQUEST_TYPE && isValidRequestId(value.requestId) && (value.kind === "identify" || value.kind === "execute") && typeof value.extensionVersion === "string" && typeof value.buildId === "string" && typeof value.protocolVersion === "number" && typeof value.code === "string" && typeof value.issuedAt === "number" && typeof value.expiresAt === "number" && (value.silenceChatNotifications === void 0 || typeof value.silenceChatNotifications === "boolean") && (value.expectedCampaignId === void 0 || typeof value.expectedCampaignId === "string") && (value.kind === "identify" || value.code.length > 0 && typeof value.expectedCampaignId === "string" && value.expectedCampaignId.length > 0);
  }
  function isRoll20AcknowledgementMessage(value) {
    return isRecord(value) && value.type === ROLL20_ACKNOWLEDGEMENT_TYPE && isValidRequestId(value.requestId) && typeof value.protocolVersion === "number" && typeof value.modVersion === "string" && typeof value.campaignId === "string" && typeof value.isGM === "boolean" && typeof value.accepted === "boolean" && (value.error === void 0 || isExecutionError(value.error)) && (value.pageTitle === void 0 || typeof value.pageTitle === "string") && (value.sandboxVersion === void 0 || isRoll20SandboxVersion(value.sandboxVersion));
  }
  function formatRoll20ExecuteCommand(requestId, code, options = {}) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    const kind = options.kind ?? "execute";
    if (kind === "execute" && !code) throw new Error("Roll20 code cannot be empty.");
    if (kind === "execute" && !options.expectedCampaignId) {
      throw new Error("Roll20 execution requires a campaign ID.");
    }
    const issuedAt = options.issuedAt ?? Date.now();
    const expiresAt = options.expiresAt ?? issuedAt + 15e3;
    const payload = JSON.stringify({
      kind,
      code,
      issuedAt,
      expiresAt,
      ...options.expectedCampaignId ? { expectedCampaignId: options.expectedCampaignId } : {}
    });
    return `${ROLL20_EXECUTE_COMMAND} ${ROLL20_PROTOCOL_VERSION} ${requestId} ${encodeBase64Url(payload)}`;
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
      const envelope = JSON.parse(decoded);
      if (!isRecord(envelope) || typeof envelope.protocolVersion !== "number" || typeof envelope.modVersion !== "string" || typeof envelope.campaignId !== "string" || !isRoll20ExecutionOutcome(envelope.outcome)) {
        return null;
      }
      return {
        type: ROLL20_EXECUTE_RESPONSE_TYPE,
        requestId: match[1],
        protocolVersion: envelope.protocolVersion,
        modVersion: envelope.modVersion,
        campaignId: envelope.campaignId,
        outcome: envelope.outcome
      };
    } catch {
      return null;
    }
  }
  function parseRoll20AcknowledgementText(content) {
    const pattern = new RegExp(
      `${ACKNOWLEDGEMENT_PREFIX}([a-f0-9-]{8,64}):([A-Za-z0-9_-]+)`,
      "i"
    );
    const match = content.match(pattern);
    if (!match) return null;
    const decoded = decodeBase64Url(match[2]);
    if (!decoded) return null;
    try {
      const envelope = JSON.parse(decoded);
      const message = isRecord(envelope) ? {
        type: ROLL20_ACKNOWLEDGEMENT_TYPE,
        requestId: match[1],
        ...envelope
      } : null;
      return isRoll20AcknowledgementMessage(message) ? message : null;
    } catch {
      return null;
    }
  }

  // src/build-info.ts
  var EXTENSION_BUILD_ID = "4aca6a4ce957";
  var EXTENSION_VERSION = "0.1.0";

  // src/extension/roll20-response-tracker.ts
  var RESPONSE_RETENTION_MS = 5 * 60 * 1e3;
  var MAX_PENDING_REQUESTS = 128;
  var Roll20ResponseTracker = class {
    pending = /* @__PURE__ */ new Map();
    register(request, now = Date.now()) {
      this.prune(now);
      this.pending.delete(request.requestId);
      this.pending.set(request.requestId, {
        acknowledged: false,
        kind: request.kind,
        expiresAt: Math.max(request.expiresAt, now) + RESPONSE_RETENTION_MS,
        responded: false,
        settled: false
      });
      while (this.pending.size > MAX_PENDING_REQUESTS) {
        const oldest = this.pending.keys().next().value;
        if (typeof oldest !== "string") break;
        this.pending.delete(oldest);
      }
    }
    forget(requestId) {
      this.pending.delete(requestId);
    }
    has(requestId, now = Date.now()) {
      this.prune(now);
      return this.pending.has(requestId);
    }
    consume(response) {
      const request = this.pending.get(response.requestId);
      if (!request) return false;
      if (response.type === ROLL20_ACKNOWLEDGEMENT_TYPE) {
        if (request.acknowledged || request.settled) return false;
        request.acknowledged = true;
        if (request.kind === "identify" || !response.accepted) {
          request.settled = true;
        } else if (request.responded) {
          request.settled = true;
        }
      } else if (response.type === ROLL20_EXECUTE_RESPONSE_TYPE) {
        if (request.responded || request.settled) return false;
        request.responded = true;
        if (request.acknowledged) request.settled = true;
      }
      return true;
    }
    prune(now) {
      for (const [requestId, request] of this.pending) {
        if (request.expiresAt <= now) this.pending.delete(requestId);
      }
    }
  };

  // src/extension/roll20-chat-hook.ts
  var ROLL20_CHAT_HOOK_EVENT = "gmtools:roll20-chat-response";
  var ROLL20_CHAT_SEND_EVENT = "gmtools:roll20-chat-send";

  // src/extension/content-script.ts
  var pendingRoll20Responses = new Roll20ResponseTracker();
  var silenceChatNotifications = false;
  function acknowledgement(ok, error) {
    return {
      ok,
      ...error ? { error } : {},
      extensionVersion: EXTENSION_VERSION,
      buildId: EXTENSION_BUILD_ID,
      protocolVersion: ROLL20_PROTOCOL_VERSION
    };
  }
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
  function sendApiCommand(request) {
    if (request.extensionVersion !== EXTENSION_VERSION || request.buildId !== EXTENSION_BUILD_ID || request.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
      return acknowledgement(
        false,
        "The Roll20 page is running a different GM Tools build. Reload the page."
      );
    }
    silenceChatNotifications = request.silenceChatNotifications === true;
    const command = formatRoll20ExecuteCommand(request.requestId, request.code, {
      kind: request.kind,
      ...request.expectedCampaignId ? { expectedCampaignId: request.expectedCampaignId } : {},
      issuedAt: request.issuedAt,
      expiresAt: request.expiresAt
    });
    try {
      pendingRoll20Responses.register(request);
      if (silenceChatNotifications) {
        const event = new CustomEvent(ROLL20_CHAT_SEND_EVENT, { detail: command, cancelable: true });
        if (!document.dispatchEvent(event)) return acknowledgement(true);
      }
      const { input, button } = findChatControls();
      if (!input || !button) throw new Error("Open Roll20's Chat tab and try again.");
      const previousValue = input.value;
      setNativeValue(input, command);
      button.click();
      setTimeout(() => setNativeValue(input, previousValue), 0);
      return acknowledgement(true);
    } catch (error) {
      pendingRoll20Responses.forget(request.requestId);
      return acknowledgement(
        false,
        error instanceof Error ? error.message : "Could not use Roll20 chat."
      );
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
      const text = candidate.textContent ?? "";
      const response = parseRoll20AcknowledgementText(text) ?? parseRoll20ExecuteResponseText(text);
      if (!response) continue;
      try {
        if (!chrome.runtime.id) continue;
        if (!pendingRoll20Responses.has(response.requestId)) continue;
        const shouldDeliver = pendingRoll20Responses.consume(response);
        const delivery = shouldDeliver ? chrome.runtime.sendMessage({
          ...response,
          ...response.type === ROLL20_ACKNOWLEDGEMENT_TYPE ? { pageTitle: document.title } : {}
        }) : void 0;
        (candidate.closest(".message") ?? candidate).remove();
        void delivery?.catch(() => void 0);
      } catch {
      }
    }
  }
  var chatObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(inspectAddedNode);
    }
  });
  var contentScriptScope = globalThis;
  if (contentScriptScope.__gmToolsContentScriptBuildId !== EXTENSION_BUILD_ID) {
    contentScriptScope.__gmToolsContentScriptBuildId = EXTENSION_BUILD_ID;
    chatObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    document.addEventListener(ROLL20_CHAT_HOOK_EVENT, (event) => {
      try {
        if (!silenceChatNotifications || !chrome.runtime.id) return;
        const content = event.detail;
        if (typeof content !== "string") return;
        const response = parseRoll20AcknowledgementText(content) ?? parseRoll20ExecuteResponseText(content);
        if (!response || !pendingRoll20Responses.has(response.requestId)) return;
        if (pendingRoll20Responses.consume(response)) {
          void chrome.runtime.sendMessage({
            ...response,
            ...response.type === ROLL20_ACKNOWLEDGEMENT_TYPE ? { pageTitle: document.title } : {}
          }).catch(() => void 0);
        }
        event.preventDefault();
      } catch {
      }
    });
    chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse) => {
        if (!isRoll20ExecuteRequestMessage(message)) return;
        sendResponse(sendApiCommand(message));
      }
    );
  }
})();
