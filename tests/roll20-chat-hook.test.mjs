import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

async function bundle(path, format = "esm") {
  const { outputFiles } = await build({
    entryPoints: [path], bundle: true, format, platform: "node", write: false,
  });
  return outputFiles[0].text;
}
const hookModuleSource = await bundle("src/extension/roll20-chat-hook.ts");
const { installRoll20ChatHook, ROLL20_CHAT_HOOK_EVENT } = await import(
  `data:text/javascript;base64,${Buffer.from(hookModuleSource).toString("base64")}`
);
const contentSource = await bundle("src/extension/content-script.ts", "iife");
const protocolSource = await bundle("src/protocol.ts");
const protocol = await import(`data:text/javascript;base64,${Buffer.from(protocolSource).toString("base64")}`);
const preferencesSource = await bundle("src/extension/global-preferences.ts");
const { normalizeGlobalPreferences } = await import(`data:text/javascript;base64,${Buffer.from(preferencesSource).toString("base64")}`);

function setup({ enabled = true, missingHandler = false } = {}) {
  const document = new EventTarget();
  document.title = "Campaign | Roll20";
  document.documentElement = {};
  class TextArea extends EventTarget {
    get value() { return this.text ?? ""; }
    set value(value) { this.text = value; }
  }
  const input = new TextArea();
  document.querySelector = () => ({ querySelector: (selector) => selector === "textarea" ? input : { click() {} } });
  const originals = [];
  const original = function (...args) { originals.push({ self: this, args }); return "original-result"; };
  const chat = { incoming: original };
  const page = vm.createContext({
    window: missingHandler ? {} : { currentPlayer: { d20: { textchat: chat } } },
    document, CustomEvent, console: { warn() {} },
  });
  // executeScript serializes the function; test it with no module closure.
  const install = (buildId = "test-build") => vm.runInContext(
    `(${installRoll20ChatHook.toString()})(${JSON.stringify(ROLL20_CHAT_HOOK_EVENT)}, ${JSON.stringify(buildId)})`, page,
  );
  const sent = [];
  let listener;
  let observer;
  const runtime = {
    id: "extension",
    onMessage: { addListener: (fn) => { listener = fn; } },
    sendMessage: (message) => { sent.push(message); return Promise.resolve(); },
  };
  const isolated = vm.createContext({
    __GMTOOLS_BUILD_ID__: "test-build", __GMTOOLS_EXTENSION_VERSION__: "0.1.0",
    __GMTOOLS_BROWSER_NAME__: "Chrome", __GMTOOLS_FEEDBACK_SUBMISSION_URL__: undefined,
    chrome: { runtime }, document, Event, CustomEvent, HTMLTextAreaElement: TextArea,
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    Node: { ELEMENT_NODE: 1 }, setTimeout: () => 1,
  });
  vm.runInContext(contentSource, isolated);
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  const send = (silence = enabled) => {
    // Read the compiled build defaults from the content script acknowledgement.
    let ack;
    listener({
      type: protocol.ROLL20_EXECUTE_REQUEST_TYPE, kind: "identify", code: "",
      requestId, issuedAt: Date.now(), expiresAt: Date.now() + 30_000,
      extensionVersion: "invalid", buildId: "invalid", protocolVersion: 2,
    }, {}, (value) => { ack = value; });
    listener({
      type: protocol.ROLL20_EXECUTE_REQUEST_TYPE, kind: "execute", code: "return 5;",
      expectedCampaignId: "campaign-1", requestId, issuedAt: Date.now(), expiresAt: Date.now() + 30_000,
      extensionVersion: ack.extensionVersion, buildId: ack.buildId, protocolVersion: 2,
      silenceChatNotifications: silence,
    }, {}, (value) => { ack = value; });
    assert.equal(ack.ok, true);
  };
  send();
  const content = protocol.formatRoll20ExecuteResponse(requestId, "campaign-1", { ok: true, result: 5 });
  const message = { playerid: "API", type: "whisper", content };
  const observe = (text = content) => {
    let removed = false;
    const node = {
      nodeType: 1, textContent: text,
      closest: () => node, matches: () => true, querySelectorAll: () => [],
      remove: () => { removed = true; },
    };
    observer([{ addedNodes: [node] }]);
    return removed;
  };
  return { install, chat, original, originals, sent, runtime, send, message, document, observe, requestId, input };
}

test("direct sending preserves drafts, skips history, and registers replies before sending", () => {
  const h = setup(); h.install(); h.install();
  h.input.value = "GM draft";
  let calls = 0;
  h.chat.rawChatInput = (message) => {
    calls++;
    assert.equal(message.type, "api");
    assert.equal(message.actionId, "no-store");
    assert.equal(protocol.parseRoll20ExecuteCommand(message.content).code, "return 5;");
    h.chat.incoming(true, h.message);
  };
  h.document.querySelector = () => { throw new Error("Composer must not be accessed"); };
  h.send();
  assert.equal(calls, 1);
  assert.equal(h.input.value, "GM draft");
  assert.equal(h.sent.length, 1);
});

