import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";
import { convertToModelMessages, safeValidateUIMessages } from "ai";

globalThis.chrome = { runtime: { sendMessage: async () => undefined } };

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

const [campaigns, chats, profiles] = await Promise.all([
  bundle("src/extension/campaign-store.ts"),
  bundle("src/extension/chat-store.ts"),
  bundle("src/extension/profile-store.ts"),
]);

test("handshake sandbox metadata persists on campaigns and is reused for offline attachment", async () => {
  const first = await chats.createChat("general-gm");
  const binding = { campaignId: "sandbox-test", name: "Sandbox test", modVersion: "0.2.0" };
  const sandboxVersion = "1.5";
  await campaigns.attachChatToCampaign(first.chat.id, { ...binding, sandboxVersion });
  const campaign = await campaigns.getCampaign(binding.campaignId);
  assert.equal(campaign.sandboxVersion, sandboxVersion);
  assert.equal(typeof campaign.sandboxObservedAt, "number");
  const second = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(second.chat.id, binding);
  const stored = await chats.getStoredChat(second.chat.id);
  assert.match(stored.messages[0].parts[0].text, /Last-known Roll20 sandbox version: "1.5"/);
  assert.doesNotMatch(stored.messages[0].parts[0].text, /APIs|getSheetItem|getComputed/);
  await campaigns.updateObservedCampaignSandbox(binding.campaignId, "1.0");
  const legacy = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(legacy.chat.id, binding);
  const legacyNotice = (await chats.getStoredChat(legacy.chat.id)).messages[0].parts[0].text;
  assert.match(legacyNotice, /sandbox version: "1.0"/);
  await campaigns.updateObservedCampaignSandbox(binding.campaignId, "default");
  assert.equal((await campaigns.getCampaign(binding.campaignId)).sandboxVersion, "default");
  const third = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(third.chat.id, { ...binding, campaignId: "unknown-sandbox" });
  assert.match((await chats.getStoredChat(third.chat.id)).messages[0].parts[0].text, /version is unknown/);
});

test("attachment warns only for retained campaign tool history and persists a model-visible boundary", async () => {
  for (const toolName of [undefined, "web_fetch", "view_image", "web_search", "execute_roll20", "memory_search", "memory_store", "memory_update", "memory_delete"]) {
    const created = await chats.createChat("general-gm");
    const messages = toolName ? [{
      id: "earlier-assistant",
      role: "assistant",
      parts: [{
        type: `tool-${toolName}`,
        toolCallId: "previous-call",
        state: "output-available",
        input: {},
        output: { result: "old campaign findings" },
      }],
    }] : [{ id: "ordinary", role: "user", parts: [{ type: "text", text: "Plan a session" }] }];
    await chats.saveChatMessages(created.chat.id, messages);
    const binding = { campaignId: `notice-${toolName}`, name: "New campaign", modVersion: "0.2.0" };
    await campaigns.attachChatToCampaign(created.chat.id, binding);
    const stored = await chats.getStoredChat(created.chat.id);
    const expected = toolName === "execute_roll20" || toolName?.startsWith("memory_");
    assert.deepEqual(stored.messages.slice(0, messages.length), messages);
    assert.equal(stored.messages.length, messages.length + 1);
    const notice = stored.messages.at(-1);
    assert.equal(notice.metadata.kind, "campaign-attachment-notice");
    assert.equal(notice.metadata.campaignId, binding.campaignId);
    assert.equal(notice.metadata.warnAboutHistory, Boolean(expected));
    if (expected) assert.match(notice.parts[0].text, /Earlier Roll20 and memory tool results may refer to another campaign/);
    else assert.doesNotMatch(notice.parts[0].text, /Earlier Roll20/);
    assert.ok(notice.parts[0].text.includes(binding.campaignId));
    const validated = await safeValidateUIMessages({ messages: stored.messages });
    assert.equal(validated.success, true);
    const modelMessages = await convertToModelMessages(validated.data);
    assert.equal(modelMessages.at(-1).role, "user");
    assert.ok(modelMessages.at(-1).content[0].text.includes(binding.campaignId));
    if (expected) assert.match(modelMessages.at(-1).content[0].text, /re-establish relevant campaign-specific facts/);
    await chats.updateChatCampaign(created.chat.id, undefined);
    await campaigns.attachChatToCampaign(created.chat.id, binding);
    const reattached = await chats.getStoredChat(created.chat.id);
    assert.equal(reattached.messages.length, messages.length + 1);
    assert.notEqual(reattached.messages.at(-1).id, notice.id);
    // With no historical attachment identity, repeated pending changes remain
    // conservative rather than treating the transient destination as trusted.
    assert.equal(reattached.messages.at(-1).metadata.warnAboutHistory, Boolean(expected));
    await chats.updateChatCampaign(created.chat.id, undefined);
    await campaigns.attachChatToCampaign(created.chat.id, {
      ...binding, campaignId: `${binding.campaignId}-different`,
    });
    const switched = await chats.getStoredChat(created.chat.id);
    assert.equal(switched.messages.at(-1).metadata.warnAboutHistory, Boolean(expected));
    await chats.updateChatCampaign(created.chat.id, undefined);
    await campaigns.attachChatToCampaign(created.chat.id, binding);
    const returned = await chats.getStoredChat(created.chat.id);
    assert.equal(returned.messages.at(-1).metadata.warnAboutHistory, Boolean(expected));
  }
});

