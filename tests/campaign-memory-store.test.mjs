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

const [campaigns, chats, memories] = await Promise.all([
  bundle("src/extension/campaign-store.ts"),
  bundle("src/extension/chat-store.ts"),
  bundle("src/extension/campaign-memory-store.ts"),
]);

async function createEnabledCampaign(campaignId, name = campaignId) {
  const chat = await chats.createChat("general-gm");
  await campaigns.attachChatToCampaign(chat.chat.id, {
    campaignId,
    name,
    modVersion: "0.2.0",
  });
  await campaigns.updateCampaignConfiguration(campaignId, {
    memoryEnabled: true,
  });
  return chat.chat.id;
}

test("stores, deduplicates, searches, updates, and deletes campaign memories", async () => {
  await createEnabledCampaign("memory-campaign-1");
  await assert.rejects(
    memories.createCampaignMemory("memory-campaign-1", "   "),
    /blank/,
  );
  await assert.rejects(
    memories.createCampaignMemory("memory-campaign-1", "x".repeat(4001)),
    /4000 characters/,
  );
  const first = await memories.createCampaignMemory(
    "memory-campaign-1",
    "Lady Veyra distrusts the city watch.",
  );
  assert.equal(first.created, true);
  const duplicate = await memories.createCampaignMemory(
    "memory-campaign-1",
    "  lady veyra   distrusts the city watch.  ",
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.memory.id, first.memory.id);

  await memories.createCampaignMemory(
    "memory-campaign-1",
    "The ruined chapel conceals a crypt entrance.",
  );
  const results = await memories.searchCampaignMemories(
    "memory-campaign-1",
    "Where is the crypt entrance?",
  );
  assert.equal(results.length, 1);
  assert.match(results[0].content, /chapel/);
  assert.equal(
    (await memories.searchCampaignMemories(
      "memory-campaign-1",
      "city chapel",
      1,
    )).length,
    1,
  );

  const updated = await memories.updateCampaignMemory(
    "memory-campaign-1",
    first.memory.id,
    "Lady Veyra now trusts the city watch.",
  );
  assert.match(updated.content, /now trusts/);
  const deleted = await memories.deleteCampaignMemory(
    "memory-campaign-1",
    first.memory.id,
  );
  assert.equal(deleted.content, "Lady Veyra now trusts the city watch.");
  assert.equal(await memories.countCampaignMemories("memory-campaign-1"), 1);
});

test("isolates memories by campaign and enforces enabled state", async () => {
  await createEnabledCampaign("memory-campaign-2");
  await createEnabledCampaign("memory-campaign-3");
  const stored = await memories.createCampaignMemory(
    "memory-campaign-2",
    "Campaign two has a silver dragon patron.",
  );
  assert.deepEqual(
    await memories.searchCampaignMemories("memory-campaign-3", "silver dragon"),
    [],
  );
  await assert.rejects(
    memories.updateCampaignMemory(
      "memory-campaign-3",
      stored.memory.id,
      "Cross-campaign edit",
    ),
    /not found/,
  );

  await campaigns.updateCampaignConfiguration("memory-campaign-2", {
    memoryEnabled: false,
  });
  await assert.rejects(
    memories.searchCampaignMemories("memory-campaign-2", "dragon"),
    /disabled/,
  );
  assert.equal((await memories.listCampaignMemories("memory-campaign-2")).length, 1);
  await memories.deleteCampaignMemory(
    "memory-campaign-2",
    stored.memory.id,
    false,
  );
});

test("campaign deletion removes memories while chat deletion does not", async () => {
  const chatId = await createEnabledCampaign("memory-campaign-4");
  await memories.createCampaignMemory("memory-campaign-4", "Persistent campaign fact.");
  await chats.deleteChat(chatId);
  assert.equal(await memories.countCampaignMemories("memory-campaign-4"), 1);

  await campaigns.deleteCampaign("memory-campaign-4", "detach-chats");
  assert.equal(await memories.countCampaignMemories("memory-campaign-4"), 0);
});
