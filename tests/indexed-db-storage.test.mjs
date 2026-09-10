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

test("version 1 creates the complete schema and seeds default records", async () => {
  assert.equal(migrations.CHAT_DATABASE_VERSION, 1);
  assert.deepEqual(migrations.DATABASE_MIGRATIONS.map(migration => migration.version), [1]);
  const name = `gmtools-test-fresh-${crypto.randomUUID()}`;
  const database = await openVersion(name, migrations.CHAT_DATABASE_VERSION);
  assert.equal(database.version, 1);
  assert.deepEqual([...database.objectStoreNames], [
    "campaignMemories",
    "campaigns",
    "chats",
    "images",
    "messages",
    "profiles",
    "roll20Approvals",
    "runSnapshots",
    "settings",
  ]);

  const transaction = database.transaction(
    [...database.objectStoreNames],
    "readonly",
  );
  const schema = {
    chats: ["id", { updatedAt: "updatedAt", profileId: "profileId", campaignId: "campaignId" }],
    messages: ["chatId", {}],
    images: ["id", { chatId: "chatId" }],
    profiles: ["id", {}],
    settings: ["id", {}],
    roll20Approvals: [["chatId", "approvalId"], { chatId: "chatId", chatToolCall: ["chatId", "toolCallId"] }],
    campaigns: ["campaignId", { name: "name", defaultProfileId: "defaultProfileId" }],
    campaignMemories: ["id", { campaignId: "campaignId", campaignUpdatedAt: ["campaignId", "updatedAt"] }],
    runSnapshots: ["hash", { chatIds: "chatIds" }],
  };
  for (const [name, [keyPath, indexes]] of Object.entries(schema)) {
    const store = transaction.objectStore(name);
    assert.deepEqual(store.keyPath, keyPath);
    assert.deepEqual([...store.indexNames].sort(), Object.keys(indexes).sort());
    for (const [indexName, indexKeyPath] of Object.entries(indexes)) {
      const index = store.index(indexName);
      assert.deepEqual(index.keyPath, indexKeyPath);
      assert.equal(index.unique, name === "roll20Approvals" && indexName === "chatToolCall");
      assert.equal(index.multiEntry, name === "runSnapshots" && indexName === "chatIds");
    }
  }
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

test("reopening version 1 preserves history and edited defaults", async () => {
  const name = `gmtools-test-reopen-${crypto.randomUUID()}`;
  const original = await openVersion(name, 1);
  const messages = [{ id: "user", role: "user", parts: [{ type: "text", text: "Hello" }] }];
  const write = original.transaction(["messages", "profiles", "settings"], "readwrite");
  write.objectStore("messages").put({ chatId: "existing", messages, updatedAt: 1 });
  write.objectStore("profiles").put({ id: "general-gm", name: "Renamed General" });
  write.objectStore("settings").put({ id: "global", maximumSteps: 12 });
  await transactionComplete(write);
  original.close();
  const reopened = await openVersion(name, 1);
  const read = reopened.transaction(["messages", "profiles", "settings"], "readonly");
  const done = transactionComplete(read);
  assert.deepEqual((await requestResult(read.objectStore("messages").get("existing"))).messages, messages);
  assert.equal((await requestResult(read.objectStore("profiles").get("general-gm"))).name, "Renamed General");
  assert.equal((await requestResult(read.objectStore("settings").get("global"))).maximumSteps, 12);
  await done;
  reopened.close();
});

test("migration runner selects only versions in the upgrade interval", () => {
  const calls = [];
  // Synthetic migrations test the machinery without retaining obsolete schemas.
  const original = [...migrations.DATABASE_MIGRATIONS];
  try {
    migrations.DATABASE_MIGRATIONS.splice(0, original.length,
      ...[1, 2, 3, 4].map(version => ({ version, migrate: (db, tx) => calls.push([version, db, tx]) })));
    const database = {}, transaction = {};
    migrations.migrateDatabase(database, transaction, 1, 3);
    assert.deepEqual(calls, [[2, database, transaction], [3, database, transaction]]);
    calls.length = 0;
    migrations.migrateDatabase(database, transaction, 3, 3);
    assert.deepEqual(calls, []);
  } finally {
    migrations.DATABASE_MIGRATIONS.splice(0, migrations.DATABASE_MIGRATIONS.length, ...original);
  }
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
    modelSelection: { kind: "free" },
    additionalInstructions: "",
  };
  await profiles.saveProfile(custom, { create: true });
  assert.deepEqual(
    (await profiles.listProfiles()).find(profile => profile.id === custom.id).modelSelection,
    { kind: "free" },
  );
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
    silenceRoll20ChatNotifications: false,
    experimentalRoll20Events: false,
  });

  const updated = await preferences.updateGlobalPreferences({
    displayTheme: "dark",
    webSearchEnabled: true,
  });
  assert.equal(updated.displayTheme, "dark");
  assert.equal(updated.webSearchEnabled, true);
  assert.equal(updated.maximumSteps, 24);
  assert.equal(updated.requireRoll20Approval, false);
  await preferences.updateGlobalPreferences({ silenceRoll20ChatNotifications: true });
  await preferences.updateGlobalPreferences({ maximumSteps: 25 });
  const saved = await preferences.getGlobalPreferences();
  assert.equal(saved.silenceRoll20ChatNotifications, true);
  await preferences.updateGlobalPreferences({ experimentalRoll20Events: true });
  assert.equal((await preferences.getGlobalPreferences()).experimentalRoll20Events, true);
  assert.equal(saved.displayTheme, "dark");
  await preferences.updateGlobalPreferences({ silenceRoll20ChatNotifications: false });
  assert.equal((await preferences.getGlobalPreferences()).silenceRoll20ChatNotifications, false);
});
