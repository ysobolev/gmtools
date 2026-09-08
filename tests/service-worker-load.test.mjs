import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";

test("the generated Firefox worker starts without browser-global errors", async () => {
  const listeners = new Map();
  const localData = {
    openRouterPersistAuth: true,
    openRouterApiKey: "sk-or-v1-persisted-test-key",
    openRouterUserId: "user-1",
  };
  const sessionData = {};
  let persistentWriteGate = null;
  let persistentWriteStarted = null;
  const getStored = (data, keys) => {
    const requested = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(
      requested
        .filter((key) => key in data)
        .map((key) => [key, data[key]]),
    );
  };
  const removeStored = (data, keys) => {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      delete data[key];
    }
  };
  const event = (name) => ({
    addListener(listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
  });
  const debugLabels = [];
  let keyVerification = async () => Response.json({
    data: { label: "Beta test", limit_remaining: 10 },
  });
  const contextMenuItems = new Map();
  const badgeTexts = [];
  const testIndexedDB = new IDBFactory();
  const database = await new Promise((resolve, reject) => {
    const request = testIndexedDB.open("gmToolsChats", 4);
    request.onupgradeneeded = () => {
      const chats = request.result.createObjectStore("chats", {
        keyPath: "id",
      });
      chats.createIndex("updatedAt", "updatedAt");
      chats.createIndex("profileId", "profileId");
      request.result.createObjectStore("messages", { keyPath: "chatId" });
      const images = request.result.createObjectStore("images", {
        keyPath: "id",
      });
      images.createIndex("chatId", "chatId");
      request.result.createObjectStore("profiles", { keyPath: "id" });
      request.result.createObjectStore("settings", { keyPath: "id" });
      const approvals = request.result.createObjectStore("roll20Approvals", {
        keyPath: ["chatId", "approvalId"],
      });
      approvals.createIndex("chatId", "chatId");
      approvals.createIndex("chatToolCall", ["chatId", "toolCallId"], {
        unique: true,
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({
      id: "global",
      displayTheme: "system",
      debugLoggingEnabled: true,
      maximumSteps: 24,
      unrestrictedWebFetchEnabled: false,
      webSearchEnabled: false,
      requireRoll20Approval: false,
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const sandbox = {
    AbortController,
    Blob,
    DOMException,
    Error,
    EventSource: class {},
    FormData,
    Headers,
    ReadableStream,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    TransformStream,
    URL,
    URLSearchParams,
    WritableStream,
    btoa,
    chrome: {
      action: {
        onClicked: event("action-clicked"),
        setBadgeBackgroundColor: async () => undefined,
        setBadgeText: async ({ text }) => badgeTexts.push(text),
      },
      contextMenus: {
        create: (item, callback) => {
          contextMenuItems.set(item.id, item);
          callback?.();
        },
        onClicked: event("context-menu-clicked"),
        remove: (id, callback) => {
          contextMenuItems.delete(id);
          callback?.();
        },
        update: (id, changes, callback) => {
          const item = contextMenuItems.get(id);
          if (item) contextMenuItems.set(id, { ...item, ...changes });
          callback?.();
        },
      },
      identity: {},
      runtime: {
        id: "extension-id",
        getURL: (path) => `moz-extension://extension-id/${path}`,
        onConnect: event("connect"),
        onInstalled: event("installed"),
        onMessage: event("message"),
        onStartup: event("startup"),
        sendMessage: async () => undefined,
      },
      sidebarAction: {
        open: async () => undefined,
      },
      tabs: {
        onRemoved: event("tab-removed"),
        onUpdated: event("tab-updated"),
      },
      storage: {
        local: {
          get: async (keys) => getStored(localData, keys),
          remove: async (keys) => removeStored(localData, keys),
          set: async (values) => {
            if (
              persistentWriteGate &&
              values.openRouterPersistAuth === true
            ) {
              persistentWriteStarted?.();
              await persistentWriteGate;
            }
            Object.assign(localData, values);
          },
        },
        session: {
          get: async (keys) => getStored(sessionData, keys),
          remove: async (keys) => removeStored(sessionData, keys),
          set: async (values) => Object.assign(sessionData, values),
        },
      },
    },
    console: {
      ...console,
      groupCollapsed: (label) => debugLabels.push(label),
      groupEnd: () => undefined,
      log: () => undefined,
    },
    crypto,
    fetch: (...args) => keyVerification(...args),
    indexedDB: testIndexedDB,
    setTimeout,
    clearTimeout,
  };

  const source = await readFile("generated/firefox/service-worker.js", "utf8");
  vm.runInNewContext(source, sandbox);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sessionData.openRouterApiKey, localData.openRouterApiKey);
  assert.ok(listeners.get("message")?.length > 0);
  assert.ok(listeners.get("connect")?.length > 0);
  assert.equal(badgeTexts.at(-1), "");

  for (const listener of listeners.get("installed")) listener();
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextMenuItems.get("gmtools-stop-all-tasks"))),
    {
      id: "gmtools-stop-all-tasks",
      title: "Stop all tasks",
      contexts: ["action"],
      enabled: false,
    },
  );

  const optionsSender = {
    id: "extension-id",
    origin: "moz-extension://extension-id",
    tab: { id: 42 },
  };
  const activitiesResponse = await new Promise((resolve) => {
    for (const listener of listeners.get("message")) {
      listener(
        { type: "GMTOOLS_CHAT_ACTIVITIES" },
        optionsSender,
        resolve,
      );
    }
  });
  assert.equal(activitiesResponse.ok, true);
  assert.equal(activitiesResponse.activities.length, 0);

  const statusResponse = await new Promise((resolve) => {
    for (const listener of listeners.get("message")) {
      listener({ type: "GMTOOLS_AUTH_STATUS" }, optionsSender, resolve);
    }
  });
  assert.equal(statusResponse.ok, true);
  assert.equal(statusResponse.status.connected, true);
  assert.equal(statusResponse.status.persistent, true);

  const logoutResponse = await new Promise((resolve) => {
    const message = { type: "GMTOOLS_AUTH_DISCONNECT" };
    for (const listener of listeners.get("message")) {
      listener(message, optionsSender, resolve);
    }
  });
  assert.equal(logoutResponse.ok, true);
  assert.equal(logoutResponse.status.connected, false);
  assert.equal(logoutResponse.status.persistent, false);
  assert.equal("openRouterApiKey" in sessionData, false);
  assert.equal("openRouterApiKey" in localData, false);
  assert.equal("openRouterPersistAuth" in localData, false);

  sessionData.openRouterApiKey = "sk-or-v1-race-test-key";
  let releasePersistentWrite;
  persistentWriteGate = new Promise((resolve) => {
    releasePersistentWrite = resolve;
  });
  const writeStarted = new Promise((resolve) => {
    persistentWriteStarted = resolve;
  });
  const persistenceResponse = new Promise((resolve) => {
    for (const listener of listeners.get("message")) {
      listener(
        { type: "GMTOOLS_AUTH_PERSISTENCE", enabled: true },
        optionsSender,
        resolve,
      );
    }
  });
  await writeStarted;
  const overlappingLogoutResponse = new Promise((resolve) => {
    for (const listener of listeners.get("message")) {
      listener(
        { type: "GMTOOLS_AUTH_DISCONNECT" },
        optionsSender,
        resolve,
      );
    }
  });
  releasePersistentWrite();
  await persistenceResponse;
  const overlappingLogout = await overlappingLogoutResponse;
  assert.equal(overlappingLogout.ok, true);
  assert.equal(overlappingLogout.status.connected, false);
  assert.equal(overlappingLogout.status.persistent, false);
  assert.equal("openRouterApiKey" in sessionData, false);
  assert.equal("openRouterApiKey" in localData, false);
  assert.equal("openRouterPersistAuth" in localData, false);
  persistentWriteGate = null;
  persistentWriteStarted = null;

  const authRequest = (message) => new Promise((resolve) => {
    for (const listener of listeners.get("message")) {
      listener(message, optionsSender, resolve);
    }
  });
  sessionData.openRouterUserId = "old-oauth-user";
  localData.openRouterUserId = "old-oauth-user";
  const pastedKey = "sk-or-v1-beta-test-key";
  const connected = await authRequest({
    type: "GMTOOLS_AUTH_API_KEY", apiKey: ` ${pastedKey} `, persistent: false,
  });
  assert.equal(connected.ok, true);
  assert.equal(connected.status.connected, true);
  assert.equal(connected.status.userId, undefined);
  assert.equal(connected.status.keyLabel, "Beta test");
  assert.equal(sessionData.openRouterApiKey, pastedKey);
  assert.equal(localData.openRouterApiKey, undefined);
  assert.equal(sessionData.openRouterUserId, undefined);
  assert.equal(localData.openRouterUserId, undefined);
  assert.equal(JSON.stringify(connected).includes(pastedKey), false);

  await authRequest({ type: "GMTOOLS_AUTH_PERSISTENCE", enabled: true });
  assert.equal(localData.openRouterApiKey, pastedKey);
  await authRequest({ type: "GMTOOLS_AUTH_DISCONNECT" });
  assert.equal(localData.openRouterApiKey, undefined);
  assert.equal(sessionData.openRouterApiKey, undefined);
  const persistedKey = await authRequest({
    type: "GMTOOLS_AUTH_API_KEY", apiKey: pastedKey, persistent: true,
  });
  assert.equal(persistedKey.status.persistent, true);
  assert.equal(localData.openRouterApiKey, pastedKey);

  keyVerification = async () => new Response("rejected", { status: 401 });
  const rejectedKey = await authRequest({
    type: "GMTOOLS_AUTH_API_KEY", apiKey: "sk-or-v1-invalid-key", persistent: false,
  });
  assert.equal(rejectedKey.ok, false);
  assert.equal(localData.openRouterApiKey, pastedKey);
  assert.equal(sessionData.openRouterApiKey, pastedKey);

  let finishVerification;
  let verificationStarted;
  const verificationGate = new Promise(resolve => { verificationStarted = resolve; });
  keyVerification = () => new Promise(resolve => {
    finishVerification = resolve;
    verificationStarted();
  });
  const pendingLogin = authRequest({
    type: "GMTOOLS_AUTH_API_KEY", apiKey: pastedKey, persistent: true,
  });
  await verificationGate;
  await authRequest({ type: "GMTOOLS_AUTH_DISCONNECT" });
  finishVerification(Response.json({ data: { label: "Beta test" } }));
  assert.equal((await pendingLogin).ok, false);
  assert.equal(sessionData.openRouterApiKey, undefined);
  assert.equal(localData.openRouterApiKey, undefined);

  const contentScriptHandled = listeners.get("message").some((listener) =>
    listener(
      { type: "GMTOOLS_AUTH_STATUS" },
      {
        id: "extension-id",
        origin: "https://app.roll20.net",
        tab: { id: 7 },
        url: "https://app.roll20.net/editor/123",
      },
      () => undefined,
    ) === true,
  );
  assert.equal(contentScriptHandled, false);

  const campaignDatabase = await new Promise((resolve, reject) => {
    const request = testIndexedDB.open("gmToolsChats", 6);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = campaignDatabase.transaction("campaigns", "readwrite");
    transaction.objectStore("campaigns").put({
      campaignId: "campaign-legacy",
      name: "AI Test (Legacy)",
      defaultProfileId: "general-gm",
      overrides: {
        unrestrictedWebFetch: "inherit",
        webSearch: "inherit",
        requireRoll20Approval: "inherit",
      },
      memoryEnabled: false,
      createdAt: 1,
      updatedAt: 1,
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  campaignDatabase.close();
  sessionData.gmToolsCampaignRoutes = {
    "campaign-legacy": { tabId: 7 },
  };
  for (const listener of listeners.get("tab-updated")) {
    listener(7, { title: "AI Test (Both) - Roll20" });
  }
  await new Promise((resolve) => setImmediate(resolve));
  const verifyCampaignDatabase = await new Promise((resolve, reject) => {
    const request = testIndexedDB.open("gmToolsChats", 6);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const campaignName = await new Promise((resolve, reject) => {
    const transaction = verifyCampaignDatabase.transaction(
      "campaigns",
      "readonly",
    );
    const request = transaction.objectStore("campaigns").get("campaign-legacy");
    request.onsuccess = () => resolve(request.result?.name);
    request.onerror = () => reject(request.error);
  });
  verifyCampaignDatabase.close();
  assert.equal(campaignName, "AI Test (Legacy)");

  for (const listener of listeners.get("message")) {
    listener(
      {
        type: "GMTOOLS_ROLL20_EXECUTE_RESPONSE",
        requestId: "deadbeef-1234",
        protocolVersion: 2,
        modVersion: "0.2.0",
        campaignId: "campaign-test",
        outcome: { ok: true, result: "unexpected" },
      },
      {
        id: "extension-id",
        tab: { id: 7, url: "https://app.roll20.net/editor/123" },
        url: "https://app.roll20.net/editor/123",
      },
      () => undefined,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(
    debugLabels.some((label) =>
      label.includes("Unmatched Roll20 result received"),
    ),
  );

  const now = Date.now();
  sessionData.gmToolsRoll20TimeoutTombstones = [
    {
      requestId: "cafebeef-1234",
      chatId: "chat-late",
      tabId: 7,
      toolCallId: "tool-late",
      dispatchedAt: now - 50_000,
      timedOutAt: now - 5_000,
      expiresAt: now + 60_000,
    },
  ];
  for (const listener of listeners.get("message")) {
    listener(
      {
        type: "GMTOOLS_ROLL20_EXECUTE_RESPONSE",
        requestId: "cafebeef-1234",
        protocolVersion: 2,
        modVersion: "0.2.0",
        campaignId: "campaign-test",
        outcome: { ok: true, result: "eventually finished" },
      },
      {
        id: "extension-id",
        tab: { id: 7, url: "https://app.roll20.net/editor/123" },
        url: "https://app.roll20.net/editor/123",
      },
      () => undefined,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(
    debugLabels.some((label) =>
      label.includes("Late Roll20 result received after timeout"),
    ),
  );
  assert.deepEqual(sessionData.gmToolsRoll20TimeoutTombstones, []);
});