test("empty attachment adds hidden model context; dynamic campaign tools produce a warning", async () => {
  const created = await chats.createChat("general-gm");
  const binding = { campaignId: "notice-dynamic", name: "Campaign", modVersion: "0.2.0" };
  await campaigns.attachChatToCampaign(created.chat.id, binding);
  const initial = (await chats.getStoredChat(created.chat.id)).messages;
  assert.equal(initial.length, 1);
  assert.equal(initial[0].metadata.warnAboutHistory, false);
  assert.match(initial[0].parts[0].text, /notice-dynamic/);
  const validation = await safeValidateUIMessages({ messages: initial });
  assert.equal(validation.success, true);
  const modelMessages = await convertToModelMessages(validation.data);
  assert.match(modelMessages[0].content[0].text, /notice-dynamic/);
  await chats.updateChatCampaign(created.chat.id, undefined);
  await chats.saveChatMessages(created.chat.id, [{
    id: "dynamic", role: "assistant", parts: [{
      type: "dynamic-tool", toolName: "memory_search", toolCallId: "dynamic-call",
      state: "output-error", input: {}, errorText: "failed",
    }],
  }]);
  await campaigns.attachChatToCampaign(created.chat.id, binding);
  assert.equal((await chats.getStoredChat(created.chat.id)).messages.length, 2);
});

test("coalesces pending attachments and deletes the pending notice on restoration", async () => {
  const created = await chats.createChat("general-gm");
  const attach = async (campaignId) => {
    await chats.updateChatCampaign(created.chat.id, undefined);
    await campaigns.attachChatToCampaign(created.chat.id, {
      campaignId, name: campaignId, modVersion: "0.2.0",
      sandboxVersion: campaignId === "coalesce-A" ? "default" : "v1.5",
    });
    return (await chats.getStoredChat(created.chat.id)).messages;
  };
  const initial = await attach("coalesce-A");
  const toolMessage = {
    id: "coalesce-tool", role: "assistant", parts: [{
      type: "tool-execute_roll20", toolCallId: "coalesce-call",
      state: "output-available", input: {}, output: { sheet: "ogl5e" },
    }],
  };
  const history = [...initial, toolMessage];
  await chats.saveChatMessages(created.chat.id, history);
  const b = await attach("coalesce-B");
  assert.equal(b.length, history.length + 1);
  assert.equal(b.at(-1).metadata.warnAboutHistory, true);
  assert.match(b.at(-1).parts[0].text, /"v1.5"/);
  assert.match(history[0].parts[0].text, /"default"/);
  const c = await attach("coalesce-C");
  assert.equal(c.length, history.length + 1);
  assert.deepEqual(c.slice(0, -1), history);
  assert.equal(c.at(-1).metadata.campaignId, "coalesce-C");
  assert.equal(c.at(-1).metadata.warnAboutHistory, true);
  assert.deepEqual(await attach("coalesce-A"), history);

  // A non-tool conversation turn freezes the B boundary.
  const bAgain = await attach("coalesce-B");
  const conversation = [...bAgain, {
    id: "ordinary-after-B", role: "user", parts: [{ type: "text", text: "What next?" }],
  }];
  await chats.saveChatMessages(created.chat.id, conversation);
  const restoredAfterConversation = await attach("coalesce-A");
  assert.deepEqual(restoredAfterConversation.slice(0, -1), conversation);
  assert.equal(restoredAfterConversation.at(-1).metadata.warnAboutHistory, true);
});

