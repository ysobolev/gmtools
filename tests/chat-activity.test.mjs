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
const {
  getAssistantContentBlocks,
  getChatActivity,
  getRoll20Receipts,
  hasActiveRoll20Status,
} = await import(
  `data:text/javascript;base64,${Buffer.from(activitySource).toString("base64")}`
);

function assistant(parts) {
  return { id: "assistant", role: "assistant", parts };
}

test("shows Thinking before the response starts", () => {
  assert.deepEqual(getChatActivity("submitted", []), { kind: "Thinking" });
});

test("shows the active sandbox call summary while it is executing", () => {
  assert.deepEqual(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "input-available",
          input: { summary: "Checking Flippy’s hit points", code: "return 1;" },
        },
      ]),
    ]),
    { kind: "Working", summary: "Checking Flippy’s hit points" },
  );
});

test("allows longer summaries up to the 120-character hard limit", () => {
  const summary = "x".repeat(130);
  assert.deepEqual(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "input-available",
          input: { summary, code: "return 1;" },
        },
      ]),
    ]),
    { kind: "Working", summary: "x".repeat(120) },
  );
});

test("shows only the first unresolved sandbox call summary", () => {
  assert.deepEqual(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "input-available",
          input: { summary: "Inspecting Flippy", code: "return 1;" },
        },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-2",
          state: "input-available",
          input: { summary: "Updating Flippy", code: "return 2;" },
        },
      ]),
    ]),
    { kind: "Working", summary: "Inspecting Flippy" },
  );
});

test("advances to the next summary after the active call finishes", () => {
  assert.deepEqual(
    getChatActivity("streaming", [
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { summary: "Inspecting Flippy", code: "return 1;" },
          output: { ok: true, result: 1 },
        },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-2",
          state: "input-available",
          input: { summary: "Updating Flippy", code: "return 2;" },
        },
      ]),
    ]),
    { kind: "Working", summary: "Updating Flippy" },
  );
});

test("returns to Thinking after a tool result while awaiting follow-up text", () => {
  assert.deepEqual(
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
    { kind: "Thinking" },
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

test("creates a completed receipt from a successful sandbox call", () => {
  assert.deepEqual(
    getRoll20Receipts(
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { summary: "moving Flippy north", code: "return 1;" },
          output: { ok: true, result: { top: 70 } },
        },
      ]),
    ),
    [
      {
        toolCallId: "tool-1",
        summary: "moving Flippy north",
        status: "completed",
      },
    ],
  );
});

test("creates failed receipts from bridge and script failures", () => {
  assert.deepEqual(
    getRoll20Receipts(
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { summary: "finding Flippy", code: "return 1;" },
          output: { ok: false, error: { message: "Timed out" } },
        },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-2",
          state: "output-available",
          input: { summary: "moving Flippy", code: "return 2;" },
          output: { ok: true, result: { ok: false, error: "Not found" } },
        },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-3",
          state: "output-error",
          input: { summary: "reading Flippy", code: "return 3;" },
          errorText: "Execution failed",
        },
      ]),
    ),
    [
      { toolCallId: "tool-1", summary: "finding Flippy", status: "failed" },
      { toolCallId: "tool-2", summary: "moving Flippy", status: "failed" },
      { toolCallId: "tool-3", summary: "reading Flippy", status: "failed" },
    ],
  );
});

test("omits active calls and historical calls without summaries", () => {
  assert.deepEqual(
    getRoll20Receipts(
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "active",
          state: "input-available",
          input: { summary: "moving Flippy", code: "return 1;" },
        },
        {
          type: "tool-execute_roll20",
          toolCallId: "historical",
          state: "output-available",
          input: { code: "return 2;" },
          output: { ok: true, result: 2 },
        },
      ]),
    ),
    [],
  );
});

test("preserves text and Roll20 status ordering", () => {
  assert.deepEqual(
    getAssistantContentBlocks(
      assistant([
        { type: "text", text: "First, I’ll inspect the sheet." },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { summary: "inspecting Flippy", code: "return 1;" },
          output: { ok: true, result: 1 },
        },
        { type: "text", text: "Now I’ll apply the change." },
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-2",
          state: "output-error",
          input: { summary: "updating Flippy", code: "return 2;" },
          errorText: "Failed",
        },
        { type: "text", text: "The second step failed." },
      ]),
    ),
    [
      { type: "text", text: "First, I’ll inspect the sheet." },
      {
        type: "roll20-status",
        receipt: {
          toolCallId: "tool-1",
          summary: "inspecting Flippy",
          status: "completed",
        },
      },
      { type: "text", text: "Now I’ll apply the change." },
      {
        type: "roll20-status",
        receipt: {
          toolCallId: "tool-2",
          summary: "updating Flippy",
          status: "failed",
        },
      },
      { type: "text", text: "The second step failed." },
    ],
  );
});

test("places an active Roll20 call inline with a working status", () => {
  const message = assistant([
    { type: "text", text: "I’ll check that now." },
    {
      type: "tool-execute_roll20",
      toolCallId: "tool-1",
      state: "input-available",
      input: { summary: "checking Flippy", code: "return 1;" },
    },
  ]);

  assert.deepEqual(getAssistantContentBlocks(message).at(-1), {
    type: "roll20-status",
    receipt: {
      toolCallId: "tool-1",
      summary: "checking Flippy",
      status: "working",
    },
  });
  assert.equal(hasActiveRoll20Status(message), true);
});
