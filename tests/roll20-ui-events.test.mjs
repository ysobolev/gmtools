import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const events = await bundle("src/extension/roll20-ui-events.ts");
const preferences = await bundle("src/extension/global-preferences.ts");
const activity = await bundle("src/extension/chat-activity.ts");
const persistence = await bundle("src/extension/chat-persistence.ts");

function page() {
  const sent = [];
  const canvas = { focus() {}, getBoundingClientRect: () => ({ left: 20, top: 30, width: 800, height: 600 }), dispatchEvent(event) { sent.push(event); return false; } };
  class SyntheticEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  class Transfer { files = []; items = { add: file => this.files.push(file) }; }
  const context = vm.createContext({ window: {}, document: { getElementById: id => id === "babylonCanvas" ? canvas : null }, KeyboardEvent: SyntheticEvent, DragEvent: SyntheticEvent, DataTransfer: Transfer, File, Uint8Array, atob });
  const send = vm.runInContext(`(${events.sendRoll20UiEvent.toString()})`, context);
  send("document-1");
  return { sent, send, context };
}

test("experimental events require an explicit true preference", () => {
  for (const value of [undefined, false, "true", 1]) assert.equal(preferences.normalizeGlobalPreferences({ experimentalRoll20Events: value }).experimentalRoll20Events, false);
  assert.equal(preferences.normalizeGlobalPreferences({ experimentalRoll20Events: true }).experimentalRoll20Events, true);
});

test("reads each toolbar layer without emitting events, and reports unknown safely", () => {
  const { context, sent } = page();
  const read = vm.runInContext(`(${events.readRoll20CurrentLayer.toString()})`, context);
  for (const [layer, id] of [["token", "tokens"], ["gm", "gm"], ["map", "map"], ["foreground", "foreground"], ["lighting", "lighting"]]) {
    context.document.querySelector = selector => selector === `#${id}-layer-button .icon-selected` ? {} : null;
    const result = read("document-1");
    assert.equal(result.ok, true);
    assert.equal(result.layer, layer);
  }
  context.document.querySelector = () => null;
  assert.equal(read("document-1").layer, "unknown");
  assert.equal(read("document-1").ok, false);
  context.document.querySelector = () => ({});
  assert.equal(read("document-1").layer, "unknown");
  assert.equal(read("stale-document").ok, false);
  assert.equal(sent.length, 0);
});

test("layer reads are not mutation receipts or approval requests", () => {
  assert.equal(events.isRoll20ActionPart("tool-get_current_layer"), false);
  const message = { id: "assistant", role: "assistant", parts: [{ type: "tool-get_current_layer", toolCallId: "read-1", input: {}, state: "output-available", output: { ok: true, layer: "gm" } }] };
  assert.equal(activity.countPendingRoll20Approvals([message]), 0);
  assert.equal(persistence.hasDurableRoll20Result(message), false);
});

test("sends all five Ctrl layer shortcuts from a self-contained content script", () => {
  for (const [layer, key, keyCode] of [["token", "o", 79], ["gm", "k", 75], ["map", "m", 77], ["foreground", ".", 190], ["lighting", ",", 188]]) {
    const { send, sent } = page();
    assert.equal(send("document-1", { tool: "switch_layer", layer }).eventSent, true);
    assert.deepEqual(sent.map(event => event.type), ["keydown", "keyup"]);
    assert.ok(sent.every(event => event.key === key && event.keyCode === keyCode && event.ctrlKey && event.bubbles));
  }
});

test("drops a real file at canvas center, with optional canvas-relative coordinates", async () => {
  for (const coordinates of [{}, { x: null, y: null }, { x: 15, y: 25 }, { x: null, y: 25 }, { x: 15, y: null }]) {
    const { send, sent } = page();
    const result = send("document-1", { tool: "drop_image", imageId: "image-1", ...coordinates }, { base64: btoa("pixels"), filename: "npc.png", mediaType: "image/png" });
    assert.equal(result.eventSent, true);
    assert.deepEqual(sent.map(event => event.type), ["dragenter", "dragover", "drop"]);
    assert.equal(sent[2].clientX, 20 + (coordinates.x ?? 400));
    assert.equal(sent[2].clientY, 30 + (coordinates.y ?? 300));
    assert.equal(sent[2].dataTransfer.effectAllowed, "copy");
    assert.equal(sent[2].dataTransfer.dropEffect, "copy");
    const file = sent[2].dataTransfer.files[0];
    assert.equal(file.name, "npc.png");
    assert.equal(file.type, "image/png");
    assert.equal(await file.text(), "pixels");
  }
});

test("rejects stale documents, unavailable canvases, and out-of-bounds drops without events", () => {
  const { send, sent, context } = page();
  assert.equal(send("different-document", { tool: "switch_layer", layer: "gm" }).ok, false);
  const image = { base64: btoa("pixels"), filename: "npc.png", mediaType: "image/png" };
  for (const x of [-1, 800, Infinity, NaN]) assert.equal(send("document-1", { tool: "drop_image", imageId: "image-1", x }, image).ok, false);
  context.document.getElementById = () => null;
  assert.equal(send("document-1", { tool: "switch_layer", layer: "gm" }).ok, false);
  assert.equal(sent.length, 0);
});

test("UI actions share approval cards, receipts and durable retry protection", () => {
  for (const [type, input] of [["tool-switch_layer", { layer: "gm" }], ["tool-drop_image", { imageId: "image-1" }]]) {
    const message = { id: "assistant", role: "assistant", parts: [{ type, toolCallId: "call-1", input, state: "approval-requested", approval: { id: "approval-1", isAutomatic: false } }] };
    assert.equal(activity.countPendingRoll20Approvals([message]), 1);
    assert.equal(activity.getAssistantContentBlocks(message)[0].approval.detailsLabel, "Review UI action");
    message.parts[0] = { type, toolCallId: "call-1", input, state: "output-available", output: { ok: true, eventSent: true } };
    assert.equal(activity.getRoll20Receipts(message)[0].status, "completed");
    assert.equal(persistence.hasDurableRoll20Result(message), true);
  }
});
