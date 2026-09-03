import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/browser-sidebar.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const browserSidebar = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("configures Chrome toolbar clicks to open the side panel", async () => {
  let configured = 0;
  const refresh = browserSidebar.configureBrowserSidebar(
    {
      sidePanel: {
        setPanelBehavior: async (options) => {
          assert.deepEqual(options, { openPanelOnActionClick: true });
          configured += 1;
        },
      },
    },
    { addListener: () => assert.fail("Chrome should not add a click listener") },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(configured, 1);
  refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(configured, 2);
});

test("opens the Firefox sidebar from the toolbar action", async () => {
  let actionListener;
  let opened = 0;
  const refresh = browserSidebar.configureBrowserSidebar(
    {
      sidebarAction: {
        open: async () => {
          opened += 1;
        },
      },
    },
    {
      addListener: (listener) => {
        actionListener = listener;
      },
    },
  );
  assert.equal(typeof actionListener, "function");
  actionListener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  refresh();
  assert.equal(opened, 1);
});
