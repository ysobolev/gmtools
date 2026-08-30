import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-activity.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const activitySource = outputFiles[0].text;
const { getChatActivity } = await import(
  `data:text/javascript;base64,${Buffer.from(activitySource).toString("base64")}`
);

function assistant(parts) {
  return { id: "assistant", role: "assistant", parts };
}

test("shows Thinking before the response starts", () => {
  assert.equal(getChatActivity("submitted", []), "Thinking");
});

test("shows Working while a tool call is executing", () => {
  assert.equal(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "input-available",
          input: { code: "return 1;" },
        },
      ]),
    ]),
    "Working",
  );
});

test("returns to Thinking after a tool result while awaiting follow-up text", () => {
  assert.equal(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { code: "return 1;" },
          output: { ok: true, result: 1 },
        },
      ]),
    ]),
    "Thinking",
  );
});

test("hides the indicator while follow-up text is streaming", () => {
  assert.equal(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { code: "return 1;" },
          output: { ok: true, result: 1 },
        },
        { type: "text", text: "The result is one." },
      ]),
    ]),
    null,
  );
});

test("hides the indicator when the conversation is idle", () => {
  assert.equal(getChatActivity("ready", []), null);
});
