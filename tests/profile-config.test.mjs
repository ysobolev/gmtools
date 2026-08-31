import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/profile-config.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const profileSource = outputFiles[0].text;
const profiles = await import(
  `data:text/javascript;base64,${Buffer.from(profileSource).toString("base64")}`
);

test("provides a valid default profile when storage is empty", () => {
  assert.deepEqual(profiles.normalizeProfiles(undefined), [profiles.DEFAULT_PROFILE]);
  assert.equal(profiles.isAssistantProfile(profiles.DEFAULT_PROFILE), true);
});

test("rejects unknown models and incompatible game-sheet combinations", () => {
  assert.equal(
    profiles.isAssistantProfile({
      ...profiles.DEFAULT_PROFILE,
      modelId: "unlisted/model",
    }),
    false,
  );
  assert.equal(
    profiles.isAssistantProfile({
      ...profiles.DEFAULT_PROFILE,
      rulesetId: "vtm5",
      sheetAdapterId: "roll20-dnd5e-2014",
    }),
    false,
  );
});

test("composes base, ruleset, sheet, and user guidance", () => {
  const prompt = profiles.buildProfileInstructions({
    id: "waterdeep",
    name: "Waterdeep",
    rulesetId: "dnd5e",
    sheetAdapterId: "roll20-dnd5e-2024",
    modelId: "anthropic/claude-sonnet-4.6",
    additionalInstructions: "Call the players heroes.",
  });

  assert.match(prompt, /execute_roll20/);
  assert.match(prompt, /Introduction-to-Mod-Scripts-API/);
  assert.match(prompt, /bio, notes, defaulttoken, and gmnotes are callback-only/);
  assert.match(prompt, /object\.get\(property, resolve\)/);
  assert.match(prompt, /Dungeons & Dragons Fifth Edition/);
  assert.match(prompt, /getSheetItem and setSheetItem/);
  assert.match(prompt, /Call the players heroes\./);
});

test("offers only sheets compatible with the selected ruleset", () => {
  const sheets = profiles.sheetsForRuleset("vtm5");
  assert.ok(sheets.length > 0);
  assert.ok(sheets.every((sheet) => sheet.rulesetId === "vtm5"));
});
