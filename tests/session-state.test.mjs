import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const sessionData = {};
globalThis.chrome = {
  storage: {
    session: {
      get: async (key) => ({ [key]: sessionData[key] }),
      set: async (values) => Object.assign(sessionData, values),
    },
  },
};

const { outputFiles } = await build({
  entryPoints: ["src/extension/session-state.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const sessionState = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("the active chat is kept in session storage", async () => {
  assert.equal(await sessionState.getActiveChatId(), undefined);
  await sessionState.setActiveChatId("chat-1");
  assert.equal(await sessionState.getActiveChatId(), "chat-1");

  sessionData[sessionState.ACTIVE_CHAT_SESSION_KEY] = 42;
  assert.equal(await sessionState.getActiveChatId(), undefined);
});
