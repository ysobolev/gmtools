import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("both extension pages load the shared semantic design system", async () => {
  const [tokens, optionsHtml, sidepanelHtml] = await Promise.all([
    readFile("src/extension/static/design-system.css", "utf8"),
    readFile("src/extension/static/options.html", "utf8"),
    readFile("src/extension/static/sidepanel.html", "utf8"),
  ]);

  for (const role of [
    "surface-canvas",
    "surface-raised",
    "text-primary",
    "text-secondary",
    "text-muted",
    "border-default",
    "accent",
    "informational",
    "success",
    "warning",
    "danger",
    "focus-ring",
  ]) {
    assert.match(tokens, new RegExp(`--${role}:`));
  }
  assert.match(tokens, /:root\[data-theme="light"\]/);
  assert.match(tokens, /prefers-reduced-motion: reduce/);
  assert.ok(optionsHtml.indexOf("design-system.css") < optionsHtml.indexOf("options.css"));
  assert.ok(sidepanelHtml.indexOf("design-system.css") < sidepanelHtml.indexOf("sidepanel.css"));
});

test("campaign memory distinguishes announced success and error feedback", async () => {
  const source = await readFile("src/extension/options.tsx", "utf8");
  assert.match(source, /kind: "success" \| "error"/);
  assert.match(source, /feedback\.kind === "error" \? "alert" : "status"/);
  assert.match(source, /className={`feedback-message \$\{feedback\.kind\}`}/);
});
