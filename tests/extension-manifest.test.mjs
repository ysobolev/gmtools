import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("registers and builds the full-page profile editor", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));

  assert.deepEqual(manifest.options_ui, {
    page: "options.html",
    open_in_tab: true,
  });
  await Promise.all([
    access("extension/options.html"),
    access("extension/options.css"),
    access("extension/options.js"),
  ]);
});
