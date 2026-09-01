import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-store.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const chats = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("creates a durable chat record with stable metadata", () => {
  const chat = chats.createChatRecord("general-gm", {
    id: "chat-1",
    now: 1234,
  });
  assert.deepEqual(chat, {
    id: "chat-1",
    title: "New Chat",
    profileId: "general-gm",
    notices: [],
    createdAt: 1234,
    updatedAt: 1234,
  });
  assert.equal(chats.isChatRecord(chat), true);
});

test("rejects malformed durable chat records", () => {
  const chat = chats.createChatRecord("general-gm", {
    id: "chat-1",
    now: 1234,
  });
  assert.equal(chats.isChatRecord({ ...chat, profileId: "" }), false);
  assert.equal(chats.isChatRecord({ ...chat, notices: [{}] }), false);
  assert.equal(chats.isChatRecord({ ...chat, updatedAt: -1 }), false);
});
