import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/behavior-settings.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const behaviorSource = outputFiles[0].text;
const behavior = await import(
  `data:text/javascript;base64,${Buffer.from(behaviorSource).toString("base64")}`
);

test("enables debug logging only for an explicit true preference", () => {
  assert.equal(behavior.isDebugLoggingEnabled(true), true);
  assert.equal(behavior.isDebugLoggingEnabled(false), false);
  assert.equal(behavior.isDebugLoggingEnabled("true"), false);
  assert.equal(behavior.isDebugLoggingEnabled(undefined), false);
});

test("enables unrestricted web fetch only for an explicit true preference", () => {
  assert.equal(behavior.isUnrestrictedWebFetchEnabled(true), true);
  assert.equal(behavior.isUnrestrictedWebFetchEnabled(false), false);
  assert.equal(behavior.isUnrestrictedWebFetchEnabled("true"), false);
  assert.equal(behavior.isUnrestrictedWebFetchEnabled(undefined), false);
});

test("enables web search only for an explicit true preference", () => {
  assert.equal(behavior.isWebSearchEnabled(true), true);
  assert.equal(behavior.isWebSearchEnabled(false), false);
  assert.equal(behavior.isWebSearchEnabled("true"), false);
  assert.equal(behavior.isWebSearchEnabled(undefined), false);
});

test("normalizes the maximum steps preference", () => {
  assert.equal(behavior.normalizeMaxSteps(undefined), 16);
  assert.equal(behavior.normalizeMaxSteps(8), 8);
  assert.equal(behavior.normalizeMaxSteps(64), 64);
  assert.equal(behavior.normalizeMaxSteps(0), 16);
  assert.equal(behavior.normalizeMaxSteps(65), 16);
  assert.equal(behavior.normalizeMaxSteps(4.5), 16);
  assert.equal(behavior.normalizeMaxSteps("16"), 16);
});
