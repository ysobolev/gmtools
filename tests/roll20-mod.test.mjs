import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

async function loadMod() {
  const handlers = new Map();
  const sentMessages = [];
  const logs = [];
  const sandbox = {
    Function: undefined,
    state: {},
    log(message) {
      logs.push(message);
    },
    on(event, callback) {
      handlers.set(event, callback);
    },
    playerIsGM(playerId) {
      return playerId === "gm";
    },
    randomInteger(maximum) {
      assert.equal(maximum, 20);
      return 17;
    },
    sendChat(...args) {
      sentMessages.push(args);
    },
  };

  const source = await readFile("roll20-mod/GMToolsPoc.js", "utf8");
  vm.runInNewContext(source, sandbox);
  handlers.get("ready")();
  return { handlers, logs, sentMessages, state: sandbox.state };
}

function executeMessage(code, campaignId, playerid = "gm", kind = "execute") {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  return {
    requestId,
    message: {
      type: "api",
      content: protocol.formatRoll20ExecuteCommand(requestId, code, {
        kind,
        ...(kind === "execute" ? { expectedCampaignId: campaignId } : {}),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 10_000,
      }),
      playerid,
      who: playerid === "gm" ? "GM (GM)" : "Player",
    },
  };
}

function readAcknowledgement(sentMessage) {
  const [speakingAs, message, callback, options] = sentMessage;
  assert.equal(speakingAs, "GM Tools");
  assert.equal(callback, null);
  assert.equal(options.noarchive, true);
  return protocol.parseRoll20AcknowledgementText(message);
}

function readOutcome(sentMessage) {
  const [speakingAs, message, callback, options] = sentMessage;
  assert.equal(speakingAs, "GM Tools");
  assert.equal(callback, null);
  assert.equal(options.noarchive, true);
  return protocol.parseRoll20ExecuteResponseText(message)?.outcome;
}

test("the Mod script executes GM code and returns its result privately", async () => {
  const { handlers, logs, sentMessages, state } = await loadMod();
  const { message, requestId } = executeMessage(
    'return { roll: randomInteger(20), text: "Café 🐉" };',
    state.GMTools.campaignId,
  );
  handlers.get("chat:message")(message);

  assert.equal(sentMessages.length, 2);
  assert.equal(readAcknowledgement(sentMessages[0]).accepted, true);
  assert.deepEqual(readOutcome(sentMessages[1]), {
    ok: true,
    result: { roll: 17, text: "Café 🐉" },
  });
  assert.deepEqual(logs, [
    "GM Tools execution bridge 0.2.0 (protocol 2) ready",
    `GM Tools command received: ${requestId} (execute, protocol 2)`,
    `GM Tools acknowledgement submitted: ${requestId} (accepted)`,
    `GM Tools execution completed: ${requestId} (success)`,
    `GM Tools response submitted: ${requestId}`,
  ]);
});

test("the Mod script rejects incompatible protocol versions", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage("return 1;", state.GMTools.campaignId);
  message.content = message.content.replace("!gmtools-exec 2 ", "!gmtools-exec 3 ");
  handlers.get("chat:message")(message);

  const acknowledgement = readAcknowledgement(sentMessages[0]);
  assert.equal(acknowledgement.accepted, false);
  assert.equal(acknowledgement.error.name, "ProtocolVersionError");
  assert.match(acknowledgement.error.message, /protocol 3/);
});

test("the Mod script awaits promises returned by executed code", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage('return Promise.resolve({ value: "later" });', state.GMTools.campaignId);
  handlers.get("chat:message")(message);
  await Promise.resolve();

  assert.deepEqual(readOutcome(sentMessages[1]), {
    ok: true,
    result: { value: "later" },
  });
});

test("the Mod script returns execution errors", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage('throw new TypeError("broken token");', state.GMTools.campaignId);
  handlers.get("chat:message")(message);

  const outcome = readOutcome(sentMessages[1]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.name, "TypeError");
  assert.equal(outcome.error.message, "broken token");
});

test("the Mod script reports results that cannot survive JSON transport", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage("return function unavailable() {}; ", state.GMTools.campaignId);
  handlers.get("chat:message")(message);

  const outcome = readOutcome(sentMessages[1]);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error.message, /JSON-serializable/);
});

test("the Mod script rejects non-GM requests", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage("return 1;", state.GMTools.campaignId, "player");
  handlers.get("chat:message")(message);
  assert.equal(sentMessages.length, 1);
  const acknowledgement = readAcknowledgement(sentMessages[0]);
  assert.equal(acknowledgement.accepted, false);
  assert.equal(acknowledgement.isGM, false);
  assert.equal(acknowledgement.error.name, "GMAccessRequiredError");
});

test("the Mod script identifies its campaign without executing code", async () => {
  const { handlers, sentMessages, state } = await loadMod();
  const { message } = executeMessage("", state.GMTools.campaignId, "gm", "identify");
  handlers.get("chat:message")(message);
  assert.equal(sentMessages.length, 1);
  const acknowledgement = readAcknowledgement(sentMessages[0]);
  assert.equal(acknowledgement.accepted, true);
  assert.equal(acknowledgement.campaignId, state.GMTools.campaignId);
});

test("the Mod script rejects commands bound to another campaign", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage("return 5;", "campaign-somewhere-else");
  handlers.get("chat:message")(message);
  assert.equal(sentMessages.length, 1);
  const acknowledgement = readAcknowledgement(sentMessages[0]);
  assert.equal(acknowledgement.accepted, false);
  assert.equal(acknowledgement.error.name, "CampaignMismatchError");
});
