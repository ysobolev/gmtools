import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-persistence.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const persistence = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("reconstructs a completed assistant response from buffered UI chunks", async () => {
  const userMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "What changed in 5.5e?" }],
  };
  const messages = await persistence.reconstructCompletedConversation(
    [userMessage],
    [
      { type: "start", messageId: "assistant-1" },
      { type: "text-start", id: "text-1" },
      {
        type: "text-delta",
        id: "text-1",
        delta: "The 2024 revision updates several core rules.",
      },
      { type: "text-end", id: "text-1" },
      { type: "finish", finishReason: "stop" },
    ],
  );

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], userMessage);
  assert.equal(messages[1].id, "assistant-1");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].parts.length, 1);
  assert.equal(messages[1].parts[0].type, "text");
  assert.equal(
    messages[1].parts[0].text,
    "The 2024 revision updates several core rules.",
  );
  assert.equal(messages[1].parts[0].state, "done");
});

test("does not produce a durable response when no assistant message exists", async () => {
  assert.equal(
    await persistence.reconstructCompletedConversation([], []),
    undefined,
  );
});

test("reconstructs a generated-image reference without raw image data", async () => {
  const image = {
    imageId: "generated:image-1",
    filename: "generated-image.png",
    mediaType: "image/png",
    size: 3,
  };
  const messages = await persistence.reconstructCompletedConversation([], [
    { type: "start", messageId: "assistant-1" },
    { type: "data-generated-image", id: image.imageId, data: image },
    { type: "finish", finishReason: "stop" },
  ]);

  assert.deepEqual(messages?.[0]?.parts, [{
    type: "data-generated-image",
    id: image.imageId,
    data: image,
  }]);
  assert.doesNotMatch(JSON.stringify(messages), /data:image/);
});

test("persists partial text as a stopped assistant response", async () => {
  const userMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Write a long description." }],
  };
  const messages = await persistence.reconstructStoppedConversation(
    [userMessage],
    [
      { type: "start", messageId: "assistant-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The ruined keep" },
    ],
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1].parts[0].type, "text");
  assert.equal(messages[1].parts[0].text, "The ruined keep");
  assert.equal(messages[1].parts[0].state, "done");
  assert.equal(persistence.isStoppedAssistantMessage(messages[1]), true);
});

test("keeps completed tools and removes unfinished tools from stopped output", async () => {
  const messages = await persistence.reconstructStoppedConversation([], [
    { type: "start", messageId: "assistant-1" },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "completed-call",
      toolName: "execute_roll20",
      input: { summary: "moving Flippy", code: "return true;" },
    },
    {
      type: "tool-output-available",
      toolCallId: "completed-call",
      output: { ok: true, result: true },
    },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "unfinished-call",
      toolName: "execute_roll20",
      input: { summary: "moving Jax", code: "return true;" },
    },
  ]);

  const toolParts = messages[0].parts.filter((part) =>
    part.type.startsWith("tool-"),
  );
  assert.equal(toolParts.length, 1);
  assert.equal(toolParts[0].toolCallId, "completed-call");
  assert.equal(toolParts[0].state, "output-available");
  assert.equal(
    messages[0].parts.filter((part) => part.type === "step-start").length,
    1,
  );
  assert.equal(persistence.isStoppedAssistantMessage(messages[0]), true);
});

test("does not create an empty assistant response when stopped before output", async () => {
  const input = [{
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Hello" }],
  }];
  assert.deepEqual(
    await persistence.reconstructStoppedConversation(input, []),
    input,
  );
});
