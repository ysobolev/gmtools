import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";

globalThis.chrome = {
  runtime: { sendMessage: async () => undefined },
};

async function bundle(entryPoint) {
  const { outputFiles } = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  );
}

const approvals = await bundle("src/extension/roll20-approval-store.ts");
const chats = await bundle("src/extension/chat-store.ts");
const uiActions = await bundle("src/extension/roll20-ui-events.ts");

test("UI event approvals bind exact arguments, reject denial, and cannot replay", async () => {
  for (const [type, input] of [["tool-switch_layer", { layer: "gm" }], ["tool-drop_image", { imageId: "image-1", x: 5, y: 10 }], ["tool-drop_image", { imageId: "image-1", x: null, y: null }]]) {
    for (const approved of [true, false]) {
      const campaignId = `campaign-${type}-${approved}`;
      const chatId = await createAttachedChat(campaignId);
      const requested = {
        id: "assistant", role: "assistant", parts: [{ type, input, toolCallId: "call-1", state: "approval-requested", approval: { id: "approval-1", isAutomatic: false } }],
      };
      await approvals.saveMessagesAndRegisterRoll20Approvals(chatId, campaignId, [requested]);
      const changed = structuredClone(requested);
      changed.parts[0].state = "approval-responded";
      changed.parts[0].approval.approved = approved;
      changed.parts[0].input = type === "tool-switch_layer" ? { layer: "map" } : { imageId: "another-image" };
      await assert.rejects(approvals.saveConversationInputWithApprovals(chatId, campaignId, [changed]), /already resolved/);
      const responded = structuredClone(requested);
      responded.parts[0].state = "approval-responded";
      responded.parts[0].approval.approved = approved;
      await approvals.saveConversationInputWithApprovals(chatId, campaignId, [responded]);
      const canonical = uiActions.roll20ActionInput(type, input);
      if (approved) {
        assert.equal(await approvals.claimRoll20Approval(chatId, campaignId, "call-1", canonical, true), true);
      }
      await assert.rejects(approvals.claimRoll20Approval(chatId, campaignId, "call-1", canonical, true), /already resolved/);
    }
  }
});

function approvalMessage({
  approvalId,
  approved,
  code = "return 1;",
  toolCallId,
}) {
  return {
    id: `assistant-${toolCallId}`,
    role: "assistant",
    parts: [
      {
        type: "tool-execute_roll20",
        toolCallId,
        state: approved === undefined
          ? "approval-requested"
          : "approval-responded",
        input: { summary: "testing approval", code },
        approval: {
          id: approvalId,
          isAutomatic: false,
          ...(approved === undefined ? {} : { approved }),
        },
      },
    ],
  };
}

async function createAttachedChat(campaignId) {
  const created = await chats.createChat("general-gm");
  await chats.updateChatCampaign(created.chat.id, {
    campaignId,
    campaignName: campaignId,
    campaignModVersion: "0.2.0",
  });
  return created.chat.id;
}

test("an approved Roll20 action can be claimed exactly once", async () => {
  const chatId = await createAttachedChat("campaign-1");
  const requested = approvalMessage({
    approvalId: "approval-1",
    toolCallId: "tool-1",
  });
  await approvals.saveMessagesAndRegisterRoll20Approvals(
    chatId,
    "campaign-1",
    [requested],
  );

  const responded = approvalMessage({
    approvalId: "approval-1",
    approved: true,
    toolCallId: "tool-1",
  });
  assert.equal(
    await approvals.saveConversationInputWithApprovals(
      chatId,
      "campaign-1",
      [responded],
    ),
    true,
  );
  assert.equal(
    await approvals.saveConversationInputWithApprovals(
      chatId,
      "campaign-1",
      [responded],
    ),
    false,
  );
  assert.equal(
    await approvals.claimRoll20Approval(
      chatId,
      "campaign-1",
      "tool-1",
      responded.parts[0].input,
      true,
    ),
    true,
  );
  await assert.rejects(
    approvals.claimRoll20Approval(
      chatId,
      "campaign-1",
      "tool-1",
      responded.parts[0].input,
      true,
    ),
    /already resolved/,
  );
  await approvals.resolveRoll20ApprovalExecution(chatId, "tool-1", "completed");
  await assert.rejects(
    approvals.saveConversationInputWithApprovals(
      chatId,
      "campaign-1",
      [responded],
    ),
    /already resolved/,
  );
});

test("denied, modified, and cross-campaign approvals are rejected", async () => {
  const deniedChatId = await createAttachedChat("campaign-2");
  const deniedRequest = approvalMessage({
    approvalId: "approval-2",
    toolCallId: "tool-2",
  });
  await approvals.saveMessagesAndRegisterRoll20Approvals(
    deniedChatId,
    "campaign-2",
    [deniedRequest],
  );
  const deniedResponse = approvalMessage({
    approvalId: "approval-2",
    approved: false,
    toolCallId: "tool-2",
  });
  await approvals.saveConversationInputWithApprovals(
    deniedChatId,
    "campaign-2",
    [deniedResponse],
  );
  await assert.rejects(
    approvals.claimRoll20Approval(
      deniedChatId,
      "campaign-2",
      "tool-2",
      deniedResponse.parts[0].input,
      true,
    ),
    /already resolved/,
  );

  const modifiedChatId = await createAttachedChat("campaign-3");
  const modifiedRequest = approvalMessage({
    approvalId: "approval-3",
    toolCallId: "tool-3",
  });
  await approvals.saveMessagesAndRegisterRoll20Approvals(
    modifiedChatId,
    "campaign-3",
    [modifiedRequest],
  );
  await assert.rejects(
    approvals.saveConversationInputWithApprovals(
      modifiedChatId,
      "campaign-3",
      [
        approvalMessage({
          approvalId: "approval-3",
          approved: true,
          code: "return 2;",
          toolCallId: "tool-3",
        }),
      ],
    ),
    /already resolved/,
  );

  await chats.updateChatCampaign(modifiedChatId, {
    campaignId: "campaign-4",
    campaignName: "campaign-4",
    campaignModVersion: "0.2.0",
  });
  await assert.rejects(
    approvals.saveConversationInputWithApprovals(
      modifiedChatId,
      "campaign-4",
      [
        approvalMessage({
          approvalId: "approval-3",
          approved: true,
          toolCallId: "tool-3",
        }),
      ],
    ),
    /already resolved/,
  );
});

test("unapproved execution remains available when approval is disabled", async () => {
  const chatId = await createAttachedChat("campaign-5");
  assert.equal(
    await approvals.claimRoll20Approval(
      chatId,
      "campaign-5",
      "tool-without-approval",
      { summary: "ordinary execution", code: "return 5;" },
      false,
    ),
    false,
  );
});

test("canceling approvals removes unresolved cards and durable approval state", async () => {
  const chatId = await createAttachedChat("campaign-6");
  const requested = approvalMessage({
    approvalId: "approval-6",
    toolCallId: "tool-6",
  });
  await approvals.saveMessagesAndRegisterRoll20Approvals(
    chatId,
    "campaign-6",
    [requested],
  );
  await chats.updateChatPendingRoll20Approvals(chatId, 1);

  await approvals.cancelRoll20Approvals(chatId);

  const stored = await chats.getStoredChat(chatId);
  assert.equal(stored.chat.pendingRoll20Approvals, undefined);
  assert.deepEqual(stored.messages, []);
  await assert.rejects(
    approvals.claimRoll20Approval(
      chatId,
      "campaign-6",
      "tool-6",
      requested.parts[0].input,
      true,
    ),
    /already resolved/,
  );
});
