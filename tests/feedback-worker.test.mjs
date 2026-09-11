import assert from "node:assert/strict";
import test from "node:test";
import worker, { MAX_REPORT_BYTES } from "../generated/feedback-worker/index.js";

function report() {
  return {
    format: "gmtools-feedback", formatVersion: 1, reportId: "client-report-id",
    exportedAt: new Date().toISOString(), feedback: "Initiative is incorrect.",
    extension: { version: "0.2.0", buildId: "test", browser: "Chrome" },
    includes: { chat: false, images: false },
  };
}

function setup(overrides = {}) {
  const writes = [], limits = [];
  const env = {
    FEEDBACK_UPLOADS_ENABLED: "true",
    FEEDBACK_RATE_LIMITER: { async limit(options) { limits.push(options.key); return { success: true }; } },
    FEEDBACK_GLOBAL_RATE_LIMITER: { async limit(options) { limits.push(options.key); return { success: true }; } },
    FEEDBACK_BUCKET: { async put(...args) { writes.push(args); return { key: args[0] }; } },
    ...overrides,
  };
  return { env, writes, limits };
}

function post(value = report(), headers = {}) {
  return new Request("https://feedback.example/feedback", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...headers },
    body: JSON.stringify(value),
  });
}

function withImage() {
  const value = report();
  value.includes = { chat: true, images: true };
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
  value.conversation = {
    chat: { id: "chat" }, messages: [], snapshots: [],
    images: [{ imageId: "image", filename: "map.png", mediaType: "image/png",
      size: Buffer.from(data, "base64").length, encoding: "base64", data }],
  };
  return value;
}

test("stores an export once under a server-generated dated key", async () => {
  const { env, writes, limits } = setup();
  const value = report();
  value.reportId = "../../client-controlled";
  const response = await worker.fetch(post(value), env);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.notEqual(receipt.reportId, value.reportId);
  assert.ok(Number.isFinite(Date.parse(receipt.receivedAt)));
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_[a-f0-9-]{36}\.json$/);
  assert.equal(writes[0][0].includes("client-controlled"), false);
  assert.deepEqual(JSON.parse(writes[0][1]), value);
  assert.deepEqual(writes[0][2], { httpMetadata: { contentType: "application/json" }, onlyIf: { etagDoesNotMatch: "*" } });
  assert.deepEqual(limits, ["192.0.2.1", "reports"]);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("accepts chat diagnostics and valid encoded images", async () => {
  const { env, writes } = setup();
  const value = withImage();
  value.conversation.messages = [{ role: "assistant", parts: [{ type: "text", text: "example" }] }];
  value.futureDiagnostic = { note: "preserve fields not recognized by the envelope schema" };
  assert.equal((await worker.fetch(post(value), env)).status, 201);
  assert.deepEqual(JSON.parse(writes[0][1]), value);
});

test("accepts optional email without logging private report data", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const { env, writes } = setup();
  const value = { ...report(), email: "gm@example.com" };
  const response = await worker.fetch(post(value), env);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.notEqual(receipt.reportId, value.reportId);
  assert.equal(JSON.parse(writes[0][1]).email, value.email);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    [{ event: "feedback_response", status: 201, imageCount: 0, hasEmail: true, reportId: receipt.reportId,
      payloadBytes: Buffer.byteLength(JSON.stringify(value)) }],
  ]);
  for (const email of ["", "invalid", 123, "x".repeat(250) + "@example.com"]) {
    assert.equal((await worker.fetch(post({ ...report(), email }), env)).status, 400);
  }
  assert.equal(writes.length, 1);
  assert.deepEqual(log.mock.calls.slice(1).map(call => call.arguments.map(({ payloadBytes, ...entry }) => {
    assert.ok(payloadBytes > 0);
    return entry;
  })),
    Array.from({ length: 4 }, () => [{ event: "feedback_validation_failed", status: 400, failureCategory: "invalid_schema" }]));
  const text = JSON.stringify(log.mock.calls.map(call => call.arguments));
  assert.equal(text.includes(value.email), false);
  assert.equal(text.includes(value.feedback), false);
  assert.equal(text.includes("192.0.2.1"), false);
});

