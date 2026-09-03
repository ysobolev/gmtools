import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-stream-outcome.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const outcome = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("detects an active tool loop stopped at the step limit", () => {
  assert.equal(
    outcome.stoppedAtStepLimit(
      [
        { finishReason: "tool-calls", toolCalls: [{}] },
        { finishReason: "tool-calls", toolCalls: [{}] },
      ],
      2,
    ),
    true,
  );
  assert.equal(
    outcome.stoppedAtStepLimit(
      [
        { finishReason: "tool-calls", toolCalls: [{}] },
        { finishReason: "stop", toolCalls: [] },
      ],
      2,
    ),
    false,
  );
  assert.equal(
    outcome.stoppedAtStepLimit(
      [{ finishReason: "tool-calls", toolCalls: [{}] }],
      2,
    ),
    false,
  );
  assert.equal(
    outcome.stoppedAtStepLimit(
      [
        { finishReason: "tool-calls", toolCalls: [{}] },
        {
          finishReason: "tool-calls",
          toolCalls: [{ providerExecuted: true }],
        },
      ],
      2,
    ),
    false,
  );
});

test("recognizes an AI SDK error chunk in an otherwise closed stream", () => {
  assert.equal(
    outcome.getChatStreamError([
      { type: "start", messageId: "assistant-1" },
      { type: "error", errorText: "Your OpenRouter account needs credit." },
      { type: "finish", finishReason: "error" },
    ]),
    "Your OpenRouter account needs credit.",
  );
});

test("does not classify a successful stream as an error", () => {
  assert.equal(
    outcome.getChatStreamError([
      { type: "start", messageId: "assistant-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Done." },
      { type: "text-end", id: "text-1" },
      { type: "finish", finishReason: "stop" },
    ]),
    undefined,
  );
});
