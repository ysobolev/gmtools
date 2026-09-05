import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs } from "ai";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/remote-image-view.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const remoteImageView = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("allows files.d20.io remote image URLs by default", () => {
  assert.equal(
    remoteImageView.normalizeRemoteImageUrl(
      " https://files.d20.io/images/map.webp?version=1 ",
    ),
    "https://files.d20.io/images/map.webp?version=1",
  );
});

test("allows other HTTP and HTTPS hosts only in unrestricted mode", () => {
  assert.throws(
    () => remoteImageView.normalizeRemoteImageUrl("https://example.com/map.png"),
    /requires enabling Allow web fetching/,
  );
  assert.equal(
    remoteImageView.normalizeRemoteImageUrl(
      "http://example.com/map.png",
      true,
    ),
    "http://example.com/map.png",
  );
});

test("rejects unsafe remote image URL forms", () => {
  for (const value of [
    "data:image/png;base64,AAAA",
    "file:///tmp/map.png",
    "javascript:alert(1)",
    "https://user:password@example.com/map.png",
    "not a URL",
  ]) {
    assert.throws(() => remoteImageView.normalizeRemoteImageUrl(value));
  }
});

test("returns a remote image file part to the model", async () => {
  const imageTool = remoteImageView.createViewRemoteImageTool();
  const output = await imageTool.execute({
    url: "https://files.d20.io/images/map.webp",
  });
  assert.deepEqual(output, {
    url: "https://files.d20.io/images/map.webp",
  });

  const modelOutput = imageTool.toModelOutput({ output });
  assert.equal(modelOutput.type, "content");
  assert.equal(modelOutput.value[1].type, "file");
  assert.equal(modelOutput.value[1].mediaType, "image/jpeg");
  assert.equal(
    modelOutput.value[1].data.url.toString(),
    "https://files.d20.io/images/map.webp",
  );
});

test("the tool enforces its configured domain access", async () => {
  const restrictedTool = remoteImageView.createViewRemoteImageTool();
  await assert.rejects(
    restrictedTool.execute({ url: "https://example.com/map.png" }),
    /requires enabling Allow web fetching/,
  );

  const unrestrictedTool = remoteImageView.createViewRemoteImageTool(true);
  assert.deepEqual(
    await unrestrictedTool.execute({ url: "https://example.com/map.png" }),
    { url: "https://example.com/map.png" },
  );
});

test("accepts image extensions case-insensitively with queries and fragments", () => {
  for (const extension of ["jpg", "JPEG", "png", "GIF", "webp"]) {
    const url = `https://files.d20.io/images/map.${extension}?token=abc#preview`;
    assert.equal(remoteImageView.normalizeRemoteImageUrl(url), url);
  }
});

test("rejects webpage and extensionless URLs inside tool execution", async () => {
  const imageTool = remoteImageView.createViewRemoteImageTool(true);
  for (const url of [
    "https://www.reddit.com/r/DnDHomebrew/comments/oh4bo9/asmodeus_stat_block/",
    "https://example.com/image",
    "https://example.com/page?image=map.png",
    "https://example.com/page#map.png",
    "https://example.com/map.webp/",
    "https://example.com/map.svg",
  ]) {
    await assert.rejects(imageTool.execute({ url }), /requires a direct image URL/);
  }
});

for (const invalidUrl of [false, true]) {
test(invalidUrl
  ? "returns a rejected URL as a tool error and lets the model continue"
  : "serializes the remote URL as image input on the next model step", async () => {
  const requestBodies = [];
  const openrouter = createOpenRouter({
    apiKey: "test-key",
    compatibility: "strict",
    fetch: async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      const firstCall = requestBodies.length === 1;
      return new Response(
        JSON.stringify({
          id: `generation-${requestBodies.length}`,
          object: "chat.completion",
          created: 0,
          model: "openai/gpt-5.2",
          choices: [{
            index: 0,
            message: firstCall
              ? {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call-view-image",
                  type: "function",
                  function: {
                    name: "view_remote_image",
                    arguments: JSON.stringify({
                      url: invalidUrl
                        ? "https://www.reddit.com/r/DnDHomebrew/comments/oh4bo9/asmodeus_stat_block/"
                        : "https://files.d20.io/images/map.webp",
                    }),
                  },
                }],
              }
              : { role: "assistant", content: "I can see the map." },
            finish_reason: firstCall ? "tool_calls" : "stop",
          }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await generateText({
    model: openrouter("openai/gpt-5.2"),
    prompt: "View the map.",
    tools: {
      view_remote_image: remoteImageView.createViewRemoteImageTool(true),
    },
    stopWhen: stepCountIs(2),
  });

  assert.equal(requestBodies.length, 2);
  const toolMessage = requestBodies[1].messages.find(
    (message) => message.role === "tool",
  );
  if (invalidUrl) {
    assert.match(JSON.stringify(toolMessage.content), /requires a direct image URL/);
    assert.doesNotMatch(JSON.stringify(toolMessage.content), /"type":"image_url"/);
  } else {
    assert.deepEqual(toolMessage.content[1], {
    type: "image_url",
    image_url: { url: "https://files.d20.io/images/map.webp" },
  });
  }
});
}
