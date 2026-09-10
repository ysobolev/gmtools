import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";
import { convertToModelMessages, jsonSchema, tool } from "ai";

globalThis.chrome = { runtime: { sendMessage: async () => undefined } };

async function bundle(entryPoint) {
  const { outputFiles } = await build({ entryPoints: [entryPoint], bundle: true,
    format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [runs, chats, campaigns, persistence, approvals, providerTools] = await Promise.all([
  bundle("src/extension/run-snapshot-store.ts"),
  bundle("src/extension/chat-store.ts"),
  bundle("src/extension/campaign-store.ts"),
  bundle("src/extension/chat-persistence.ts"),
  bundle("src/extension/roll20-approval-store.ts"),
  bundle("src/extension/openrouter-tools.ts"),
]);

const config = {
  formatVersion: 1, system: "Use the supplied stat block.", modelId: "test/model",
  modelOptions: { cache_control: { type: "ephemeral" } },
  provider: { name: "openrouter", compatibility: "strict", appName: "GM Tools for VTT",
    appUrl: "https://github.com/ysobolev/gmtools", headers: {} },
  tools: [{ name: "execute_roll20", description: "Run code", inputSchema: { type: "object" } }],
  behavior: { maximumSteps: 24, unrestrictedWebFetchEnabled: false, webSearchEnabled: false,
    requireRoll20Approval: false, memoryEnabled: true },
  extension: { version: "0.2.0", buildId: "build-test", browser: "Chrome" },
  profile: { id: "profile-1", name: "General" },
  campaign: { id: "campaign-A", name: "Campaign A", modVersion: "0.2.0" },
};
const user = (id = "user-1") => ({ id, role: "user", parts: [{ type: "text", text: "Build this NPC" }] });
const markers = (message) => message.metadata.gmToolsSubmissions;

test("request diagnostics survive stale panel saves, export, retries and chat deletion", async () => {
  const { chat } = await chats.createChat("general-gm");
  const history = await runs.recordRunSubmission(chat.id, [user()], config);
  const run = markers(history[0])[0];
  const initial = { id: "http-1", kind: "chat", sessionId: chat.id, requestedModel: "alias", startedAt: 1, outcome: "started" };
  await runs.recordRunRequest(chat.id, run.runId, initial);
  const completed = { ...initial, generationIds: ["gen-1"], requestIds: ["req-1"], model: "actual/model", provider: "Azure", finishedAt: 2, outcome: "failed" };
  await runs.recordRunRequest(chat.id, run.runId, completed);
  await chats.saveChatMessages(chat.id, history); // stale marker lacks requests
  const saved = await chats.getStoredChat(chat.id);
  assert.deepEqual(markers(saved.messages[0])[0].requests, [completed]);
  await chats.updateChatContinuation(chat.id, { reason: "stream-error", afterMessageId: "user-1", createdAt: Date.now(), discardReasoning: true });
  assert.equal((await chats.getStoredChat(chat.id)).chat.continuation.discardReasoning, true);
  assert.deepEqual(await convertToModelMessages(saved.messages), await convertToModelMessages([user()]));
  const feedback = await bundle("src/extension/feedback-report.ts");
  const report = await feedback.createFeedbackReport({ feedback: "routing failure", includeChat: true, includeImages: false, chatId: chat.id, runningWhenOpened: false, extension: config.extension });
  assert.deepEqual(markers(report.conversation.messages[0])[0].requests, [completed]);
  const retry = await runs.recordRunSubmission(chat.id, saved.messages, config, { reason: "stream-error", afterMessageId: "user-1", discardReasoning: true });
  assert.equal(markers(retry[0]).at(-1).reasoningDiscarded, true);
  assert.deepEqual(markers(retry[0])[0].requests, [completed]);
  await chats.deleteChat(chat.id);
  await runs.recordRunRequest(chat.id, run.runId, initial);
  assert.equal(await chats.getStoredChat(chat.id), undefined);
});

test("snapshots use canonical hashes and only capture declarative tool configuration", async () => {
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  assert.equal(await runs.hashRunSnapshot(config), await runs.hashRunSnapshot(reordered));
  for (const changed of [
    { system: "Changed prompt" }, { modelId: "other/model" },
    { behavior: { ...config.behavior, maximumSteps: 16 } },
    { campaign: { ...config.campaign, name: "Renamed" } },
    { tools: [] }, { extension: { ...config.extension, buildId: "next" } },
  ]) {
    assert.notEqual(await runs.hashRunSnapshot(config), await runs.hashRunSnapshot({ ...config, ...changed }));
  }
  const tools = {
    inspect: tool({ description: "Inspect", inputSchema: jsonSchema({ type: "object" }),
      execute: () => { throw new Error("Never execute during snapshotting"); } }),
    web_fetch: providerTools.createOpenRouterWebFetchTool(),
    hidden: tool({ inputSchema: jsonSchema({ type: "object" }) }),
  };
  const captured = JSON.parse(JSON.stringify(await runs.snapshotTools(tools, ["inspect", "web_fetch"])));
  assert.equal(captured.length, 2);
  assert.equal(captured[0].description, "Inspect");
  assert.deepEqual(captured[0].inputSchema, { type: "object" });
  assert.equal(captured[1].id, "openrouter.web_fetch");
  assert.deepEqual(captured[1].args.parameters.allowed_domains, ["help.roll20.net"]);
  assert.equal("execute" in captured[0], false);
});

test("ordinary, resume and retry markers persist without entering model content", async () => {
  const { chat } = await chats.createChat("general-gm");
  let history = await runs.recordRunSubmission(chat.id, [user()], config);
  const first = markers(history[0])[0];
  assert.equal(first.kind, "message");
  assert.ok(first.runId && first.createdAt);
  assert.deepEqual(await runs.getRunSnapshot(first.snapshotHash), config);
  assert.deepEqual(await convertToModelMessages(history), await convertToModelMessages([user()]));

  const receipt = { id: "assistant-1", role: "assistant", parts: [
    { type: "text", text: "Unfinished text" },
    { type: "tool-execute_roll20", toolCallId: "call-1", state: "output-available",
      input: { code: "return 5;", summary: "inspect" }, output: { ok: true, result: 5 } },
    { type: "data-generated-image", data: { imageId: "local-image" } },
  ] };
  history = persistence.prepareConversationForResume([...history, receipt]);
  history = await runs.recordRunSubmission(chat.id, history, config,
    { reason: "step-limit", afterMessageId: receipt.id });
  const second = markers(history[0])[1];
  assert.equal(second.kind, "resume");
  assert.equal(second.afterMessageId, receipt.id);
  assert.equal(second.snapshotHash, first.snapshotHash);
  assert.notEqual(second.runId, first.runId);
  assert.equal(history[1].parts.some((p) => p.type === "text"), false);
  assert.equal(history[1].parts.length, 2);

  const changed = { ...config, system: "New instructions", campaign: { id: "campaign-B", name: "Campaign B" } };
  history = await runs.recordRunSubmission(chat.id, history, changed,
    { reason: "stream-error", afterMessageId: receipt.id });
  assert.equal(markers(history[0])[2].kind, "retry");
  assert.notEqual(markers(history[0])[2].snapshotHash, first.snapshotHash);
  assert.deepEqual(await runs.getRunSnapshot(first.snapshotHash), config);

  // A stale panel has no worker-authored metadata; neither normal nor approval
  // persistence may discard the earlier run boundaries.
  await chats.saveChatMessages(chat.id, [user(), history[1]]);
  await approvals.saveMessagesAndRegisterRoll20Approvals(chat.id, undefined, [user(), history[1]]);
  await approvals.saveConversationInputWithApprovals(chat.id, undefined, [user(), history[1]]);
  history = (await chats.getStoredChat(chat.id)).messages;
  assert.equal(markers(history[0]).length, 3);
  history = await runs.recordRunSubmission(chat.id, [user()], changed);
  assert.equal(markers(history[0])[3].kind, "retry");
  await chats.deleteChat(chat.id);
  assert.equal(await runs.getRunSnapshot(first.snapshotHash), undefined);
});

test("new submissions and approvals have distinct markers; attachment notices are not submissions", async () => {
  const { chat } = await chats.createChat("general-gm");
  const first = await runs.recordRunSubmission(chat.id, [user()], config);
  const notice = { id: "notice", role: "user", metadata: { kind: "campaign-attachment-notice" },
    parts: [{ type: "text", text: "Attached to another campaign" }] };
  const second = await runs.recordRunSubmission(chat.id, [...first, notice, user("user-2")], config);
  assert.equal(markers(second[0]).length, 1);
  assert.equal(markers(second[2])[0].kind, "message");
  const approval = { id: "assistant-approval", role: "assistant", parts: [
    { type: "tool-execute_roll20", state: "approval-responded", toolCallId: "tool-approval",
      input: { code: "return 5;" }, approval: { id: "approval-1", approved: true } },
  ] };
  const third = await runs.recordRunSubmission(chat.id, [...second, approval], config);
  assert.equal(markers(third[2])[1].kind, "approval");
  assert.deepEqual(third[1], notice);
  await chats.deleteChat(chat.id);
});

test("shared snapshots survive one chat deletion and campaign detach, then are collected on bulk deletion", async () => {
  const a = await chats.createChat("general-gm");
  const b = await chats.createChat("general-gm");
  const history = await runs.recordRunSubmission(a.chat.id, [user()], config);
  await runs.recordRunSubmission(b.chat.id, [user()], config);
  const hash = markers(history[0])[0].snapshotHash;
  await chats.deleteChat(a.chat.id);
  assert.ok(await runs.getRunSnapshot(hash));
  await campaigns.attachChatToCampaign(b.chat.id, { campaignId: "gc-campaign", name: "GC", modVersion: "0.2.0" });
  await campaigns.deleteCampaign("gc-campaign", "detach-chats");
  assert.ok(await runs.getRunSnapshot(hash));
  assert.equal(markers((await chats.getStoredChat(b.chat.id)).messages[0]).length, 1);
  await campaigns.attachChatToCampaign(b.chat.id, { campaignId: "gc-campaign", name: "GC", modVersion: "0.2.0" });
  await campaigns.deleteCampaign("gc-campaign", "delete-chats");
  assert.equal(await runs.getRunSnapshot(hash), undefined);
  await assert.rejects(runs.recordRunSubmission(b.chat.id, [user()], config), /no longer exists/);
  assert.equal(await runs.getRunSnapshot(hash), undefined);
});
