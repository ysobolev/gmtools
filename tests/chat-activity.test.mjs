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
  countPendingRoll20Approvals,
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

test("shows image generation while executing, not while arguments stream or after completion", () => {
  for (const state of ["input-streaming", "input-available", "output-available", "output-error"]) {
    const part = { type: "tool-generate_image", toolCallId: "image-1", state, input: { prompt: "map" } };
    assert.deepEqual(getChatActivity("streaming", [assistant([part])]), {
      kind: state === "input-available" ? "Generating image" : "Thinking",
    });
    assert.equal(getChatActivity("ready", [assistant([part])]), null);
  }
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

test("distinguishes an unknown timeout outcome from a failure", () => {
  assert.deepEqual(
    getRoll20Receipts(
      assistant([
        {
          type: "tool-execute_roll20",
          toolCallId: "tool-1",
          state: "output-available",
          input: { summary: "moving Flippy north", code: "return 1;" },
          output: {
            ok: false,
            error: {
              code: "ROLL20_EXECUTION_TIMEOUT",
              message: "Roll20 did not return a result within 45 seconds.",
              retryable: false,
              executionState: "unknown",
            },
          },
        },
      ]),
    ),
    [
      {
        toolCallId: "tool-1",
        summary: "moving Flippy north",
        status: "timed-out",
      },
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

test("preserves completed campaign memory mutations as inline receipts", () => {
  assert.deepEqual(
    getAssistantContentBlocks(
      assistant([
        { type: "text", text: "I’ll remember that." },
        {
          type: "tool-memory_store",
          toolCallId: "memory-1",
          state: "output-available",
          input: { content: "The chapel bell rings at midnight." },
          output: {
            id: "stored-memory",
            created: true,
            content: "The chapel bell rings at midnight.",
          },
        },
        {
          type: "tool-memory_update",
          toolCallId: "memory-2",
          state: "output-available",
          input: {
            memoryId: "stored-memory",
            content: "The bell rings at dawn.",
          },
          output: {
            id: "stored-memory",
            content: "The bell rings at dawn.",
            updatedAt: 1,
          },
        },
        {
          type: "tool-memory_delete",
          toolCallId: "memory-3",
          state: "output-available",
          input: { memoryId: "stored-memory" },
          output: {
            id: "stored-memory",
            deleted: true,
            content: "The bell rings at dawn.",
          },
        },
      ]),
    ),
    [
      { type: "text", text: "I’ll remember that." },
      {
        type: "memory-receipt",
        receipt: {
          toolCallId: "memory-1",
          action: "stored",
          content: "The chapel bell rings at midnight.",
        },
      },
      {
        type: "memory-receipt",
        receipt: {
          toolCallId: "memory-2",
          action: "updated",
          content: "The bell rings at dawn.",
        },
      },
      {
        type: "memory-receipt",
        receipt: {
          toolCallId: "memory-3",
          action: "deleted",
          content: "The bell rings at dawn.",
        },
      },
    ],
  );
});

test("does not show campaign memory searches as receipts", () => {
  assert.deepEqual(
    getAssistantContentBlocks(
      assistant([
        {
          type: "tool-memory_search",
          toolCallId: "memory-search",
          state: "output-available",
          input: { query: "chapel" },
          output: {
            memories: [{
              id: "memory-1",
              content: "The chapel is abandoned.",
            }],
          },
        },
      ]),
    ),
    [],
  );
});

test("exposes pending Roll20 approval details inline", () => {
  const message = assistant([
    {
      type: "tool-execute_roll20",
      toolCallId: "tool-approval",
      state: "approval-requested",
      input: { summary: "moving Flippy", code: "return 1;" },
      approval: { id: "approval-1", isAutomatic: false },
    },
  ]);

  assert.deepEqual(getAssistantContentBlocks(message), [
    {
      type: "roll20-approval",
      approval: {
        approvalId: "approval-1",
        toolCallId: "tool-approval",
        summary: "moving Flippy",
        code: "return 1;",
      },
    },
  ]);
  assert.equal(countPendingRoll20Approvals([message]), 1);
  assert.equal(hasActiveRoll20Status(message), true);
});

test("shows an approved Roll20 call as queued", () => {
  const message = assistant([
    {
      type: "tool-execute_roll20",
      toolCallId: "tool-approved",
      state: "approval-responded",
      input: { summary: "moving Flippy", code: "return 1;" },
      approval: {
        id: "approval-1",
        approved: true,
        isAutomatic: false,
      },
    },
  ]);

  assert.deepEqual(getAssistantContentBlocks(message).at(-1), {
    type: "roll20-status",
    receipt: {
      toolCallId: "tool-approved",
      summary: "moving Flippy",
      status: "approved",
    },
  });
  assert.equal(countPendingRoll20Approvals([message]), 0);
  assert.equal(hasActiveRoll20Status(message), true);
});
