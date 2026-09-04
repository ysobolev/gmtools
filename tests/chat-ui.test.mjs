import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-ui.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const chatUi = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function chat(id, campaignId, campaignName) {
  return {
    id,
    title: id,
    profileId: "general-gm",
    ...(campaignId
      ? {
          campaignId,
          campaignName,
          campaignModVersion: "0.2.0",
        }
      : {}),
    notices: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("groups unattached chats first and campaigns alphabetically", () => {
  const groups = chatUi.groupChatsByCampaign([
    chat("z-chat", "z", "Zeta"),
    chat("free"),
    chat("a-chat", "a", "Alpha"),
  ]);
  assert.deepEqual(groups.map((group) => group.name), [
    "No campaign",
    "Alpha",
    "Zeta",
  ]);
});

test("selects the next displayed chat after deletion", () => {
  const chats = [
    chat("z-chat", "z", "Zeta"),
    chat("free"),
    chat("a-1", "a", "Alpha"),
    chat("a-2", "a", "Alpha"),
  ];
  assert.equal(chatUi.nextChatIdAfterDeletion(chats, "a-1"), "a-2");
  assert.equal(chatUi.nextChatIdAfterDeletion([chat("only")], "only"), undefined);
});

test("counts only non-current chats that need attention", () => {
  const paused = {
    ...chat("paused"),
    continuation: {
      reason: "step-limit",
      afterMessageId: "assistant-1",
      stepLimit: 16,
      createdAt: 2,
    },
  };
  assert.equal(
    chatUi.countChatsNeedingAttention(
      [chat("current"), chat("thinking"), chat("unread"), chat("failed"), paused],
      {
        current: { chatId: "current", state: "unread" },
        thinking: { chatId: "thinking", state: "thinking" },
        unread: { chatId: "unread", state: "unread" },
        failed: { chatId: "failed", state: "error" },
      },
      "current",
    ),
    3,
  );
});

test("counts persisted approval requests as attention", () => {
  assert.equal(
    chatUi.countChatsNeedingAttention(
      [chat("current"), { ...chat("approval"), pendingRoll20Approvals: 1 }],
      {},
      "current",
    ),
    1,
  );
});

test("merges live and chat-derived campaign candidates by campaign ID", () => {
  const candidates = chatUi.mergeCampaignCandidates(
    [{
      campaignId: "live",
      name: "Live campaign",
      modVersion: "0.2.0",
      tabId: 7,
      activeTab: true,
    }],
    [
      chat("duplicate", "live", "Old live name"),
      chat("offline", "offline", "Offline campaign"),
    ],
  );
  assert.deepEqual(candidates, [
    {
      campaignId: "live",
      name: "Live campaign",
      modVersion: "0.2.0",
      tabId: 7,
      activeTab: true,
    },
    {
      campaignId: "offline",
      name: "Offline campaign",
      modVersion: "0.2.0",
      activeTab: false,
    },
  ]);
});

test("keeps independent in-memory drafts and scroll positions", () => {
  const drafts = chatUi.createChatDraftStore();
  drafts.set("chat-1", "First draft");
  drafts.set("chat-2", "Second draft");
  drafts.setScrollPosition("chat-1", {
    scrollTop: 240,
    atBottom: false,
    anchorMessageId: "message-3",
    anchorOffset: -12,
  });
  assert.equal(drafts.get("chat-1"), "First draft");
  assert.equal(drafts.get("chat-2"), "Second draft");
  assert.deepEqual(drafts.getScrollPosition("chat-1"), {
    scrollTop: 240,
    atBottom: false,
    anchorMessageId: "message-3",
    anchorOffset: -12,
  });
  assert.equal(drafts.getScrollPosition("chat-2"), undefined);
  drafts.set("chat-1", "");
  assert.equal(drafts.get("chat-1"), "");
  drafts.delete("chat-2");
  assert.equal(drafts.get("chat-2"), "");
  drafts.delete("chat-1");
  assert.equal(drafts.getScrollPosition("chat-1"), undefined);
});