test("disabled direct sending uses composer even with installed hook", () => {
  const h = setup(); h.install();
  h.chat.rawChatInput = () => assert.fail("Direct sending is disabled");
  h.send(false);
  assert.match(h.input.value, /^!gmtools-exec /);
});

test("missing sender falls back, but an invoked sender throwing never resends", () => {
  const h = setup(); h.install();
  h.send();
  assert.match(h.input.value, /^!gmtools-exec /);
  h.input.value = "untouched";
  let calls = 0;
  h.chat.rawChatInput = () => { calls++; throw new Error("Possibly sent"); };
  h.send();
  assert.equal(calls, 1);
  assert.equal(h.input.value, "untouched");
});

test("silencing is opt-in and normalized strictly", () => {
  for (const value of [undefined, null, false, "true", 1]) {
    assert.equal(normalizeGlobalPreferences({ silenceRoll20ChatNotifications: value }).silenceRoll20ChatNotifications, false);
  }
  assert.equal(normalizeGlobalPreferences({ silenceRoll20ChatNotifications: true }).silenceRoll20ChatNotifications, true);
});

test("intercepts expected API replies before rendering and forwards once", () => {
  const h = setup();
  assert.equal(h.install(), true);
  h.chat.incoming(true, h.message);
  h.chat.incoming(true, h.message);
  assert.equal(h.originals.length, 0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].outcome.result, 5);
  // An alternate rendering path must not double-deliver the same response.
  assert.equal(h.observe(), true);
  assert.equal(h.sent.length, 1);
});

test("acknowledgements retain page title and allow the following result", () => {
  const h = setup(); h.install();
  h.chat.incoming(true, { ...h.message, content: protocol.formatRoll20Acknowledgement(h.requestId, "campaign-1", true, true) });
  h.chat.incoming(true, h.message);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].type, protocol.ROLL20_ACKNOWLEDGEMENT_TYPE);
  assert.equal(h.sent[0].pageTitle, "Campaign | Roll20");
  assert.equal(h.originals.length, 0);
});

test("ordinary messages, other API output, and unmatched or malformed responses pass unchanged", () => {
  const h = setup(); h.install();
  const messages = [
    { ...h.message, playerid: "player-1" },
    { ...h.message, type: "rollresult" },
    { ...h.message, content: "ordinary API output" },
    { ...h.message, content: "GMTOOLS_EXECUTION_RESPONSE:invalid:bad" },
    { ...h.message, content: protocol.formatRoll20ExecuteResponse("deadbeef-1234", "campaign-1", { ok: true, result: 7 }) },
    null,
  ];
  for (const message of messages) {
    assert.equal(h.chat.incoming(true, message, 3, 4), "original-result");
    const last = h.originals.at(-1);
    assert.equal(last.self, h.chat);
    assert.equal(last.args[1], message);
    assert.deepEqual(last.args.slice(2), [3, 4]);
  }
  assert.equal(h.sent.length, 0);
});

test("disabled preference leaves the DOM observer as fallback", () => {
  const h = setup({ enabled: false }); h.install();
  h.chat.incoming(true, h.message);
  assert.equal(h.originals.length, 1);
  assert.equal(h.sent.length, 0);
  assert.equal(h.observe(), true);
  assert.equal(h.sent.length, 1);
});

test("preference changes take effect on the next dispatch without reload", () => {
  const h = setup(); h.install();
  h.send(false); h.chat.incoming(true, h.message);
  assert.equal(h.originals.length, 1);
  h.send(true); h.chat.incoming(true, h.message);
  assert.equal(h.originals.length, 1);
  assert.equal(h.sent.length, 1);
});

test("missing page API falls back to the DOM observer", () => {
  const h = setup({ missingHandler: true });
  assert.equal(h.install(), false);
  assert.equal(h.observe(), true);
  assert.equal(h.sent.length, 1);
});

test("stale contexts cannot swallow replies", () => {
  const h = setup(); h.install();
  Object.defineProperty(h.runtime, "id", { get() { throw new Error("Extension context invalidated"); } });
  assert.equal(h.chat.incoming(true, h.message), "original-result");
  assert.equal(h.sent.length, 0);
  assert.equal(h.observe(), false);
});

test("missing content listener and repeated installation leave normal chat intact", () => {
  const h = setup();
  h.install(); const first = h.chat.incoming;
  h.install(); assert.equal(h.chat.incoming, first);
  h.install("new-build"); assert.notEqual(h.chat.incoming, first);
  h.runtime.id = undefined;
  assert.equal(h.chat.incoming(true, h.message), "original-result");
  assert.equal(h.originals.length, 1);
});
