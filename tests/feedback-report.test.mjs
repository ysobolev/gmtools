import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";

globalThis.chrome = { runtime: { sendMessage: async () => undefined } };

async function bundle(entryPoint) {
  const { outputFiles } = await build({ entryPoints: [entryPoint], bundle: true,
    format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [reports, chats, runs, database] = await Promise.all([
  bundle("src/extension/feedback-report.ts"),
  bundle("src/extension/chat-store.ts"),
  bundle("src/extension/run-snapshot-store.ts"),
  bundle("src/extension/database.ts"),
]);
const extension = { version: "0.2.0", buildId: "feedback-test", browser: "Chrome" };
const { feedbackReportSchema } = await bundle("src/feedback-schema.ts");
const options = {
  feedback: " Initiative is incorrect. ", includeChat: true, includeImages: false,
  chatId: "", visibleError: "Account needs additional credit", runningWhenOpened: false,
  extension,
};

test("feedback-only export contains no chat, error, campaign, or snapshots", async () => {
  const report = await reports.createFeedbackReport({ ...options, chatId: "nonexistent",
    includeChat: false, includeImages: true });
  assert.equal(report.format, "gmtools-feedback");
  assert.equal(feedbackReportSchema.safeParse(report).success, true);
  assert.equal(report.feedback, "Initiative is incorrect.");
  assert.deepEqual(report.includes, { chat: false, images: false });
  assert.deepEqual(Object.keys(report).sort(), [
    "exportedAt", "extension", "feedback", "format", "formatVersion", "includes", "reportId",
  ]);
  await assert.rejects(reports.createFeedbackReport({ ...options, feedback: "  " }), /describe your feedback/);
  await assert.rejects(reports.createFeedbackReport(options), /no longer exists/);
});

test("exports the selected saved history, snapshots, and only opted-in referenced images", async () => {
  const a = await chats.createChat("general-gm");
  const b = await chats.createChat("general-gm");
  const bytes = Uint8Array.from({ length: 100_001 }, (_, i) => i % 256);
  const image = await chats.saveChatImageBlob(a.chat.id, {
    id: "report-image", filename: "map.png", mediaType: "image/png",
    blob: new Blob([bytes], { type: "image/png" }),
  });
  await chats.saveChatImageBlob(a.chat.id, {
    id: "unsent-image", filename: "unsent.png", mediaType: "image/png",
    blob: new Blob(["private unsent image"], { type: "image/png" }),
  });
  const foreign = await chats.saveChatImageBlob(b.chat.id, {
    id: "other-chat-image", filename: "private.png", mediaType: "image/png",
    blob: new Blob(["another chat"], { type: "image/png" }),
  });
  const imagePart = (id) => ({ type: "data-uploaded-image", id,
    data: { imageId: id, filename: "image.png", mediaType: "image/png", size: 1 } });
  const input = [{ id: "user-1", role: "user", parts: [
    { type: "text", text: "Make this NPC" }, imagePart(image.id),
  ] }];
  const snapshot = { formatVersion: 1, system: "Original prompt", modelId: "test/model",
    profile: { id: "profile-1", name: "NPC builder" },
    campaign: { id: "original-campaign", name: "Original campaign" } };
  let messages = await runs.recordRunSubmission(a.chat.id, input, snapshot);
  const hash = messages[0].metadata.gmToolsSubmissions[0].snapshotHash;
  await runs.recordRunSubmission(b.chat.id, input, snapshot);
  const assistant = { id: "assistant-1", role: "assistant", parts: [
    { type: "text", text: "Created" },
    { type: "tool-view_image", output: { imageId: image.id } },
    imagePart("missing-image"), imagePart(foreign.id),
    { type: "file", mediaType: "image/png", url: "data:image/png;base64,cGl4ZWxz" },
  ] };
  await chats.saveChatMessages(a.chat.id, [...messages, assistant]);
  const noImages = await reports.createFeedbackReport({ ...options, chatId: a.chat.id });
  assert.equal(feedbackReportSchema.safeParse(noImages).success, true);
  assert.equal(noImages.conversation.chat.id, a.chat.id);
  assert.equal(noImages.conversation.visibleError, options.visibleError);
  assert.equal(noImages.conversation.historySource, "indexeddb");
  assert.equal(noImages.conversation.snapshots.length, 1);
  assert.deepEqual(noImages.conversation.snapshots[0], { hash, snapshot });
  assert.equal(JSON.stringify(noImages).includes(b.chat.id), false);
  assert.deepEqual(noImages.conversation.images, []);
  assert.equal(JSON.stringify(noImages).includes("data:image/png;base64"), false);
  assert.equal(JSON.stringify(noImages).includes("unsent.png"), false);

  const withImages = await reports.createFeedbackReport({ ...options, chatId: a.chat.id, includeImages: true });
  assert.equal(feedbackReportSchema.safeParse(withImages).success, true);
  assert.equal(withImages.conversation.images.length, 1);
  assert.equal(withImages.conversation.images[0].filename, image.filename);
  assert.deepEqual(Buffer.from(withImages.conversation.images[0].data, "base64"), Buffer.from(bytes));
  assert.deepEqual(withImages.conversation.missingImageIds, ["missing-image", foreign.id]);
  assert.equal(JSON.stringify(withImages).includes("unsent.png"), false);

  // Missing snapshots are disclosed rather than silently replaced by today's profile.
  const db = await database.openDatabase();
  const tx = db.transaction("runSnapshots", "readwrite");
  tx.objectStore("runSnapshots").delete(hash);
  await database.transactionComplete(tx);
  const missing = await reports.createFeedbackReport({ ...options, chatId: a.chat.id });
  assert.deepEqual(missing.conversation.missingSnapshotHashes, [hash]);
  assert.equal(missing.conversation.snapshots.length, 0);
  // Export must never write its image redaction back into history.
  messages = (await chats.getStoredChat(a.chat.id)).messages;
  assert.equal(messages[1].parts.at(-1).url, "data:image/png;base64,cGl4ZWxz");
  await chats.deleteChat(a.chat.id);
  await chats.deleteChat(b.chat.id);
});

test("image-byte omission handles nested legacy tool content without removing references", () => {
  assert.deepEqual(reports.omitInlineImageBytes({
    imageId: "local-id", output: [{ type: "file", mediaType: "image/png",
      data: { type: "data", data: "BASE64" } }],
    url: "https://files.d20.io/image.png",
  }), {
    imageId: "local-id", output: [{ type: "file", mediaType: "image/png",
      data: "[Image bytes omitted from feedback export]" }],
    url: "https://files.d20.io/image.png",
  });
});
