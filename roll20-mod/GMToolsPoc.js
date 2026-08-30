// Generated from TypeScript by `pnpm build`. Do not edit directly.
"use strict";
(() => {
  // src/protocol.ts
  var RANDOM_COMMAND = "!gmtools-poc";
  var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
  function isValidRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }
  function parseRandomCommand(content) {
    const parts = content.trim().split(/\s+/);
    const requestId = parts[1];
    return parts.length === 2 && parts[0] === RANDOM_COMMAND && isValidRequestId(requestId) ? requestId : null;
  }
  function formatRandomResponse(requestId, value) {
    if (!isValidRequestId(requestId)) {
      throw new Error("Invalid GM Tools request ID.");
    }
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new Error("Invalid GM Tools random value.");
    }
    return `GMTOOLS_RESPONSE:${requestId}:${value}`;
  }

  // src/roll20-mod/GMToolsPoc.ts
  function handleChatMessage(message) {
    if (message.type !== "api" || !playerIsGM(message.playerid)) return;
    const requestId = parseRandomCommand(message.content);
    if (!requestId) return;
    const value = randomInteger(100);
    const response = formatRandomResponse(requestId, value);
    sendChat("GM Tools", `/w gm ${response}`, null, { noarchive: true });
  }
  on("ready", () => {
    on("chat:message", handleChatMessage);
    log("GM Tools POC ready");
  });
})();
