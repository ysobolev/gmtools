import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/openrouter-cache.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const cache = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("uses the chat id as the OpenRouter sticky-session key", () => {
  assert.deepEqual(cache.createOpenRouterSessionHeaders("chat-123"), {
    "x-session-id": "chat-123",
  });
});

test("enables automatic ephemeral caching for Anthropic models", () => {
  assert.deepEqual(
    cache.createOpenRouterModelSettings("anthropic/claude-sonnet-5"),
    { cache_control: { type: "ephemeral" } },
  );
});

test("does not add explicit caching directives to other providers", () => {
  assert.deepEqual(
    cache.createOpenRouterModelSettings("openai/gpt-5.6-sol"),
    {},
  );
  assert.deepEqual(
    cache.createOpenRouterModelSettings("google/gemini-3.7-flash"),
    {},
  );
});
