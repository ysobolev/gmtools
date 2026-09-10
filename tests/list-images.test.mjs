import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { build } from "esbuild";
import { streamText, toUIMessageStream } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

globalThis.chrome = { runtime: { sendMessage: async () => undefined } };
async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { createListImagesTool, ImageStorageBarrier } = await bundle("src/extension/list-images.ts");
const chats = await bundle("src/extension/chat-store.ts");
const images = await bundle("src/extension/chat-images.ts");
const normalization = await bundle("src/extension/chat-image-normalization.ts");
const execution = { toolCallId: "list-1", messages: [] };

async function save(chatId, id) {
  const stored = await chats.saveChatImageBlob(chatId, { id, filename: "image.png", mediaType: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) });
  return { imageId: stored.id, filename: stored.filename, mediaType: stored.mediaType, size: stored.size };
}

test("lists only referenced images in this chat, without bytes, with pagination and turn markers", async () => {
  const { chat } = await chats.createChat("general-gm");
  const other = await chats.createChat("general-gm");
  const upload = images.createUploadedImagePart(await save(chat.id, "upload"));
  const previous = images.createGeneratedImagePart(await save(chat.id, "previous"));
  const current = images.createGeneratedImagePart(await save(chat.id, "current"));
  const missing = images.createGeneratedImagePart({ ...current.data, imageId: "missing" });
  const foreign = images.createGeneratedImagePart(await save(other.chat.id, "foreign"));
  await save(chat.id, "unsent-draft");
  const tool = createListImagesTool({ chatId: chat.id, historyParts: () => [upload, previous, missing, foreign], currentTurnParts: () => [current], waitForImages: async () => undefined });
  const result = await tool.execute({}, execution);
  assert.equal(result.total, 3);
  assert.equal(result.images[0].imageId, "current");
  assert.equal(result.images[0].generatedThisTurn, true);
  assert.equal(result.images.find(image => image.imageId === "previous").generatedThisTurn, false);
  assert.equal(result.images.find(image => image.imageId === "upload").source, "uploaded");
  assert.doesNotMatch(JSON.stringify(result), /blob|base64|unsent-draft|foreign|missing/);
  const first = await tool.execute({ limit: 1, offset: null }, execution);
  assert.equal(first.nextOffset, 1);
  assert.equal((await tool.execute({ offset: 1, limit: 2 }, execution)).images.length, 2);
  assert.deepEqual((await tool.execute({ offset: 100 }, execution)).images, []);
});

test("image barrier handles either arrival order, multiple steps, failure, and abort", async () => {
  const barrier = new ImageStorageBarrier();
  barrier.complete();
  barrier.expect(1);
  await barrier.wait();
  barrier.expect(2);
  let resolved = false;
  const waiting = barrier.wait().then(() => { resolved = true; });
  barrier.complete();
  await Promise.resolve();
  assert.equal(resolved, false);
  barrier.complete();
  await waiting;
  const failed = new ImageStorageBarrier();
  failed.expect(1);
  const failure = assert.rejects(failed.wait(), /storage failed/);
  failed.fail(new Error("storage failed"));
  await failure;
  const aborted = new ImageStorageBarrier();
  aborted.expect(1);
  const controller = new AbortController();
  const abort = assert.rejects(aborted.wait(controller.signal), /cancelled/);
  controller.abort(new Error("cancelled"));
  await abort;
});

test("real SDK list_images waits for same-response image normalization, even with tool call before file", { timeout: 5000 }, async () => {
  const { chat } = await chats.createChat("general-gm");
  const barrier = new ImageStorageBarrier();
  const chunks = [];
  const tools = { list_images: createListImagesTool({ chatId: chat.id, historyParts: () => [], currentTurnParts: () => chunks, waitForImages: signal => barrier.wait(signal) }) };
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: "list-now", toolName: "list_images", input: "{}" },
    { type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array([1, 2, 3]) } },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
  ]) }) });
  const result = streamText({ model, prompt: "Generate and list an image", tools, onLanguageModelCallEnd: event => barrier.expect(event.content.filter(part => part.type === "file").length) });
  const budget = normalization.createGeneratedImageBudget();
  for await (const raw of toUIMessageStream({ stream: result.stream, tools })) {
    const chunk = await normalization.normalizeGeneratedImageChunk(raw, budget, async generated => {
      await new Promise(resolve => setTimeout(resolve, 20));
      const stored = await chats.saveChatImageBlob(chat.id, { id: generated.imageId, filename: generated.filename, mediaType: generated.mediaType, blob: new Blob([generated.bytes]) });
      return { imageId: stored.id, filename: stored.filename, mediaType: stored.mediaType, size: stored.size };
    }, () => "generated:same-turn");
    chunks.push(chunk);
    if (raw.type === "file") barrier.complete();
  }
  const output = chunks.find(chunk => chunk.type === "tool-output-available");
  assert.equal(output.output.images[0].imageId, "generated:same-turn");
  assert.equal(output.output.images[0].generatedThisTurn, true);
  assert.equal(chunks.filter(chunk => chunk.type === "data-generated-image").length, 1);
});
