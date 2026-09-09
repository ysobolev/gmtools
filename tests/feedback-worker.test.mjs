import assert from "node:assert/strict";
import test from "node:test";
import worker from "../generated/feedback-worker/index.js";

test("placeholder rejects every request without reading bodies or accessing R2", async () => {
  const forbidden = new Proxy({}, { get() { throw new Error("Must not access request or R2"); } });
  const response = await worker.fetch(forbidden, forbidden);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match((await response.json()).error, /not enabled/);
});
