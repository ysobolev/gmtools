import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: ["src/extension/compendium.ts"], bundle: true, format: "esm", platform: "node", write: false });
const { runCompendiumAction } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
function setup(fetch) {
  const calls = [];
  const target = {};
  const item = { attrs: {}, addClass(value) { this.className = value; }, attr(key, value) { this.attrs[key] = value; } };
  const handler = function(event, ui) { calls.push({ receiver: this, event, ui }); };
  const $ = el => el === target ? { data: () => ({ options: { drop: handler } }) } : item;
  $.Event = (type, props) => ({ type, ...props });
  const context = vm.createContext({
    window: { __gmToolsUiDocument: "doc", campaign_id: "campaign", currentPlayer: { d20: { compendium: { shortName: "dnd5e" } } }, jQuery: $, scrollX: 0, scrollY: 0 },
    document: { createElement: () => ({}), getElementById: id => id === "editor-wrapper" ? target : { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }) } },
    fetch, URLSearchParams, AbortSignal,
  });
  return { run: vm.runInContext(`(${runCompendiumAction.toString()})`, context), calls, item, target, context };
}
test("search uses campaign context, returns exact references, and never drops", async () => {
  let url;
  const { run, calls } = setup(async value => { url = value; return { ok: true, json: async () => [{ pagename: "Goblin", category: "Monsters", expansion: 2, source: "Monster Manual", pageid: 12, token: "https://files.d20.io/token.png" }] }; });
  const result = await run("doc", { tool: "compendium_search", query: "Goblin & friends" });
  assert.equal(new URL(url, "https://app.roll20.net").searchParams.get("terms"), "Goblin & friends");
  assert.equal(result.results[0].expansionId, 2);
  assert.equal(result.results[0].pageName, "Goblin");
  assert.equal(calls.length, 0);
});
test("search errors propagate to the worker's tool-error boundary", async () => {
  const { run } = setup(async () => ({ ok: false, status: 504 }));
  await assert.rejects(run("doc", { tool: "compendium_search", query: "Goblin" }), /504/);
  await assert.rejects(run("stale", { tool: "compendium_search", query: "Goblin" }), /page changed/);
});
test("import invokes the existing handler once and reports initiation only", async () => {
  const { run, calls, item, target } = setup(() => { throw new Error("No direct fetch expected"); });
  const result = await run("doc", { tool: "compendium_import", pageName: "Goblin", category: "Monsters", expansionId: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiver, target);
  assert.equal(calls[0].ui.draggable, item);
  assert.equal(calls[0].ui.helper, item);
  assert.equal(item.attrs["data-pagename"], "Monsters%3AGoblin");
  assert.equal(item.attrs["data-expansionid"], "2");
  assert.equal(calls[0].event.pageX, 410);
  assert.equal(calls[0].event.pageY, 320);
  assert.equal(result.importInitiated, true);
  assert.match(result.note, /NOT confirmed complete/);
  assert.match(result.note, /Leave the sheet open/);
});

test("closing targets only the requested character and uses its normal control", async () => {
  const { run, context, calls } = setup();
  const clicked = [];
  context.window.currentPlayer.d20.Campaign = { characters: { get: id => id === "goblin" ? { view: {} } : undefined } };
  context.document.querySelectorAll = () => ["other", "goblin"].map(id => ({ getAttribute: () => id, querySelector: () => ({ click: () => clicked.push(id) }) }));
  const result = await run("doc", { tool: "close_character_window", characterId: "goblin" });
  assert.equal(result.closeRequested, true);
  assert.deepEqual(clicked, ["goblin"]);
  assert.equal(calls.length, 0);
  await assert.rejects(run("stale", { tool: "close_character_window", characterId: "goblin" }), /page changed/);
  await assert.rejects(run("doc", { tool: "close_character_window", characterId: "missing" }), /not present/);
});

test("closing handles absent windows and rejects popouts without side effects", async () => {
  const { run, context } = setup();
  const view = {};
  context.window.currentPlayer.d20.Campaign = { characters: { get: () => ({ view }) } };
  context.document.querySelectorAll = () => [];
  assert.equal((await run("doc", { tool: "close_character_window", characterId: "goblin" })).closeRequested, false);
  view.popoutWindow = true;
  await assert.rejects(run("doc", { tool: "close_character_window", characterId: "goblin" }), /popped-out/);
});
