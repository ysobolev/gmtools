import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { convertToModelMessages, generateText, isStepCount, streamText, toUIMessageStream } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { createGenerateImageTool, IMAGE_GENERATION_MODEL } = await bundle("src/extension/generate-image.ts");
const { reconstructCompletedConversation, reconstructStoppedConversation } = await bundle("src/extension/chat-persistence.ts");
const { imageDataPartForModel } = await bundle("src/extension/chat-images.ts");
const response = (data = [{ b64_json: "AQID", media_type: "image/png" }]) => Response.json({ data, usage: { total_tokens: 12 } });
const context = (toolCallId = "image-1") => ({ toolCallId, messages: [] });

test("OpenRouter receives a client generation tool and text-only chat output", async () => {
  let body;
  const provider = createOpenRouter({ apiKey: "test", fetch: async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ id: "test", object: "chat.completion", created: 0, model: "test", choices: [{ index: 0, message: { role: "assistant", content: "Done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  } });
  const generation = setup();
  await generateText({ model: provider("openai/gpt-5.6-sol", { extraBody: { modalities: ["text"] } }), prompt: "Hello", tools: { generate_image: generation.tool } });
  assert.deepEqual(body.modalities, ["text"]);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].function.name, "generate_image");
  assert.doesNotMatch(JSON.stringify(body.tools), /openrouter:image_generation|list_images/);
});

function setup(overrides = {}) {
  const stored = [], requests = [], logs = [];
  const controller = new AbortController();
  const options = {
    apiKey: "test-key", headers: { "x-session-id": "chat-1", "X-Title": "GM Tools for VTT" },
    signal: controller.signal, budget: { imageCount: 0, totalBytes: 0 },
    persist: async image => {
      stored.push(image);
      return { imageId: image.imageId, filename: image.filename, mediaType: image.mediaType, size: image.bytes.length };
    },
    log: details => logs.push(details),
    fetch: async (url, init) => { requests.push({ url, ...init }); return response(); },
    ...overrides,
  };
  return { ...createGenerateImageTool(options), stored, requests, logs, controller, options };
}

test("disabled image generation cannot make a paid request or persist an image", async () => {
  const generation = setup({ enabled: false });
  await assert.rejects(generation.tool.execute({ prompt: "A forest map" }, context()), /unavailable with a free model/);
  assert.equal(generation.requests.length, 0);
  assert.equal(generation.stored.length, 0);
});

test("reports image-generation identifiers before persistence without returning them to the model", async () => {
  const observed = [];
  const generation = setup({
    fetch: async () => Response.json({ id: "gen-img-test", request_id: "req-image", model: IMAGE_GENERATION_MODEL, data: [{ b64_json: "AQID" }] }),
    onResponse: async (value, ok) => observed.push({ id: value.id, requestId: value.request_id, ok }),
  });
  const output = await generation.tool.execute({ prompt: "map" }, context());
  assert.deepEqual(observed, [{ id: "gen-img-test", requestId: "req-image", ok: true }]);
  assert.doesNotMatch(JSON.stringify(output), /gen-img-test|req-image/);
});

test("uses the fixed image endpoint, stores one image and returns only its reference", async () => {
  const generation = setup();
  const output = await generation.tool.execute({ prompt: "A square forest village map", aspectRatio: "1:1" }, context());
  assert.equal(IMAGE_GENERATION_MODEL, "openai/gpt-5-image");
  assert.equal(generation.requests.length, 1);
  assert.equal(generation.requests[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(generation.requests[0].headers.Authorization, "Bearer test-key");
  assert.equal(generation.requests[0].headers["x-session-id"], "chat-1");
  assert.deepEqual(JSON.parse(generation.requests[0].body), { model: IMAGE_GENERATION_MODEL, prompt: "A square forest village map", n: 1, aspect_ratio: "1:1" });
  assert.deepEqual([...generation.stored[0].bytes], [1, 2, 3]);
  assert.equal(output.imageId, generation.stored[0].imageId);
  assert.equal(output.size, 3);
  assert.doesNotMatch(JSON.stringify(output), /AQID|base64|bytes|test-key/);
  assert.equal(generation.logs[0].Usage.total_tokens, 12);
  assert.deepEqual(generation.takeImagePart("image-1").data, output);
  assert.equal(generation.takeImagePart("image-1"), undefined);
  assert.deepEqual(generation.options.budget, { imageCount: 1, totalBytes: 3 });
});

test("serializes generation across tool instances and cancels a queued call", async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const first = setup({ fetch: async () => { started(); await blocked; return response(); } });
  const second = setup();
  const a = first.tool.execute({ prompt: "first" }, context("first"));
  await began;
  const b = second.tool.execute({ prompt: "second" }, context("second"));
  const cancelled = assert.rejects(b, /cancelled/);
  second.controller.abort(new Error("cancelled"));
  await cancelled;
  assert.equal(second.requests.length, 0);
  release();
  await a;
  const third = setup();
  await third.tool.execute({ prompt: "third", aspectRatio: null }, context("third"));
  assert.equal(second.requests.length, 0);
  assert.equal(third.requests.length, 1);
  assert.equal(JSON.parse(third.requests[0].body).aspect_ratio, undefined);
});

test("aborts an in-flight request without saving or retrying", async () => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let attempts = 0;
  const generation = setup({ fetch: async (_url, { signal }) => {
    attempts++;
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  const work = generation.tool.execute({ prompt: "map" }, context());
  await started;
  const stopped = assert.rejects(work, /stopped/);
  generation.controller.abort(new Error("stopped"));
  await stopped;
  assert.equal(attempts, 1);
  assert.equal(generation.stored.length, 0);
});

test("rejects failed, malformed, unsupported and multiple-image responses", async () => {
  const cases = [
    [() => Response.json({ error: { message: "Insufficient credits" } }, { status: 402 }), /402.*Insufficient credits/],
    [() => response([]), /exactly one image/],
    [() => response([{ b64_json: "AQID" }, { b64_json: "AQID" }]), /exactly one image/],
    [() => response([{ b64_json: "!!!", media_type: "image/png" }]), /invalid/],
    [() => response([{ b64_json: "AQID", media_type: "image/svg\+xml" }]), /unsupported/],
    [() => { throw new TypeError("Failed to fetch"); }, /Could not reach OpenRouter/],
  ];
  for (const [makeResponse, expected] of cases) {
    let attempts = 0;
    const generation = setup({ fetch: async () => { attempts++; return makeResponse(); } });
    await assert.rejects(generation.tool.execute({ prompt: "map" }, context()), expected);
    assert.equal(attempts, 1);
    assert.equal(generation.stored.length, 0);
    assert.equal(generation.takeImagePart("image-1"), undefined);
  }
});

test("honors per-turn and per-image limits and bounds the HTTP body", async () => {
  for (const budget of [{ imageCount: 8, totalBytes: 0 }, { imageCount: 1, totalBytes: 40 * 1024 * 1024 }]) {
    const generation = setup({ budget });
    await assert.rejects(generation.tool.execute({ prompt: "map" }, context()), /limit/);
    assert.equal(generation.requests.length, 0);
  }
  let cancelled = false;
  const large = setup({ fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(large.tool.execute({ prompt: "map" }, context()), /size limit/);
  assert.equal(cancelled, true);
  assert.equal(large.stored.length, 0);
  const aggregate = setup({ budget: { imageCount: 1, totalBytes: 40 * 1024 * 1024 - 1 } });
  await assert.rejects(aggregate.tool.execute({ prompt: "map" }, context()), /40 MB limit/);
  assert.equal(aggregate.stored.length, 0);
  const oversized = setup({ fetch: async () => response([{ b64_json: "A".repeat(Math.ceil((10 * 1024 * 1024 + 3) / 3) * 4) }]) });
  await assert.rejects(oversized.tool.execute({ prompt: "map" }, context()), /10 MB size limit/);
});

test("storage errors remain tool failures and do not publish image parts", async () => {
  const generation = setup({ persist: async () => { throw new Error("Quota exceeded"); } });
  await assert.rejects(generation.tool.execute({ prompt: "map" }, context()), /could not be saved/);
  assert.equal(generation.takeImagePart("image-1"), undefined);
  assert.equal(generation.options.budget.imageCount, 0);
});

test("SDK gets generation results on the next step and errors do not end the conversation", async () => {
  for (const fail of [false, true]) {
    const generation = setup(fail ? { fetch: async () => Response.json({ error: { message: "Insufficient credits" } }, { status: 402 }) } : {});
    const tools = { generate_image: generation.tool };
    const calls = [], chunks = [];
    const model = new MockLanguageModelV4({ doStream: async options => {
      const step = calls.push(options.prompt);
      return { stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        ...(step === 1 ? [{ type: "tool-call", toolCallId: "image-1", toolName: "generate_image", input: '{"prompt":"A forest map"}' }] : [
          { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "Done" }, { type: "text-end", id: "text" },
        ]),
        { type: "finish", finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: step === 1 ? "tool_calls" : "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
      ]) };
    } });
    const result = streamText({ model, prompt: "Make a map", tools, stopWhen: isStepCount(3) });
    for await (const chunk of toUIMessageStream({ stream: result.stream, tools })) {
      chunks.push(chunk);
      if (chunk.type === "tool-output-available") {
        const imagePart = generation.takeImagePart(chunk.toolCallId);
        if (imagePart) chunks.push(imagePart);
      }
    }
    assert.equal(calls.length, 2);
    assert.equal(chunks.some(chunk => chunk.type === "error"), false);
    if (fail) {
      assert.match(JSON.stringify(calls[1]), /Insufficient credits/);
      assert.equal(chunks.some(chunk => chunk.type === "data-generated-image"), false);
    } else {
      assert.match(JSON.stringify(calls[1]), /generated:/);
      assert.match(JSON.stringify(calls[1]), /A forest map/);
      assert.doesNotMatch(JSON.stringify(calls[1]), /AQID/);
      for (const reconstruct of [reconstructCompletedConversation, reconstructStoppedConversation]) {
        const history = await reconstruct([], chunks);
        const imagePart = history.flatMap(message => message.parts).find(part => part.type === "data-generated-image");
        assert.ok(imagePart);
        const upstream = await convertToModelMessages(history, { convertDataPart: imageDataPartForModel });
        assert.match(JSON.stringify(upstream), new RegExp(imagePart.data.imageId));
        assert.match(JSON.stringify(upstream), /generate_image/);
        assert.doesNotMatch(JSON.stringify(history), /AQID|base64/);
      }
    }
  }
});
