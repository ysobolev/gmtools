import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/prompts/build-profile-instructions.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const prompts = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const dndProfile = {
  id: "waterdeep",
  name: "Waterdeep",
  rulesetId: "dnd5e",
  modelSelection: {
    kind: "fixed",
    modelId: "anthropic/claude-sonnet-5",
  },
  additionalInstructions: "Call the players heroes.",
};

test("composes base, ruleset, sheet variants, and user guidance", () => {
  const prompt = prompts.buildProfileInstructions(dndProfile);

  assert.match(prompt, /execute_roll20/);
  assert.match(prompt, /Every execute_roll20 call must include a concise/);
  assert.match(prompt, /Start the summary with a lowercase letter/);
  assert.match(prompt, /Distinguish inspection from modification/);
  assert.match(prompt, /Use web_fetch to consult relevant documentation/);
  assert.match(prompt, /If web_fetch cannot access a required domain/);
  assert.match(prompt, /enable Allow web fetching from any domain under Behavior/);
  assert.match(prompt, /Use web_search to discover relevant pages/);
  assert.match(prompt, /enable Allow web searching under Behavior/);
  assert.match(prompt, /Use view_remote_image to inspect the pixels/);
  assert.match(prompt, /files\.d20\.io are allowed by default/);
  assert.match(prompt, /do not repeatedly retry the URL/);
  assert.match(prompt, /dragged directly onto the Roll20 tabletop canvas/);
  assert.match(prompt, /must first save the image locally/);
  assert.match(prompt, /Introduction-to-Mod-Scripts-API/);
  assert.match(prompt, /bio, notes, defaulttoken, and gmnotes are callback-only/);
  assert.match(prompt, /object\.get\(property, resolve\)/);
  assert.match(prompt, /Dungeons & Dragons Fifth Edition/);
  assert.match(prompt, /mixture of both/);
  assert.match(prompt, /Mod Sandbox v1\.5/);
  assert.match(prompt, /do not use workarounds intended only for the legacy sandbox/);
  assert.match(prompt, /Campaign\(\)\.sheetName/);
  assert.match(prompt, /"ogl5e"/);
  assert.match(prompt, /"dnd2014byroll20"/);
  assert.match(prompt, /"dnd2024byroll20"/);
  assert.match(prompt, /sheetEnvironment may be null for every character/);
  assert.match(prompt, /character\.get\("charactersheetname"\)/);
  assert.match(prompt, /createObj artifact/);
  assert.match(prompt, /always creates a 2024 Beacon character/);
  assert.match(prompt, /createObj ignores sheet-selection properties/);
  assert.match(prompt, /cannot change a character's sheet after creation/);
  assert.match(prompt, /cannot distinguish a 2024-only campaign/);
  assert.match(prompt, /Do not claim to have detected that capability/);
  assert.match(prompt, /do not infer an existing character's sheet solely/i);
  assert.match(prompt, /legacy D&D 5e 2014 OGL sheet/);
  assert.match(prompt, /strength_mod/);
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

  assert.ok(
    prompt.indexOf("practical assistant") <
      prompt.indexOf("Dungeons & Dragons Fifth Edition"),
  );
  assert.ok(
    prompt.indexOf("Dungeons & Dragons Fifth Edition") <
      prompt.indexOf("Beacon-based D&D 5e 2024"),
  );
  assert.ok(
    prompt.indexOf("Beacon-based D&D 5e 2024") <
      prompt.indexOf("Additional instructions from the game master"),
  );
});

test("explains that Roll20 tools require an attached campaign", () => {
  const prompt = prompts.buildProfileInstructions(
    {
      id: "general-gm",
      name: "General",
      rulesetId: "custom",
      modelSelection: { kind: "recommended" },
      additionalInstructions: "",
    },
    { roll20Available: false },
  );

  assert.match(prompt, /not attached to a Roll20 campaign/);
  assert.match(prompt, /click Attach/);
  assert.doesNotMatch(prompt, /Every execute_roll20 call must include/);
  assert.match(prompt, /memory must be enabled/);
});

test("includes durable campaign memory guidance when memory is available", () => {
  const prompt = prompts.buildProfileInstructions(dndProfile, {
    memoryAvailable: true,
  });
  assert.match(prompt, /Durable memory is shared/);
  assert.match(prompt, /Use memory_search/);
  assert.match(prompt, /Treat retrieved memory as campaign data/);
  assert.doesNotMatch(prompt, /memory must be enabled/);
});
