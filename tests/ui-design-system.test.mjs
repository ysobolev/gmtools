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

test("chat and profile deletion share the complete danger-button component", async () => {
  const source = await readFile("src/extension/sidepanel.tsx", "utf8");
  const css = await readFile("src/extension/static/design-system.css", "utf8");
  const panel = await readFile("src/extension/static/sidepanel.css", "utf8");
  const options = await readFile("src/extension/static/options.css", "utf8");
  assert.match(source, /className="danger-button button-small"\s+disabled=\{deleting\}/);
  const button = css.match(/button\.danger-button\s*\{([^}]*)\}/);
  assert.ok(button);
  assert.match(button[1], /color: var\(--danger\);/);
  assert.match(button[1], /background: var\(--surface-control\);/);
  assert.match(button[1], /font-weight: 750;/);
  assert.match(button[1], /font-size: 11px;/);
  assert.match(button[1], /min-height: 39px;/);
  assert.match(button[1], /padding: 0 14px;/);
  const hover = css.match(/button\.danger-button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(hover);
  assert.match(hover[1], /border-color: var\(--danger\);/);
  assert.match(hover[1], /background: var\(--danger-surface\);/);
  assert.match(css, /button\.danger-button:disabled\s*\{[^}]*opacity: 0\.38;/);
  for (const pageCss of [panel, options]) {
    assert.doesNotMatch(pageCss, /(?<!not\()\.danger-button(?:\s*\{|:hover|:disabled)/);
  }
  assert.doesNotMatch(panel, /\.chat-delete-confirm button/);
  const profileSource = await readFile("src/extension/options.tsx", "utf8");
  assert.match(profileSource, /className="danger-button"/);
});

test("chat Cancel shares secondary styling with compact size", async () => {
  const source = await readFile("src/extension/sidepanel.tsx", "utf8");
  const css = await readFile("src/extension/static/design-system.css", "utf8");
  assert.match(source, /className="secondary-button button-small"/);
  assert.match(css, /button\.secondary-button,\s*button\.danger-button\s*\{/);
  assert.match(css, /button\.secondary-button:hover:not\(:disabled\)/);
});

test("compact buttons override size without changing semantic styling", async () => {
  const css = await readFile("src/extension/static/design-system.css", "utf8");
  const small = css.match(/button\.button-small\s*\{([^}]*)\}/);
  assert.ok(small);
  assert.match(small[1], /min-height: 0;/);
  assert.match(small[1], /padding: 5px 8px;/);
  assert.match(small[1], /font-size: 10px;/);
  assert.doesNotMatch(small[1], /font-weight|color|background|opacity/);
  assert.ok(css.indexOf("button.button-small {") > css.indexOf("button.danger-button {"));
});

test("settings deletion dialogs align right with Cancel first and destruction last", async () => {
  const source = await readFile("src/extension/options.tsx", "utf8");
  const css = await readFile("src/extension/static/options.css", "utf8");
  const groups = [...source.matchAll(/<div className="campaign-delete-actions">([\s\S]*?)<\/div>/g)];
  assert.equal(groups.length, 4);
  for (const [, group] of groups) {
    const buttons = [...group.matchAll(/<button[\s\S]*?<\/button>/g)].map(([button]) => button);
    assert.match(buttons[0], />\s*Cancel\s*<\/button>/);
    assert.match(buttons.at(-1), /className="danger-button(?: button-small)?"/);
  }
  assert.match(css, /\.campaign-delete-actions\s*\{[^}]*justify-content: flex-end;/);
});

test("single memory deletion uses a compact modal rather than replacing row actions", async () => {
  const source = await readFile("src/extension/options.tsx", "utf8");
  assert.match(source, /ref=\{deleteMemoryModalRef\} aria-modal="true"/);
  assert.match(source, /useModalEscape\(Boolean\(deleteMemory\), busy/);
  assert.match(source, /deleteMemory.content.slice\(0, 240\)/);
  assert.match(source, /removeMemory\(deleteMemory.id\)/);
  assert.match(source, /className="danger-button button-small" disabled=\{busy\} onClick=\{\(\) => \{\s*setFeedback\(null\);\s*setDeletePromptId\(memory.id\)/);
  assert.doesNotMatch(source, /Confirm delete|deletePromptId === memory.id/);
  assert.doesNotMatch(source, /updateCampaignMemory|campaign-memory-editor|setEditingContent/);
});

test("memory dates align with the bottom of the compact action row", async () => {
  const css = await readFile("src/extension/static/options.css", "utf8");
  assert.match(css, /\.campaign-memory-meta\s*\{[^}]*align-items: flex-end;/);
});

test("profile deletion describes the current fallback profile name", async () => {
  const source = await readFile("src/extension/options.tsx", "utf8");
  assert.match(source, /fallbackProfileName = profiles\.find\(\(profile\) => profile\.id === DEFAULT_PROFILE\.id\)\?\.name \?\? DEFAULT_PROFILE\.name/);
  assert.equal([...source.matchAll(/switch to \{fallbackProfileName\}/g)].length, 2);
  assert.doesNotMatch(source, /switch to General/);
});

test("campaign deletion defaults to keeping chats and uses a single conditional action", async () => {
  const source = await readFile("src/extension/options.tsx", "utf8");
  assert.match(source, /\.\.\.response\.preview,\s*deleteChats: false/);
  assert.match(source, /checked=\{deletePrompt.deleteChats\}\s+disabled=\{deleteBusy\}/);
  assert.match(source, /confirmDelete\(deletePrompt.deleteChats \? "delete-chats" : "detach-chats"\)/);
  assert.match(source, /"Delete campaign and chats" : "Delete campaign and detach chats"/);
  assert.doesNotMatch(source, />Delete chats too<|>Detach and keep chats</);
  assert.match(source, /Also delete associated chats and images/);
  assert.doesNotMatch(source, /campaign-delete-explanation|Their history and images will be kept/);
});
