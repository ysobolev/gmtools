// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var ROLL20_EXECUTE_COMMAND = "!gmtools-exec";
  var ROLL20_PROTOCOL_VERSION = 2;
  var ROLL20_MOD_VERSION = "0.2.0";
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  var RESPONSE_PREFIX = "GMTOOLS_EXECUTION_RESPONSE:";
  var ACKNOWLEDGEMENT_PREFIX = "GMTOOLS_EXECUTION_ACKNOWLEDGED:";
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
    var _a, _b, _c;
    const bytes = encodeUtf8(value);
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = (_a = bytes[index]) != null ? _a : 0;
      const second = (_b = bytes[index + 1]) != null ? _b : 0;
      const third = (_c = bytes[index + 2]) != null ? _c : 0;
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
    var _a, _b;
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
    const bytes = [];
    for (let index = 0; index < value.length; index += 4) {
      const first = BASE64URL_ALPHABET.indexOf((_a = value[index]) != null ? _a : "");
      const second = BASE64URL_ALPHABET.indexOf((_b = value[index + 1]) != null ? _b : "");
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
    } catch (e) {
      return null;
    }
  }
  function isExecutionError(value) {
    return isRecord(value) && typeof value.name === "string" && typeof value.message === "string" && (value.stack === void 0 || typeof value.stack === "string");
  }
  function isRoll20ExecutionOutcome(value) {
    return isRecord(value) && (value.ok === true && "result" in value || value.ok === false && isExecutionError(value.error));
  }
  function parseRoll20ExecuteCommand(content) {
    var _a;
    const parts = content.trim().split(/\s+/);
    if (parts.length !== 4 || parts[0] !== ROLL20_EXECUTE_COMMAND || !/^\d+$/.test((_a = parts[1]) != null ? _a : "") || !isValidRequestId(parts[2])) {
      return null;
    }
    const decoded = decodeBase64Url(parts[3]);
    if (!decoded) return null;
    try {
      const payload = JSON.parse(decoded);
      if (!isRecord(payload) || payload.kind !== "identify" && payload.kind !== "execute" || typeof payload.code !== "string" || typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number" || payload.expectedCampaignId !== void 0 && typeof payload.expectedCampaignId !== "string" || payload.kind === "execute" && (!payload.code || typeof payload.expectedCampaignId !== "string" || !payload.expectedCampaignId)) {
        return null;
      }
      return {
        requestId: parts[2],
        protocolVersion: Number.parseInt(parts[1], 10),
        kind: payload.kind,
        code: payload.code,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        ...payload.expectedCampaignId ? { expectedCampaignId: payload.expectedCampaignId } : {}
      };
    } catch (e) {
      return null;
    }
  }
  function formatRoll20ExecuteResponse(requestId, campaignId, outcome) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    const serialized = JSON.stringify({
      protocolVersion: ROLL20_PROTOCOL_VERSION,
      modVersion: ROLL20_MOD_VERSION,
      campaignId,
      outcome
    });
    const roundTripped = JSON.parse(serialized);
    if (!isRecord(roundTripped) || roundTripped.protocolVersion !== ROLL20_PROTOCOL_VERSION || roundTripped.modVersion !== ROLL20_MOD_VERSION || roundTripped.campaignId !== campaignId || !isRoll20ExecutionOutcome(roundTripped.outcome)) {
      throw new Error("The Roll20 result is not JSON-serializable.");
    }
    return `${RESPONSE_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
  }
  function formatRoll20Acknowledgement(requestId, campaignId, isGM, accepted, error) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    const serialized = JSON.stringify({
      protocolVersion: ROLL20_PROTOCOL_VERSION,
      modVersion: ROLL20_MOD_VERSION,
      campaignId,
      isGM,
      accepted,
      ...error ? { error } : {}
    });
    return `${ACKNOWLEDGEMENT_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
  }

  // src/roll20-mod/GMToolsPoc.ts
  function getGMToolsState() {
    const existing = state.GMTools;
    if (typeof existing === "object" && existing !== null && "campaignId" in existing && typeof existing.campaignId === "string") {
      return existing;
    }
    const next = {
      ...typeof existing === "object" && existing !== null ? existing : {},
      campaignId: `campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
    };
    state.GMTools = next;
    return next;
  }
  function errorOutcome(error) {
    if (error instanceof Error) {
      return {
        ok: false,
        error: {
          name: error.name,
          message: error.message,
          ...error.stack ? { stack: error.stack } : {}
        }
      };
    }
    return {
      ok: false,
      error: { name: "Error", message: String(error) }
    };
  }
  function whisperRecipient(message) {
    var _a;
    if (playerIsGM(message.playerid)) return "gm";
    const name = ((_a = message.who) != null ? _a : "").replace(/["\\]/g, "").trim();
    return name ? `"${name}"` : "gm";
  }
  function sendAcknowledgement(message, requestId, accepted, error) {
    const response = formatRoll20Acknowledgement(
      requestId,
      getGMToolsState().campaignId,
      playerIsGM(message.playerid),
      accepted,
      error == null ? void 0 : error.error
    );
    sendChat(
      "GM Tools",
      `/w ${whisperRecipient(message)} ${response}`,
      null,
      { noarchive: true }
    );
    log(
      `GM Tools acknowledgement submitted: ${requestId} (${accepted ? "accepted" : "rejected"})`
    );
  }
  function sendOutcome(message, requestId, outcome) {
    let response;
    try {
      response = formatRoll20ExecuteResponse(
        requestId,
        getGMToolsState().campaignId,
        outcome
      );
    } catch (error) {
      response = formatRoll20ExecuteResponse(
        requestId,
        getGMToolsState().campaignId,
        errorOutcome(error)
      );
    }
    sendChat(
      "GM Tools",
      `/w ${whisperRecipient(message)} ${response}`,
      null,
      { noarchive: true }
    );
    log(`GM Tools response submitted: ${requestId}`);
  }
  function completeExecution(message, requestId, outcome) {
    log(
      `GM Tools execution completed: ${requestId} (${outcome.ok ? "success" : "error"})`
    );
    sendOutcome(message, requestId, outcome);
  }
  function executeCode(message, requestId, code) {
    try {
      const evaluate = eval;
      const result = evaluate(`(async function () {
${code}
})()`);
      if (typeof result === "object" && result !== null && "then" in result && typeof result.then === "function") {
        void Promise.resolve(result).then(
          (value) => completeExecution(message, requestId, {
            ok: true,
            result: value != null ? value : null
          }),
          (error) => completeExecution(message, requestId, errorOutcome(error))
        );
        return;
      }
      completeExecution(message, requestId, {
        ok: true,
        result: result != null ? result : null
      });
    } catch (error) {
      completeExecution(message, requestId, errorOutcome(error));
    }
  }
  function handleChatMessage(message) {
    if (message.type !== "api") return;
    const command = parseRoll20ExecuteCommand(message.content);
    if (!command) return;
    log(
      `GM Tools command received: ${command.requestId} (${command.kind}, protocol ${command.protocolVersion})`
    );
    if (command.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
      sendAcknowledgement(message, command.requestId, false, {
        ok: false,
        error: {
          name: "ProtocolVersionError",
          message: `Unsupported GM Tools protocol ${command.protocolVersion}; this Mod requires protocol ${ROLL20_PROTOCOL_VERSION}.`
        }
      });
      return;
    }
    if (command.expiresAt < Date.now()) {
      sendAcknowledgement(message, command.requestId, false, {
        ok: false,
        error: {
          name: "CommandExpiredError",
          message: "This GM Tools command expired before the sandbox received it."
        }
      });
      return;
    }
    const isGM = playerIsGM(message.playerid);
    if (!isGM) {
      sendAcknowledgement(message, command.requestId, false, {
        ok: false,
        error: {
          name: "GMAccessRequiredError",
          message: "GM Tools Roll20 commands require GM access in this campaign."
        }
      });
      return;
    }
    const campaignId = getGMToolsState().campaignId;
    if (command.kind === "execute" && command.expectedCampaignId !== campaignId) {
      sendAcknowledgement(message, command.requestId, false, {
        ok: false,
        error: {
          name: "CampaignMismatchError",
          message: "This conversation is bound to a different Roll20 campaign."
        }
      });
      return;
    }
    sendAcknowledgement(message, command.requestId, true);
    if (command.kind === "identify") return;
    executeCode(message, command.requestId, command.code);
  }
  on("ready", () => {
    getGMToolsState();
    on("chat:message", handleChatMessage);
    log(
      `GM Tools execution bridge ${ROLL20_MOD_VERSION} (protocol ${ROLL20_PROTOCOL_VERSION}) ready`
    );
  });
})();
