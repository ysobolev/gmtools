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

test("normalizes chat titles for storage", () => {
  assert.equal(
    chats.createChatRecord("general-gm", {
      id: "chat-1",
      now: 1234,
      title: "  Session planning  ",
    }).title,
    "Session planning",
  );
  assert.equal(
    chats.createChatRecord("general-gm", {
      id: "chat-2",
      now: 1234,
      title: "x".repeat(chats.MAX_CHAT_TITLE_LENGTH + 10),
    }).title.length,
    chats.MAX_CHAT_TITLE_LENGTH,
  );
});

test("rejects malformed durable chat records", () => {
  const chat = chats.createChatRecord("general-gm", {
    id: "chat-1",
    now: 1234,
  });
  assert.equal(chats.isChatRecord({ ...chat, profileId: "" }), false);
  assert.equal(chats.isChatRecord({ ...chat, notices: [{}] }), false);
  assert.equal(chats.isChatRecord({ ...chat, updatedAt: -1 }), false);
  assert.equal(
    chats.isChatRecord({ ...chat, pendingRoll20Approvals: 2 }),
    true,
  );
  assert.equal(
    chats.isChatRecord({ ...chat, pendingRoll20Approvals: 0 }),
    false,
  );
  assert.equal(
    chats.isChatRecord({
      ...chat,
      continuation: {
        reason: "step-limit",
        afterMessageId: "assistant-1",
        stepLimit: 24,
        createdAt: 2345,
      },
    }),
    true,
  );
  assert.equal(
    chats.isChatRecord({
      ...chat,
      continuation: {
        reason: "step-limit",
        afterMessageId: "",
        stepLimit: 24,
        createdAt: 2345,
      },
    }),
    false,
  );
  assert.equal(
    chats.isChatRecord({
      ...chat,
      continuation: {
        reason: "stream-error",
        afterMessageId: "assistant-2",
        createdAt: 3456,
      },
    }),
    true,
  );
});
