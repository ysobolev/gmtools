// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
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
    const parts = content.trim().split(/\s+/);
    if (parts.length !== 3 || parts[0] !== ROLL20_EXECUTE_COMMAND || !isValidRequestId(parts[1])) {
      return null;
    }
    const code = decodeBase64Url(parts[2]);
    return code ? { requestId: parts[1], code } : null;
  }
  function formatRoll20ExecuteResponse(requestId, outcome) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    const serialized = JSON.stringify(outcome);
    const roundTripped = JSON.parse(serialized);
    if (!isRoll20ExecutionOutcome(roundTripped)) {
      throw new Error("The Roll20 result is not JSON-serializable.");
    }
    return `${RESPONSE_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
  }

  // src/roll20-mod/GMToolsPoc.ts
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
  function sendOutcome(requestId, outcome) {
    let response;
    try {
      response = formatRoll20ExecuteResponse(requestId, outcome);
    } catch (error) {
      response = formatRoll20ExecuteResponse(requestId, errorOutcome(error));
    }
    sendChat("GM Tools", `/w gm ${response}`, null, { noarchive: true });
  }
  function executeCode(requestId, code) {
    try {
      const evaluate = eval;
      const result = evaluate(`(function () {
${code}
})()`);
      if (typeof result === "object" && result !== null && "then" in result && typeof result.then === "function") {
        void Promise.resolve(result).then(
          (value) => sendOutcome(requestId, { ok: true, result: value != null ? value : null }),
          (error) => sendOutcome(requestId, errorOutcome(error))
        );
        return;
      }
      sendOutcome(requestId, { ok: true, result: result != null ? result : null });
    } catch (error) {
      sendOutcome(requestId, errorOutcome(error));
    }
  }
  function handleChatMessage(message) {
    if (message.type !== "api" || !playerIsGM(message.playerid)) return;
    const command = parseRoll20ExecuteCommand(message.content);
    if (!command) return;
    executeCode(command.requestId, command.code);
  }
  on("ready", () => {
    on("chat:message", handleChatMessage);
    log("GM Tools execution bridge ready");
  });
})();
