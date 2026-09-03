import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/browser-storage.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const browserStorage = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("restricts storage when the browser supports access controls", async () => {
  const restricted = [];
  const area = (name) => ({
    setAccessLevel: async (options) => {
      restricted.push([name, options]);
    },
  });

  browserStorage.restrictExtensionStorage({
    local: area("local"),
    session: area("session"),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(restricted, [
    ["session", { accessLevel: "TRUSTED_CONTEXTS" }],
    ["local", { accessLevel: "TRUSTED_CONTEXTS" }],
  ]);
});

test("starts normally when Firefox omits storage access controls", () => {
  assert.doesNotThrow(() => {
    browserStorage.restrictExtensionStorage({ local: {}, session: {} });
  });
});
