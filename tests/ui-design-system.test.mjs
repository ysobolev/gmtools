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

test("page styles use only shared theme colors and defined tokens", async () => {
  const theme = await readFile("src/extension/static/design-system.css", "utf8");
  const defined = new Set([...theme.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  for (const file of ["options.css", "sidepanel.css"]) {
    const css = await readFile(`src/extension/static/${file}`, "utf8");
    const pageBackgrounds = [...css.matchAll(/(?:^|\n)(?:\:root\[data-theme="light"\] )?body\s*\{([^}]*)\}/g)];
    assert.equal(pageBackgrounds.length, 2, `${file} defines both page backgrounds`);
    for (const [, body] of pageBackgrounds) {
      assert.match(body, /background:[^;]*var\(--surface-canvas\)\s*;/);
      assert.doesNotMatch(body, /background:[^;]*var\(--text-/);
    }
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/i, file);
    assert.doesNotMatch(css, /:\s*(?:white|black|red|blue|green|gray|grey|transparent)\s*[;!]/i, file);
    assert.doesNotMatch(css, /cursor:\s*(?:wait|not-allowed)/, file);
    for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(defined.has(token), `${file} references undefined ${token}`);
    }
  }
  assert.doesNotMatch(theme, /cursor:\s*(?:wait|not-allowed)/);
});

test("disabled attach banners fade except while discovering campaigns", async () => {
  const css = await readFile("src/extension/static/sidepanel.css", "utf8");
  const disabled = css.match(/\.campaign-banner-attach:disabled\s*\{([^}]*)\}/);
  assert.ok(disabled);
  assert.match(disabled[1], /opacity:\s*0\.55;/);
  const discovering = css.match(/\.campaign-banner-attach\[data-discovering\]:disabled\s*\{([^}]*)\}/);
  assert.ok(discovering);
  assert.match(discovering[1], /opacity:\s*1;/);
});
