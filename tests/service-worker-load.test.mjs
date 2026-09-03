import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("the generated Firefox worker starts without browser-global errors", async () => {
  const listeners = new Map();
  const localData = {
    gmToolsDebugLoggingEnabled: true,
    openRouterPersistAuth: true,
    openRouterApiKey: "sk-or-v1-persisted-test-key",
    openRouterUserId: "user-1",
  };
  const sessionData = {};
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
          set: async (values) => Object.assign(localData, values),
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
    fetch,
    setTimeout,
    clearTimeout,
  };

  const source = await readFile("extension-firefox/service-worker.js", "utf8");
  vm.runInNewContext(source, sandbox);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sessionData.openRouterApiKey, localData.openRouterApiKey);
  assert.ok(listeners.get("message")?.length > 0);
  assert.ok(listeners.get("connect")?.length > 0);

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
  await new Promise((resolve) => setImmediate(resolve));
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    debugLabels.some((label) =>
      label.includes("Late Roll20 result received after timeout"),
    ),
  );
  assert.deepEqual(sessionData.gmToolsRoll20TimeoutTombstones, []);
});
