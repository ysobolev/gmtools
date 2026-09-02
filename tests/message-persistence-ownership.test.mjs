import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sidePanelSource, workerSource] = await Promise.all([
  readFile("src/extension/sidepanel.tsx", "utf8"),
  readFile("src/extension/service-worker.ts", "utf8"),
]);

test("the worker exclusively persists model conversation history", () => {
  assert.doesNotMatch(sidePanelSource, /\bsaveChatMessages\b/);
  assert.match(workerSource, /\bsaveChatMessages\b/);
  assert.match(
    workerSource,
    /await persistCompletedConversation\(job, validation\.data\);\s*finishJob/,
  );
});
