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