test("logs actual UTF-8 payload size and attached image count", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const { env } = setup();
  const value = withImage();
  value.feedback = "A sorcerer 🧙";
  const response = await worker.fetch(post(value, { "Content-Length": "1" }), env);
  const receipt = await response.json();
  assert.deepEqual(log.mock.calls[0].arguments, [{
    event: "feedback_response", status: 201, imageCount: 1, hasEmail: false, reportId: receipt.reportId,
    payloadBytes: Buffer.byteLength(JSON.stringify(value)),
  }]);
  const limited = setup({ FEEDBACK_RATE_LIMITER: { async limit() { return { success: false }; } } });
  await worker.fetch(post(value), limited.env);
  assert.deepEqual(log.mock.calls[1].arguments, [{ event: "feedback_response", status: 429, failureCategory: "ip_rate_limit" }]);
  value.conversation.images = Array(6).fill(value.conversation.images[0]);
  await worker.fetch(post(value), env);
  assert.deepEqual(log.mock.calls[2].arguments, [{
    event: "feedback_validation_failed", status: 413, imageCount: 6,
    failureCategory: "image_count_limit",
    payloadBytes: Buffer.byteLength(JSON.stringify(value)),
  }]);
});

test("rejects oversized image and missing-reference arrays before element validation", async (t) => {
  t.mock.method(console, "info", () => {});
  for (const [field, limit] of [["images", 5], ["missingImageIds", 20], ["missingSnapshotHashes", 20]]) {
    for (const count of [limit + 1, 100_000]) {
      const { env, writes } = setup();
      const value = withImage();
      value.conversation[field] = Array(count).fill(null);
      // Oversized malformed entries must hit the count guard, not Zod's 400.
      assert.equal((await worker.fetch(post(value), env)).status, 413);
      assert.equal(writes.length, 0);
    }
  }
});

test("accepts 20 missing references each and still validates their types", async (t) => {
  t.mock.method(console, "info", () => {});
  const value = withImage();
  value.conversation.missingImageIds = Array.from({ length: 20 }, (_, i) => `image-${i}`);
  value.conversation.missingSnapshotHashes = Array.from({ length: 20 }, (_, i) => `snapshot-${i}`);
  const { env } = setup();
  assert.equal((await worker.fetch(post(value), env)).status, 201);
  for (const field of ["missingImageIds", "missingSnapshotHashes"]) {
    const malformed = structuredClone(value);
    malformed.conversation[field][0] = null;
    assert.equal((await worker.fetch(post(malformed), env)).status, 400);
    value.conversation[field].push("one-too-many");
    assert.equal((await worker.fetch(post(value), env)).status, 413);
    value.conversation[field].pop();
  }
});

test("disabled uploads fail closed without reading the body or accessing storage", async () => {
  for (const enabled of ["false", undefined]) {
    const { env, writes, limits } = setup({ FEEDBACK_UPLOADS_ENABLED: enabled });
    const request = post();
    Object.defineProperty(request, "body", { get() { throw new Error("Body must not be read"); } });
    assert.equal((await worker.fetch(request, env)).status, 503);
    assert.deepEqual(writes, []);
    assert.deepEqual(limits, []);
  }
});

