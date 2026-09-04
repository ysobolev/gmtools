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

  tracker.consume(acknowledgement());
  assert.equal(tracker.has(requestId, 1_000), true);
  tracker.consume(response);
  assert.equal(tracker.has(requestId, 1_000), false);
});

test("finishes tracking after identification or a rejected execution", () => {
  const identification = new Roll20ResponseTracker();
  identification.register(request("identify"), 1_000);
  identification.consume(acknowledgement());
  assert.equal(identification.has(requestId, 1_000), false);

  const rejected = new Roll20ResponseTracker();
  rejected.register(request(), 1_000);
  rejected.consume(acknowledgement(false));
  assert.equal(rejected.has(requestId, 1_000), false);
});

test("expires abandoned request identifiers", () => {
  const tracker = new Roll20ResponseTracker();
  tracker.register(request(), 1_000);

  assert.equal(tracker.has(requestId, 301_999), true);
  assert.equal(tracker.has(requestId, 302_000), false);
});
