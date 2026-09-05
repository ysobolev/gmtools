import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/model-inactivity.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { createModelInactivityMonitor } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("warns after silence, resets on progress, and clears without aborting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const changes = [];
  const monitor = createModelInactivityMonitor((value) => changes.push(value), controller.signal);
  monitor.start();
  t.mock.timers.tick(59_999);
  assert.deepEqual(changes, []);
  monitor.progress(); // text, hidden reasoning, or tool-argument progress
  t.mock.timers.tick(59_999);
  assert.deepEqual(changes, []);
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [true]);
  t.mock.timers.tick(120_000);
  assert.deepEqual(changes, [true]);
  assert.equal(controller.signal.aborted, false);
  monitor.progress();
  assert.deepEqual(changes, [true, false]);
  t.mock.timers.tick(60_000);
  assert.deepEqual(changes, [true, false, true]);
  monitor.dispose();
  assert.deepEqual(changes, [true, false, true, false]);
});

test("does not warn between model calls, during tools, or after disposal", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const changes = [];
  const monitor = createModelInactivityMonitor((value) => changes.push(value), new AbortController().signal);
  t.mock.timers.tick(120_000);
  monitor.start();
  t.mock.timers.tick(30_000);
  monitor.pause();
  monitor.progress();
  t.mock.timers.tick(120_000);
  assert.deepEqual(changes, []);
  monitor.start();
  t.mock.timers.tick(60_000);
  assert.deepEqual(changes, [true]);
  monitor.pause();
  assert.deepEqual(changes, [true, false]);
  monitor.dispose();
  monitor.start();
  t.mock.timers.tick(120_000);
  assert.deepEqual(changes, [true, false]);
});

test("abort clears warnings and separate chats have independent timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const first = [];
  const second = [];
  const a = createModelInactivityMonitor((value) => first.push(value), controller.signal);
  const b = createModelInactivityMonitor((value) => second.push(value), new AbortController().signal);
  a.start();
  b.start();
  t.mock.timers.tick(30_000);
  b.progress();
  t.mock.timers.tick(30_000);
  assert.deepEqual(first, [true]);
  assert.deepEqual(second, []);
  controller.abort();
  assert.deepEqual(first, [true, false]);
  a.start();
  t.mock.timers.tick(60_000);
  assert.deepEqual(first, [true, false]);
  assert.deepEqual(second, [true]);
  a.dispose();
  b.dispose();
});
