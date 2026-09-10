import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
const { outputFiles } = await build({ entryPoints: ["src/extension/request-diagnostics.ts"], bundle: true, format: "esm", platform: "node", write: false });
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("allowlists routing identifiers and excludes prompts, reasoning, pipeline data and secrets", () => {
  const value = diagnostics.routingDiagnosticFields({ id: "gen-1", request_id: "req-1", model: "actual/model", provider: "Azure", choices: [{ message: "PRIVATE" }], reasoning_details: "PRIVATE", openrouter_metadata: { strategy: "direct", region: "SJC", attempt: 1, requested: "alias", endpoints: { available: [{ provider: "Azure", model: "actual/model", selected: true, secret: "PRIVATE" }] }, pipeline: [{ data: "PRIVATE" }] } });
  assert.deepEqual(value.generationIds, ["gen-1"]);
  assert.deepEqual(value.requestIds, ["req-1"]);
  assert.equal(value.router.endpoints[0].selected, true);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|choices|pipeline|reasoning/);
  assert.deepEqual(diagnostics.routingDiagnosticFields({ choices: [] }), {});
});
test("captures request headers and failure-body IDs without copying sensitive fields", () => {
  assert.deepEqual(diagnostics.responseDiagnosticFields(new Response(null, { status: 400, headers: { "x-request-id": "req-1", "set-cookie": "PRIVATE" } })), { httpStatus: 400, requestIds: ["req-1"] });
  assert.deepEqual(diagnostics.errorDiagnosticFields({ responseBody: JSON.stringify({ id: "gen-failed", request_id: "req-failed", error: { message: "PRIVATE" } }) }), { generationIds: ["gen-failed"], requestIds: ["req-failed"] });
});

test("raw SDK streaming exposes generation IDs before completion and final router metadata", async () => {
  const chunks = [
    { id: "gen-live", request_id: "req-live", model: "actual/model", provider: "Azure", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] },
    { id: "gen-live", model: "actual/model", provider: "Azure", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, openrouter_metadata: { strategy: "direct", endpoints: { available: [{ provider: "Azure", selected: true }] } } },
  ];
  const provider = createOpenRouter({ apiKey: "test", fetch: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }) });
  const observed = [];
  const result = streamText({ model: provider("test/model"), prompt: "Hello", includeRawChunks: true, onChunk: ({ chunk }) => {
    if (chunk.type === "raw") observed.push(diagnostics.routingDiagnosticFields(chunk.rawValue));
  } });
  assert.equal(await result.text, "Hello");
  assert.deepEqual(observed[0].generationIds, ["gen-live"]);
  assert.deepEqual(observed[0].requestIds, ["req-live"]);
  assert.equal(observed[0].router, undefined);
  assert.equal(observed[1].router.strategy, "direct");
});
