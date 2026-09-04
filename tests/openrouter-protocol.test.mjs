import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/openrouter-protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const protocolSource = outputFiles[0].text;
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(protocolSource).toString("base64")}`
);

test("validates credential persistence requests", () => {
  assert.equal(
    protocol.isAuthRequest({
      type: protocol.AUTH_PERSISTENCE_REQUEST,
      enabled: true,
    }),
    true,
  );
  assert.equal(
    protocol.isAuthRequest({
      type: protocol.AUTH_PERSISTENCE_REQUEST,
      enabled: "yes",
    }),
    false,
  );
});

test("requires persistence state in authentication responses", () => {
  assert.equal(
    protocol.isAuthResponse({
      ok: true,
      status: { connected: true, persistent: false },
    }),
    true,
  );
  assert.equal(
    protocol.isAuthResponse({
      ok: true,
      status: { connected: true },
    }),
    false,
  );
});

test("validates chat requests with stable conversation IDs", () => {
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_START,
      requestId: "request-1",
      chatId: "chat-1",
      messages: [],
      profileId: "general-gm",
    }),
    true,
  );
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_START,
      requestId: "request-1",
      chatId: "chat-1",
      messages: [],
      profile: {},
    }),
    false,
  );
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_RESUME,
      requestId: "request-1",
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_RESUME,
      requestId: "request-1",
    }),
    false,
  );
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_CONTINUE,
      requestId: "request-2",
      chatId: "chat-1",
      profileId: "general-gm",
    }),
    true,
  );
  assert.equal(
    protocol.isChatPortRequest({
      type: protocol.CHAT_CONTINUE,
      requestId: "request-2",
      chatId: "chat-1",
    }),
    false,
  );
});

test("validates chat lifecycle control messages", () => {
  assert.equal(
    protocol.isChatControlRequest({
      type: protocol.CHAT_RESUME_QUERY,
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    protocol.isChatControlRequest({
      type: protocol.CHAT_COMMIT,
      chatId: 42,
    }),
    false,
  );
  assert.equal(
    protocol.isChatControlResponse({ ok: true, available: true }),
    true,
  );
});

test("validates chat activity snapshots and updates", () => {
  assert.equal(
    protocol.isChatActivitiesRequest({
      type: protocol.CHAT_ACTIVITIES_REQUEST,
    }),
    true,
  );
  assert.equal(
    protocol.isChatActivitiesResponse({
      ok: true,
      activities: [
        { chatId: "chat-1", state: "thinking" },
        { chatId: "chat-2", state: "working", summary: "moving Flippy" },
        { chatId: "chat-3", state: "unread" },
        { chatId: "chat-4", state: "error", summary: "Provider failed" },
        { chatId: "chat-5", state: "approval" },
      ],
    }),
    true,
  );
  assert.equal(
    protocol.isChatActivityChangedMessage({
      type: protocol.CHAT_ACTIVITY_CHANGED,
      activity: { chatId: "chat-1", state: "idle" },
    }),
    true,
  );
  assert.equal(
    protocol.isChatActivitiesResponse({
      ok: true,
      activities: [{ chatId: "chat-1", state: "unknown" }],
    }),
    false,
  );
});

test("validates pending approval updates", () => {
  assert.equal(
    protocol.isChatApprovalsChangedMessage({
      type: protocol.CHAT_APPROVALS_CHANGED,
      chatId: "chat-1",
      count: 2,
    }),
    true,
  );
  assert.equal(
    protocol.isChatApprovalsChangedMessage({
      type: protocol.CHAT_APPROVALS_CHANGED,
      chatId: "chat-1",
      count: -1,
    }),
    false,
  );
});

test("validates durable message invalidations", () => {
  assert.equal(
    protocol.isChatMessagesChangedMessage({
      type: protocol.CHAT_MESSAGES_CHANGED,
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    protocol.isChatMessagesChangedMessage({
      type: protocol.CHAT_MESSAGES_CHANGED,
      chatId: "",
    }),
    false,
  );
});

test("validates persisted continuation updates", () => {
  assert.equal(
    protocol.isChatContinuationChangedMessage({
      type: protocol.CHAT_CONTINUATION_CHANGED,
      chatId: "chat-1",
      continuation: {
        reason: "step-limit",
        afterMessageId: "assistant-1",
        stepLimit: 24,
        createdAt: 1234,
      },
    }),
    true,
  );
  assert.equal(
    protocol.isChatContinuationChangedMessage({
      type: protocol.CHAT_CONTINUATION_CHANGED,
      chatId: "chat-1",
      continuation: {
        reason: "stream-error",
        afterMessageId: "assistant-2",
        createdAt: 2345,
      },
    }),
    true,
  );
  assert.equal(
    protocol.isChatContinuationChangedMessage({
      type: protocol.CHAT_CONTINUATION_CHANGED,
      chatId: "chat-1",
      continuation: null,
    }),
    true,
  );
});

test("validates campaign status messages", () => {
  const status = {
    chatId: "chat-1",
    state: "connected",
    campaignId: "campaign-1",
    name: "Tuesday Night",
  };
  assert.equal(
    protocol.isCampaignStatusRequest({
      type: protocol.CAMPAIGN_STATUS_REQUEST,
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    protocol.isCampaignAttachRequest({
      type: protocol.CAMPAIGN_ATTACH_REQUEST,
      chatId: "chat-1",
      candidate: {
        campaignId: "campaign-1",
        name: "Tuesday Night",
        modVersion: "0.2.0",
        tabId: 7,
        activeTab: true,
      },
    }),
    true,
  );
  assert.equal(
    protocol.isCampaignStatusRequest({
      type: protocol.CAMPAIGN_DETACH_REQUEST,
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(protocol.isCampaignStatusResponse({ ok: true, status }), true);
  assert.equal(
    protocol.isCampaignStatusChangedMessage({
      type: protocol.CAMPAIGN_STATUS_CHANGED,
      status,
    }),
    true,
  );
  assert.equal(
    protocol.isCampaignStatusResponse({
      ok: true,
      status: { ...status, state: "mystery" },
    }),
    false,
  );
  assert.equal(
    protocol.isCampaignCandidatesRequest({
      type: protocol.CAMPAIGN_CANDIDATES_REQUEST,
      chatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    protocol.isCampaignCandidatesResponse({
      ok: true,
      candidates: [{
        campaignId: "campaign-1",
        name: "Tuesday Night",
        modVersion: "0.2.0",
        activeTab: false,
      }],
    }),
    true,
  );
});

test("validates campaign deletion requests and responses", () => {
  assert.equal(protocol.isCampaignDeletePreviewRequest({
    type: protocol.CAMPAIGN_DELETE_PREVIEW_REQUEST,
    campaignId: "campaign-1",
  }), true);
  assert.equal(protocol.isCampaignDeletePreviewResponse({
    ok: true,
    preview: {
      chatCount: 3,
      activeChatCount: 1,
      pendingApprovalChatCount: 1,
    },
  }), true);
  assert.equal(protocol.isCampaignDeleteRequest({
    type: protocol.CAMPAIGN_DELETE_REQUEST,
    campaignId: "campaign-1",
    mode: "detach-chats",
  }), true);
  assert.equal(protocol.isCampaignDeleteRequest({
    type: protocol.CAMPAIGN_DELETE_REQUEST,
    campaignId: "campaign-1",
    mode: "erase-everything",
  }), false);
  assert.equal(protocol.isCampaignDeleteResponse({
    ok: true,
    result: {
      campaignId: "campaign-1",
      chatIds: ["chat-1"],
      mode: "delete-chats",
    },
  }), true);
});
