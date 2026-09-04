import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/roll20-response-tracker.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { Roll20ResponseTracker } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const requestId = "12345678-abcd-4abc-8def-123456789abc";
const request = (kind = "execute") => ({
  requestId,
  kind,
  expiresAt: 2_000,
});
const acknowledgement = (accepted = true) => ({
  type: "GMTOOLS_ROLL20_ACKNOWLEDGEMENT",
  requestId,
  accepted,
});
const response = {
  type: "GMTOOLS_ROLL20_EXECUTE_RESPONSE",
  requestId,
};

test("accepts only responses correlated with a request from this page", () => {
  const tracker = new Roll20ResponseTracker();
  tracker.register(request(), 1_000);

  assert.equal(tracker.has("deadbeef-1234", 1_000), false);
  assert.equal(tracker.has(requestId, 1_000), true);
});

test("retains an accepted execution until its result arrives", () => {
  const tracker = new Roll20ResponseTracker();
  tracker.register(request(), 1_000);

  assert.equal(tracker.consume(acknowledgement()), true);
  assert.equal(tracker.consume(acknowledgement()), false);
  assert.equal(tracker.has(requestId, 1_000), true);
  assert.equal(tracker.consume(response), true);
  assert.equal(tracker.has(requestId, 1_000), true);
  assert.equal(tracker.consume(response), false);
  assert.equal(tracker.consume(acknowledgement()), false);
});

test("keeps settled identification and rejected execution tombstones", () => {
  const identification = new Roll20ResponseTracker();
  identification.register(request("identify"), 1_000);
  assert.equal(identification.consume(acknowledgement()), true);
  assert.equal(identification.has(requestId, 1_000), true);
  assert.equal(identification.consume(acknowledgement()), false);

  const rejected = new Roll20ResponseTracker();
  rejected.register(request(), 1_000);
  assert.equal(rejected.consume(acknowledgement(false)), true);
  assert.equal(rejected.has(requestId, 1_000), true);
  assert.equal(rejected.consume(acknowledgement(false)), false);
});

test("delivers reordered responses once and retains a settled tombstone", () => {
  const tracker = new Roll20ResponseTracker();
  tracker.register(request(), 1_000);

  assert.equal(tracker.consume(response), true);
  assert.equal(tracker.consume(response), false);
  assert.equal(tracker.consume(acknowledgement()), true);
  assert.equal(tracker.consume(acknowledgement()), false);
  assert.equal(tracker.has(requestId, 1_000), true);
});

test("expires abandoned request identifiers", () => {
  const tracker = new Roll20ResponseTracker();
  tracker.register(request(), 1_000);

  assert.equal(tracker.has(requestId, 301_999), true);
  assert.equal(tracker.has(requestId, 302_000), false);
});