test("logs distinct failure categories without provider exception details", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const brokenImage = withImage();
  brokenImage.conversation.images[0].size++;
  const cases = [
    [new Request("https://feedback.example/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }), setup().env, "invalid_json"],
    [post(brokenImage), setup().env, "invalid_image"],
    [post(), setup({ FEEDBACK_RATE_LIMITER: { async limit() { throw new Error("private"); } } }).env, "limiter_unavailable"],
    [post(), setup({ FEEDBACK_BUCKET: { async put() { throw new Error("private"); } } }).env, "storage_failure"],
  ];
  for (const [request, env, category] of cases) {
    await worker.fetch(request, env);
    const entry = log.mock.calls.at(-1).arguments[0];
    assert.equal(entry.failureCategory, category);
    assert.equal(Object.hasOwn(entry, "reportId"), false);
    assert.equal(JSON.stringify(entry).includes("private"), false);
  }
});

test("health, preflight, unknown paths and unsupported methods do not write", async () => {
  const { env, writes, limits } = setup();
  for (const [path, method, expected] of [["/", "GET", 200], ["/feedback", "OPTIONS", 204],
    ["/feedback", "GET", 405], ["/feedback", "DELETE", 405], ["/reports/file.json", "GET", 404]]) {
    const response = await worker.fetch(new Request(`https://feedback.example${path}`, { method }), env);
    assert.equal(response.status, expected);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(limits, []);
});

test("requires uncompressed JSON", async () => {
  const { env, writes } = setup();
  for (const headers of [{ "Content-Type": "text/plain" }, { "Content-Encoding": "gzip" }]) {
    assert.equal((await worker.fetch(post(report(), headers), env)).status, 415);
  }
  assert.deepEqual(writes, []);
});

test("rate limits before consuming the body and fails closed on limiter errors", async () => {
  for (const binding of ["FEEDBACK_RATE_LIMITER", "FEEDBACK_GLOBAL_RATE_LIMITER"]) {
    const { env, writes } = setup({ [binding]: { async limit() { return { success: false }; } } });
    const request = post();
    Object.defineProperty(request, "body", { get() { throw new Error("Body must not be read"); } });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.deepEqual(writes, []);
  }
  const { env } = setup({ FEEDBACK_RATE_LIMITER: { async limit() { throw new Error("private details"); } } });
  const response = await worker.fetch(post(), env);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("private details"), false);
});

test("rejects invalid JSON and invalid export envelopes", async () => {
  const { env, writes } = setup();
  const malformed = new Request("https://feedback.example/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal((await worker.fetch(malformed, env)).status, 400);
  for (const value of [null, [], {}, { ...report(), formatVersion: 2 },
    { ...report(), feedback: " " }, { ...report(), feedback: "x".repeat(100_001) },
    { ...report(), exportedAt: "not a date" },
    { ...report(), extension: { version: "1", buildId: 123, browser: "Chrome" } },
    { ...report(), includes: { chat: true, images: false } },
    { ...report(), conversation: {} }]) {
    assert.equal((await worker.fetch(post(value), env)).status, 400);
  }
  assert.deepEqual(writes, []);
});

test("validates image type, bytes, encoded size, count, duplicate IDs, and opt-in", async () => {
  const mutations = [
    [400, (v) => { v.includes.images = false; }],
    [413, (v) => { v.conversation.images = Array(6).fill(v.conversation.images[0]); }],
    [400, (v) => { v.conversation.images.push(v.conversation.images[0]); }],
    [400, (v) => { v.conversation.images[0].mediaType = "image/svg+xml"; }],
    [400, (v) => { v.conversation.chat = []; }],
    [400, (v) => { v.conversation.images[0].encoding = "hex"; }],
    [400, (v) => { v.conversation.images[0].size = "100"; }],
    [400, (v) => { v.conversation.images[0].mediaType = "image/jpeg"; }],
    [400, (v) => { v.conversation.images[0].size++; }],
    [413, (v) => { v.conversation.images[0].size = 10 * 1024 * 1024 + 1; }],
    [400, (v) => { v.conversation.images[0].data = "!!!!"; v.conversation.images[0].size = 3; }],
  ];
  for (const [expected, mutate] of mutations) {
    const { env, writes } = setup();
    const value = withImage();
    mutate(value);
    assert.equal((await worker.fetch(post(value), env)).status, expected);
    assert.deepEqual(writes, []);
  }
});

test("rejects declared oversize bodies without consuming them", async () => {
  const { env, writes } = setup();
  const request = post(report(), { "Content-Length": String(MAX_REPORT_BYTES + 1) });
  Object.defineProperty(request, "body", { get() { throw new Error("Body must not be read"); } });
  assert.equal((await worker.fetch(request, env)).status, 413);
  assert.deepEqual(writes, []);
});

test("enforces the byte cap on streamed bodies even with absent or false Content-Length", async () => {
  for (const length of [undefined, "1"]) {
    const { env, writes } = setup();
    let cancelled = false;
    const request = new Request("https://feedback.example/feedback", {
      method: "POST", duplex: "half",
      headers: { "Content-Type": "application/json", ...(length ? { "Content-Length": length } : {}) },
      body: new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(MAX_REPORT_BYTES + 1)); },
        cancel() { cancelled = true; },
      }),
    });
    assert.equal((await worker.fetch(request, env)).status, 413);
    assert.equal(cancelled, true);
    assert.deepEqual(writes, []);
  }
});

test("handles UTF-8 characters split across chunks", async () => {
  const { env } = setup();
  const value = report();
  value.feedback = "Elven sorcerer 🧙";
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const request = new Request("https://feedback.example/feedback", {
    method: "POST", duplex: "half", headers: { "Content-Type": "application/json" },
    body: new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }),
  });
  assert.equal((await worker.fetch(request, env)).status, 201);
});

test("does not report success or expose provider details when storage fails", async () => {
  for (const put of [async () => { throw new Error("secret report data"); }, async () => null]) {
    const { env } = setup({ FEEDBACK_BUCKET: { put } });
    const response = await worker.fetch(post(), env);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("secret report data"), false);
  }
});
