import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadMod() {
  const handlers = new Map();
  const sentMessages = [];
  const sandbox = {
    log() {},
    on(event, callback) {
      handlers.set(event, callback);
    },
    playerIsGM(playerId) {
      return playerId === "gm";
    },
    randomInteger(maximum) {
      assert.equal(maximum, 100);
      return 42;
    },
    sendChat(...args) {
      sentMessages.push(args);
    },
  };

  const source = await readFile("roll20-mod/GMToolsPoc.js", "utf8");
  vm.runInNewContext(source, sandbox);
  handlers.get("ready")();
  return { handlers, sentMessages };
}

test("the Mod script accepts a GM request and returns a private response", async () => {
  const { handlers, sentMessages } = await loadMod();
  handlers.get("chat:message")({
    type: "api",
    content: "!gmtools-poc 12345678-abcd",
    playerid: "gm",
  });

  assert.equal(sentMessages.length, 1);
  const [speakingAs, message, callback, options] = sentMessages[0];
  assert.equal(speakingAs, "GM Tools");
  assert.equal(message, "/w gm GMTOOLS_RESPONSE:12345678-abcd:42");
  assert.equal(callback, null);
  assert.equal(options.noarchive, true);
});

test("the Mod script ignores non-GM requests", async () => {
  const { handlers, sentMessages } = await loadMod();
  handlers.get("chat:message")({
    type: "api",
    content: "!gmtools-poc 12345678-abcd",
    playerid: "player",
  });
  assert.equal(sentMessages.length, 0);
});
