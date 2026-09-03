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
  assert.deepEqual(profiles.DEFAULT_PROFILE.modelSelection, {
    kind: "recommended",
  });
});

test("keeps the General profile available when stored profiles omit it", () => {
  const custom = {
    ...profiles.DEFAULT_PROFILE,
    id: "custom-profile",
    name: "Custom",
  };
  assert.deepEqual(profiles.normalizeProfiles([custom]), [
    profiles.DEFAULT_PROFILE,
    custom,
  ]);
});

test("accepts custom models and rejects incompatible game-sheet combinations", () => {
  assert.equal(
    profiles.isAssistantProfile({
      ...profiles.DEFAULT_PROFILE,
      modelSelection: { kind: "fixed", modelId: "unlisted/model" },
    }),
    true,
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

test("offers the curated OpenAI and Anthropic model classes", () => {
  assert.deepEqual(profiles.MODEL_IDS, [
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "anthropic/claude-fable-5.1",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
  ]);
  assert.deepEqual(
    profiles.getModelDefinition("openai/gpt-5.6-sol"),
    {
      id: "openai/gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      description:
        "OpenAI's flagship model for complex reasoning and agentic work.",
    },
  );
});

test("resolves recommended and fixed model selections", () => {
  assert.equal(
    profiles.resolveModelId({ kind: "recommended" }),
    profiles.RECOMMENDED_MODEL_ID,
  );
  assert.equal(
    profiles.resolveModelId({ kind: "fixed", modelId: "vendor/legacy" }),
    "vendor/legacy",
  );
  assert.equal(
    profiles.getModelSelectionLabel({ kind: "recommended" }),
    "Recommended (GPT-5.6 Sol)",
  );
  assert.equal(
    profiles.getModelDefinition("vendor/legacy").label,
    "vendor/legacy",
  );
});

test("preserves a stored custom model selection", () => {
  const custom = {
    ...profiles.DEFAULT_PROFILE,
    id: "custom-model-profile",
    modelSelection: { kind: "fixed", modelId: "vendor/retired-model" },
  };
  const normalized = profiles.normalizeProfiles([custom]);
  assert.deepEqual(normalized[1], custom);
});

test("composes base, ruleset, sheet, and user guidance", () => {
  const prompt = profiles.buildProfileInstructions({
    id: "waterdeep",
    name: "Waterdeep",
    rulesetId: "dnd5e",
    sheetAdapterId: "roll20-dnd5e-2024",
    modelSelection: {
      kind: "fixed",
      modelId: "anthropic/claude-sonnet-5",
    },
    additionalInstructions: "Call the players heroes.",
  });

  assert.match(prompt, /execute_roll20/);
  assert.match(prompt, /Every execute_roll20 call must include a concise/);
  assert.match(prompt, /Start the summary with a lowercase letter/);
  assert.match(prompt, /Distinguish inspection from modification/);
  assert.match(prompt, /Use web_fetch to consult relevant documentation/);
  assert.match(prompt, /If web_fetch cannot access a required domain/);
  assert.match(prompt, /enable Allow web fetching from any domain under Behavior/);
  assert.match(prompt, /Use web_search to discover relevant pages/);
  assert.match(prompt, /enable Allow web searching under Behavior/);
  assert.match(prompt, /dragged directly onto the Roll20 tabletop canvas/);
  assert.match(prompt, /must first save the image locally/);
  assert.match(prompt, /Introduction-to-Mod-Scripts-API/);
  assert.match(prompt, /bio, notes, defaulttoken, and gmnotes are callback-only/);
  assert.match(prompt, /object\.get\(property, resolve\)/);
  assert.match(prompt, /Dungeons & Dragons Fifth Edition/);
  assert.match(prompt, /getSheetItem and setSheetItem/);
  assert.match(prompt, /Both functions are asynchronous/);
  assert.match(prompt, /Use Promise\.all for independent reads/);
  assert.match(prompt, /getSheetItem\(characterId, itemName, "max"\)/);
  assert.match(prompt, /user\. prefix/);
  assert.match(prompt, /Experimental Mod server/);
  assert.match(prompt, /Never infer a Beacon sheet-item name/);
  assert.match(prompt, /documentation and read-only inspection/);
  assert.match(prompt, /do not perform the mutation/);
  assert.match(prompt, /appState is a legacy attribute/);
  assert.match(prompt, /attribute\.set\("current", "npc"\)/);
  assert.match(prompt, /Do not set appState with setSheetItem/);
  assert.match(prompt, /character-creation wizard/);
  assert.match(prompt, /Call the players heroes\./);
});

test("explains that Roll20 tools require an attached campaign", () => {
  const prompt = profiles.buildProfileInstructions(
    profiles.DEFAULT_PROFILE,
    { roll20Available: false },
  );

  assert.match(prompt, /not attached to a Roll20 campaign/);
  assert.match(prompt, /click Attach/);
  assert.doesNotMatch(prompt, /Every execute_roll20 call must include/);
});

test("offers only sheets compatible with the selected ruleset", () => {
  const sheets = profiles.sheetsForRuleset("vtm5");
  assert.ok(sheets.length > 0);
  assert.ok(sheets.every((sheet) => sheet.rulesetId === "vtm5"));
});
