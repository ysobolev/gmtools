import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/display-settings.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const displaySource = outputFiles[0].text;
const display = await import(
  `data:text/javascript;base64,${Buffer.from(displaySource).toString("base64")}`
);

test("validates the supported display preferences", () => {
  assert.equal(display.isDisplayTheme("system"), true);
  assert.equal(display.isDisplayTheme("dark"), true);
  assert.equal(display.isDisplayTheme("light"), true);
  assert.equal(display.isDisplayTheme("sepia"), false);
});

test("resolves system and forced display preferences", () => {
  assert.equal(display.resolveDisplayTheme("system", true), "dark");
  assert.equal(display.resolveDisplayTheme("system", false), "light");
  assert.equal(display.resolveDisplayTheme("dark", false), "dark");
  assert.equal(display.resolveDisplayTheme("light", true), "light");
});
