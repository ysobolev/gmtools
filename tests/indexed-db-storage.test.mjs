import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";

globalThis.chrome = {
  runtime: {
    sendMessage: async () => undefined,
  },
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

const migrations = await bundle("src/extension/indexed-db-migrations.ts");

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openVersion(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      migrations.migrateDatabase(
        request.result,
        request.transaction,
        event.oldVersion,
        event.newVersion,
      );
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("a fresh database runs every structural migration", async () => {
  const name = `gmtools-test-fresh-${crypto.randomUUID()}`;
  const database = await openVersion(name, migrations.CHAT_DATABASE_VERSION);
  assert.deepEqual([...database.objectStoreNames], [
    "campaignMemories",
    "campaigns",
    "chats",
    "images",
    "messages",
    "profiles",
    "roll20Approvals",
    "settings",
  ]);

  const transaction = database.transaction(
    ["chats", "profiles", "settings"],
    "readonly",
  );
  assert.equal(transaction.objectStore("chats").indexNames.contains("profileId"), true);
  assert.equal(transaction.objectStore("chats").indexNames.contains("campaignId"), true);
  assert.equal(
    (await requestResult(transaction.objectStore("profiles").get("general-gm"))).name,
    "General",
  );
  assert.equal(
    (await requestResult(transaction.objectStore("settings").get("global"))).maximumSteps,
    24,
  );
  await transactionComplete(transaction);
  database.close();
});

test("upgrading version 5 creates memory storage and disables it for existing campaigns", async () => {
  const name = `gmtools-test-memory-upgrade-${crypto.randomUUID()}`;
  let database = await openVersion(name, 5);
  let transaction = database.transaction("campaigns", "readwrite");
  transaction.objectStore("campaigns").add({
    campaignId: "campaign-1",
    name: "Existing campaign",
    defaultProfileId: "general-gm",
    overrides: {
      unrestrictedWebFetch: "inherit",
      webSearch: "inherit",
      requireRoll20Approval: "inherit",
    },
    createdAt: 1,
    updatedAt: 1,
  });
  await transactionComplete(transaction);
  database.close();

  database = await openVersion(name, migrations.CHAT_DATABASE_VERSION);
  transaction = database.transaction(["campaigns", "campaignMemories"], "readonly");
  assert.equal(
    (await requestResult(transaction.objectStore("campaigns").get("campaign-1"))).memoryEnabled,
    false,
  );
  assert.equal(
    transaction.objectStore("campaignMemories").indexNames.contains("campaignId"),
    true,
  );
  assert.equal(
    transaction.objectStore("campaignMemories").indexNames.contains("campaignUpdatedAt"),
    true,
  );
  await transactionComplete(transaction);
  database.close();
});

test("upgrading version 2 preserves existing chat and image data", async () => {
  const name = `gmtools-test-upgrade-${crypto.randomUUID()}`;
  let database = await openVersion(name, 2);
  let transaction = database.transaction(["chats", "images"], "readwrite");
  transaction.objectStore("chats").add({
    id: "chat-1",
    title: "Existing chat",
    profileId: "general-gm",
    notices: [],
    createdAt: 1,
    updatedAt: 1,
  });
  transaction.objectStore("images").add({
    id: "image-1",
    chatId: "chat-1",
    filename: "map.png",
    mediaType: "image/png",
    size: 0,
    blob: new Blob([], { type: "image/png" }),
    createdAt: 1,
  });
  await transactionComplete(transaction);
  database.close();

  database = await openVersion(name, migrations.CHAT_DATABASE_VERSION);
  transaction = database.transaction(["chats", "images"], "readonly");
  assert.equal(
    (await requestResult(transaction.objectStore("chats").get("chat-1"))).title,
    "Existing chat",
  );
  assert.equal(
    (await requestResult(transaction.objectStore("images").get("image-1"))).filename,
    "map.png",
  );
  await transactionComplete(transaction);
  database.close();
});

test("profile deletion reassigns chats to General atomically", async () => {
  await requestResult(indexedDB.deleteDatabase(migrations.CHAT_DATABASE_NAME));
  const [profiles, chats, campaigns] = await Promise.all([
    bundle("src/extension/profile-store.ts"),
    bundle("src/extension/chat-store.ts"),
    bundle("src/extension/campaign-store.ts"),
  ]);
  const custom = {
    id: "custom-profile",
    name: "Custom",
    rulesetId: "custom",
    modelSelection: { kind: "recommended" },
    additionalInstructions: "",
  };
  await profiles.saveProfile(custom, { create: true });
  const created = await chats.createChat(custom.id);
  await chats.saveChatMessages(created.chat.id, [
    { id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] },
  ]);
  await campaigns.attachChatToCampaign(created.chat.id, {
    campaignId: "profile-campaign",
    name: "Profile campaign",
    modVersion: "0.2.0",
  });
  await campaigns.updateCampaignConfiguration("profile-campaign", {
    defaultProfileId: custom.id,
  });

  assert.deepEqual(await profiles.getProfileDeletionImpact(custom.id), {
    chatCount: 1,
    campaignCount: 1,
  });

  await profiles.deleteProfile(custom.id);

  assert.equal(await profiles.getProfile(custom.id), undefined);
  const updated = await chats.getChat(created.chat.id);
  assert.equal(updated.profileId, "general-gm");
  assert.equal(updated.notices.length, 1);
  assert.match(updated.notices[0].text, /now uses General/);
  assert.equal(
    (await campaigns.getCampaign("profile-campaign")).defaultProfileId,
    "general-gm",
  );
});

test("global preference updates preserve defaults and other fields", async () => {
  const preferences = await bundle("src/extension/preferences-store.ts");
  assert.deepEqual(await preferences.getGlobalPreferences(), {
    id: "global",
    displayTheme: "system",
    debugLoggingEnabled: false,
    maximumSteps: 24,
    unrestrictedWebFetchEnabled: false,
    webSearchEnabled: false,
    requireRoll20Approval: false,
  });

  const updated = await preferences.updateGlobalPreferences({
    displayTheme: "dark",
    webSearchEnabled: true,
  });
  assert.equal(updated.displayTheme, "dark");
  assert.equal(updated.webSearchEnabled, true);
  assert.equal(updated.maximumSteps, 24);
  assert.equal(updated.requireRoll20Approval, false);
});
