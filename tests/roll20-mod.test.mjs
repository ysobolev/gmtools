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
  return { handlers, logs, sentMessages };
}

function executeMessage(code, playerid = "gm") {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  return {
    requestId,
    message: {
      type: "api",
      content: protocol.formatRoll20ExecuteCommand(requestId, code),
      playerid,
    },
  };
}

function readOutcome(sentMessage) {
  const [speakingAs, message, callback, options] = sentMessage;
  assert.equal(speakingAs, "GM Tools");
  assert.equal(callback, null);
  assert.equal(options.noarchive, true);
  return protocol.parseRoll20ExecuteResponseText(message)?.outcome;
}

test("the Mod script executes GM code and returns its result privately", async () => {
  const { handlers, logs, sentMessages } = await loadMod();
  const { message, requestId } = executeMessage(
    'return { roll: randomInteger(20), text: "Café 🐉" };',
  );
  handlers.get("chat:message")(message);

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(readOutcome(sentMessages[0]), {
    ok: true,
    result: { roll: 17, text: "Café 🐉" },
  });
  assert.deepEqual(logs, [
    "GM Tools execution bridge 0.1.0 (protocol 1) ready",
    `GM Tools command received: ${requestId} (protocol 1)`,
    `GM Tools execution completed: ${requestId} (success)`,
    `GM Tools response submitted: ${requestId}`,
  ]);
});

test("the Mod script rejects incompatible protocol versions", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage("return 1;");
  message.content = message.content.replace("!gmtools-exec 1 ", "!gmtools-exec 2 ");
  handlers.get("chat:message")(message);

  const outcome = readOutcome(sentMessages[0]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.name, "ProtocolVersionError");
  assert.match(outcome.error.message, /protocol 2/);
});

test("the Mod script awaits promises returned by executed code", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage('return Promise.resolve({ value: "later" });');
  handlers.get("chat:message")(message);
  await Promise.resolve();

  assert.deepEqual(readOutcome(sentMessages[0]), {
    ok: true,
    result: { value: "later" },
  });
});

test("the Mod script returns execution errors", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage('throw new TypeError("broken token");');
  handlers.get("chat:message")(message);

  const outcome = readOutcome(sentMessages[0]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.name, "TypeError");
  assert.equal(outcome.error.message, "broken token");
});

test("the Mod script reports results that cannot survive JSON transport", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage("return function unavailable() {}; ");
  handlers.get("chat:message")(message);

  const outcome = readOutcome(sentMessages[0]);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error.message, /JSON-serializable/);
});

test("the Mod script ignores non-GM requests", async () => {
  const { handlers, sentMessages } = await loadMod();
  const { message } = executeMessage("return 1;", "player");
  handlers.get("chat:message")(message);
  assert.equal(sentMessages.length, 0);
});
