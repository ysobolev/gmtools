import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("registers and builds the full-page profile editor", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(manifest.name, "GM Tools for VTT");
  assert.equal(manifest.version, packageJson.version);
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

test("embeds the same build identity in the worker and content script", async () => {
  const [contentScript, serviceWorker] = await Promise.all([
    readFile("extension/content-script.js", "utf8"),
    readFile("extension/service-worker.js", "utf8"),
  ]);
  const buildId = contentScript.match(
    /EXTENSION_BUILD_ID\s*=\s*"([a-f0-9]{12})"/,
  )?.[1];
  assert.ok(buildId);
  assert.ok(serviceWorker.includes(`"${buildId}"`));
});
