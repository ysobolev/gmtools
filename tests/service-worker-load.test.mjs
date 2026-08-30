import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("the generated service worker starts without browser-global errors", async () => {
  const listeners = new Map();
  const event = (name) => ({
    addListener(listener) {
      listeners.set(name, listener);
    },
  });
  let storageRestricted = false;
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
      identity: {},
      runtime: {
        getURL: (path) => `chrome-extension://extension-id/${path}`,
        onConnect: event("connect"),
        onInstalled: event("installed"),
        onMessage: event("message"),
        onStartup: event("startup"),
        sendMessage: async () => undefined,
      },
      sidePanel: {
        setPanelBehavior: async () => undefined,
      },
      storage: {
        session: {
          setAccessLevel: async ({ accessLevel }) => {
            assert.equal(accessLevel, "TRUSTED_CONTEXTS");
            storageRestricted = true;
          },
        },
      },
    },
    console,
    crypto,
    fetch,
    setTimeout,
    clearTimeout,
  };

  const source = await readFile("extension/service-worker.js", "utf8");
  vm.runInNewContext(source, sandbox);
  await Promise.resolve();

  assert.equal(storageRestricted, true);
  assert.equal(typeof listeners.get("message"), "function");
  assert.equal(typeof listeners.get("connect"), "function");
});
