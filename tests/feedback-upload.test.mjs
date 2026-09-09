import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const { outputFiles } = await build({
  entryPoints: ["src/extension/feedback-upload.ts"], bundle: true,
  format: "esm", platform: "node", write: false,
});
const { submitFeedbackReport } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("submits JSON to the configured endpoint without credentials", async (t) => {
  const report = { feedback: "Test feedback" };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://gmtools-feedback.yury-sobolev.workers.dev/feedback");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), report);
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 201 });
  });
  await submitFeedbackReport(report);
});

test("HTTP and network failures reject without automatic retries", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 413 }));
  await assert.rejects(submitFeedbackReport({}), /HTTP 413/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(submitFeedbackReport({}), /Couldn’t submit feedback/);
  assert.equal(fetch.mock.callCount(), 2);
});

test("submission timeout explains that delivery is unconfirmed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("signal timed out", "TimeoutError");
  });
  await assert.rejects(submitFeedbackReport({}), /timed out.*couldn’t confirm/);
});

test("dialog offers a separate export action without an export suggestion in errors", async () => {
  const source = await readFile("src/extension/feedback-dialog.tsx", "utf8");
  assert.doesNotMatch(source, /You can use Export as JSON below/);
  assert.match(source, /className="link-button"[\s\S]*finishReport\(false\)/);
  assert.match(source, /Submitting…/);
});

test("build-time override replaces the default feedback destination", async () => {
  const url = "http://localhost:8787/feedback";
  const { outputFiles } = await build({
    entryPoints: ["src/extension/feedback-config.ts"], bundle: true,
    format: "esm", platform: "node", write: false,
    define: { __GMTOOLS_FEEDBACK_SUBMISSION_URL__: JSON.stringify(url) },
  });
  const config = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  assert.equal(config.FEEDBACK_SUBMISSION_URL, url);
});