test("initial attachment corrections retain exactly one hidden identity notice", async () => {
  const created = await chats.createChat("general-gm");
  for (const campaignId of ["initial-A", "initial-B", "initial-C", "initial-A"]) {
    await chats.updateChatCampaign(created.chat.id, undefined);
    await campaigns.attachChatToCampaign(created.chat.id, {
      campaignId, name: campaignId, modVersion: "0.2.0",
    });
    const stored = await chats.getStoredChat(created.chat.id);
    assert.equal(stored.messages.length, 1);
    assert.equal(stored.messages[0].metadata.campaignId, campaignId);
    assert.equal(stored.messages[0].metadata.warnAboutHistory, false);
  }
});

test("campaign records apply defaults, preserve established profiles, and follow renames", async () => {
  const custom = {
    id: "campaign-default",
    name: "Campaign default",
    rulesetId: "custom",
    modelSelection: { kind: "recommended" },
    additionalInstructions: "",
  };
  await profiles.saveProfile(custom, { create: true });
  const first = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(first.chat.id, {
    campaignId: "campaign-1",
    name: "Old name",
    modVersion: "0.2.0",
  });
  await campaigns.updateCampaignConfiguration("campaign-1", {
    defaultProfileId: custom.id,
  });
  await campaigns.updateCampaignConfiguration("campaign-1", {
    overrides: {
      unrestrictedWebFetch: "enabled",
      webSearch: "disabled",
    },
  });
  await campaigns.updateCampaignConfiguration("campaign-1", {
    memoryEnabled: true,
  });
  const configured = await campaigns.getCampaign("campaign-1");
  assert.equal(configured.defaultProfileId, custom.id);
  assert.deepEqual(configured.overrides, {
    unrestrictedWebFetch: "enabled",
    webSearch: "disabled",
    requireRoll20Approval: "inherit",
  });
  assert.equal(configured.memoryEnabled, true);

  const empty = await chats.createChat("general-gm");
  const attachedEmpty = await campaigns.attachChatToCampaign(empty.chat.id, {
    campaignId: "campaign-1",
    name: "Old name",
    modVersion: "0.2.0",
  });
  assert.equal(attachedEmpty.profileId, custom.id);
  await chats.updateChatCampaign(empty.chat.id, undefined);
  await campaigns.attachChatToCampaign(empty.chat.id, {
    campaignId: "campaign-1", name: "Old name", modVersion: "0.2.0",
  });
  assert.equal((await chats.getChat(empty.chat.id)).profileId, custom.id);

  const established = await chats.createChat("general-gm");
  await chats.saveChatMessages(established.chat.id, [
    { id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] },
  ]);
  const attachedEstablished = await campaigns.attachChatToCampaign(
    established.chat.id,
    { campaignId: "campaign-1", name: "Old name", modVersion: "0.2.0" },
  );
  assert.equal(attachedEstablished.profileId, "general-gm");

  assert.equal(
    await campaigns.updateObservedCampaignName("campaign-1", "New name"),
    true,
  );
  assert.equal((await campaigns.getCampaign("campaign-1")).name, "New name");
  assert.equal((await chats.getChat(first.chat.id)).campaignName, "New name");
});

test("deleting a profile resets campaign defaults to General", async () => {
  await profiles.deleteProfile("campaign-default");
  assert.equal(
    (await campaigns.getCampaign("campaign-1")).defaultProfileId,
    "general-gm",
  );
});

test("campaign deletion can detach chats or delete them", async () => {
  const detached = await campaigns.deleteCampaign("campaign-1", "detach-chats");
  assert.equal(detached.chatIds.length, 3);
  assert.equal((await chats.getChat(detached.chatIds[0])).campaignId, undefined);
  assert.equal(await campaigns.getCampaign("campaign-1"), undefined);

  const doomed = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(doomed.chat.id, {
    campaignId: "campaign-2",
    name: "Doomed",
    modVersion: "0.2.0",
  });
  await campaigns.deleteCampaign("campaign-2", "delete-chats");
  assert.equal(await chats.getStoredChat(doomed.chat.id), undefined);
});
