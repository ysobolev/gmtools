import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/openrouter-tools.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleSource = outputFiles[0].text;
const openrouterTools = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
);

test("configures OpenRouter web fetch with a strict documentation allowlist", () => {
  const webFetch = openrouterTools.createOpenRouterWebFetchTool();

  assert.equal(webFetch.type, "provider");
  assert.equal(webFetch.id, "openrouter.web_fetch");
  assert.deepEqual(webFetch.args, {
    parameters: {
      engine: "exa",
      allowed_domains: ["help.roll20.net"],
    },
  });
});

test("serializes web fetch in OpenRouter's server-tool wire format", async () => {
  let requestBody;
  const openrouter = createOpenRouter({
    apiKey: "test-key",
    compatibility: "strict",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: "generation-1",
          object: "chat.completion",
          created: 0,
          model: "openai/gpt-5.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Done." },
              finish_reason: "stop",
            },
          ],
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
    prompt: "Read the documentation.",
    tools: { web_fetch: openrouterTools.createOpenRouterWebFetchTool() },
  });

  assert.deepEqual(requestBody.tools, [
    {
      type: "openrouter:web_fetch",
      parameters: {
        engine: "exa",
        allowed_domains: ["help.roll20.net"],
      },
    },
  ]);
});

test("omits the domain allowlist when unrestricted fetching is enabled", () => {
  const webFetch = openrouterTools.createOpenRouterWebFetchTool(true);

  assert.deepEqual(webFetch.args, {
    parameters: { engine: "exa" },
  });
});
