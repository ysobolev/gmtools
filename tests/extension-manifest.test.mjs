import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const builds = [
  { directory: "generated/chrome", browser: "Chrome" },
  { directory: "generated/firefox", browser: "Firefox" },
];

test("registers and builds both browser extensions", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  for (const { directory } of builds) {
    const manifest = JSON.parse(
      await readFile(`${directory}/manifest.json`, "utf8"),
    );
    assert.equal(manifest.name, "GM Tools for VTT");
    assert.equal(manifest.version, packageJson.version);
    assert.equal(
      manifest.homepage_url,
      "https://github.com/ysobolev/gmtools",
    );
    assert.deepEqual(manifest.options_ui, {
      page: "options.html",
      open_in_tab: true,
    });
    assert.deepEqual(manifest.optional_host_permissions, [
      "http://*/*",
      "https://*/*",
    ]);
    assert.ok(manifest.permissions.includes("contextMenus"));
    await Promise.all(
      [
        "content-script.js",
        "options.html",
        "options.css",
        "options.js",
        "service-worker.js",
        "sidepanel.html",
        "sidepanel.css",
        "sidepanel.js",
      ].map((file) => access(`${directory}/${file}`)),
    );
  }
});

test("uses native sidebar and background declarations per browser", async () => {
  const [chromeManifest, firefoxManifest] = await Promise.all([
    readFile("generated/chrome/manifest.json", "utf8").then(JSON.parse),
    readFile("generated/firefox/manifest.json", "utf8").then(JSON.parse),
  ]);

  assert.ok(chromeManifest.permissions.includes("sidePanel"));
  assert.deepEqual(chromeManifest.side_panel, {
    default_path: "sidepanel.html",
  });
  assert.equal(chromeManifest.background.service_worker, "service-worker.js");

  assert.ok(!firefoxManifest.permissions.includes("sidePanel"));
  assert.deepEqual(firefoxManifest.background.scripts, ["service-worker.js"]);
  assert.deepEqual(firefoxManifest.action, {
    default_title: "Open GM Tools for VTT",
    default_area: "navbar",
  });
  assert.deepEqual(firefoxManifest.sidebar_action, {
    default_title: "GM Tools for VTT",
    default_panel: "sidepanel.html",
    open_at_install: false,
  });
  assert.equal(
    firefoxManifest.browser_specific_settings.gecko.id,
    "gmtools@achiral.net",
  );
  assert.equal(
    firefoxManifest.browser_specific_settings.gecko.strict_min_version,
    "140.0",
  );
  assert.deepEqual(
    firefoxManifest.browser_specific_settings.gecko
      .data_collection_permissions.required,
    [
      "authenticationInfo",
      "personalCommunications",
      "searchTerms",
      "websiteContent",
    ],
  );
});

test("embeds the same build identity in both workers and content scripts", async () => {
  const buildIds = [];
  for (const { directory, browser } of builds) {
    const [contentScript, serviceWorker] = await Promise.all([
      readFile(`${directory}/content-script.js`, "utf8"),
      readFile(`${directory}/service-worker.js`, "utf8"),
    ]);
    const buildId = contentScript.match(
      /EXTENSION_BUILD_ID\s*=\s*"([a-f0-9]{12})"/,
    )?.[1];
    assert.ok(buildId, `${browser} content script has a build ID`);
    assert.ok(
      serviceWorker.includes(`"${buildId}"`),
      `${browser} worker has the same build ID`,
    );
    buildIds.push(buildId);
  }
  assert.equal(buildIds[0], buildIds[1]);
});
