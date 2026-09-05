import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";

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
