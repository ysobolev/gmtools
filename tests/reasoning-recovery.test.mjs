import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { convertToModelMessages } from "ai";

const { outputFiles } = await build({ entryPoints: ["src/extension/reasoning-recovery.ts"], bundle: true, format: "esm", platform: "node", write: false });
const { isReasoningCompatibilityError, stripConversationReasoning, REASONING_RECOVERY_MESSAGE } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("recognizes incompatible encrypted history, not ordinary provider failures", () => {
  for (const error of [
    new Error("Your request contains encrypted reasoning or compaction content from multiple providers. No single provider can decrypt the mixed history."),
    { error: { message: "Your request contains encrypted reasoning or compaction content that was produced under a different model." } },
    { cause: { code: "invalid_encrypted_content" } },
    REASONING_RECOVERY_MESSAGE,
  ]) assert.equal(isReasoningCompatibilityError(error), true);
  for (const error of [new Error("Insufficient credits"), new Error("Failed to fetch"), "Rate limit exceeded", "Encrypted reasoning is supported"]) assert.equal(isReasoningCompatibilityError(error), false);
  const cyclic = {}; cyclic.cause = cyclic;
  assert.equal(isReasoningCompatibilityError(cyclic), false);
});

test("strips all historical reasoning while preserving tools, images, text and diagnostics", async () => {
  const metadata = { openrouter: { reasoning_details: [{ type: "reasoning.encrypted", data: "secret", format: "azure-openai-responses-v1" }], provider: "Azure" } };
  const input = [
    { id: "u", role: "user", metadata: { gmToolsSubmissions: [{ runId: "run" }] }, parts: [{ type: "text", text: "reasoning_details is user data" }] },
    { id: "a", role: "assistant", parts: [
      { type: "reasoning", text: "private reasoning", providerMetadata: metadata },
      { type: "text", text: "Created NPC" },
      { type: "tool-execute_roll20", toolCallId: "t", state: "output-available", input: { code: "return true" }, output: { reasoning_details: "tool data", ok: true }, callProviderMetadata: metadata, resultProviderMetadata: metadata },
      { type: "data-generated-image", data: { imageId: "image" } },
    ] },
    { id: "a2", role: "assistant", providerOptions: metadata, parts: [{ type: "text", text: "Later answer", providerMetadata: metadata }] },
  ];
  const original = structuredClone(input);
  const output = stripConversationReasoning(input);
  assert.deepEqual(input, original);
  assert.deepEqual(output[0], input[0]);
  assert.equal(output[1].parts.some(p => p.type === "reasoning"), false);
  assert.equal(output[1].parts[1].toolCallId, "t");
  assert.deepEqual(output[1].parts[1].output, input[1].parts[2].output);
  assert.deepEqual(output[1].parts[2], input[1].parts[3]);
  assert.equal(output[2].parts[0].text, "Later answer");
  assert.doesNotMatch(JSON.stringify(output), /secret|private reasoning|azure-openai-responses/);
  const model = await convertToModelMessages(output);
  assert.doesNotMatch(JSON.stringify(model), /secret|private reasoning/);
  assert.match(JSON.stringify(model), /tool data/);
});
