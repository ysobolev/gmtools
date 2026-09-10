import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/prompts/build-profile-instructions.ts"],
  loader: { ".md": "text" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const prompts = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const guideBuild = await build({
  entryPoints: ["src/extension/prompts/guides.ts"],
  loader: { ".md": "text" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const guides = await import(`data:text/javascript;base64,${Buffer.from(guideBuild.outputFiles[0].text).toString("base64")}`);
const dndGuide = guides.readGuide("dnd5e-roll20").content;

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

test("5e map guidance consults page dimensions and scale even without experimental tools", () => {
  const prompt = prompts.buildProfileInstructions(dndProfile);
  assert.match(prompt, /consult the target page's grid dimensions and grid scale before generating the image/);
  assert.match(prompt, /width and height in grid cells to choose the map's aspect ratio/);
  assert.match(prompt, /distance represented by one square/);
  assert.match(prompt, /Fantasy maps are not always strictly to scale/);
  assert.match(prompt, /Honor explicit GM instructions over page-derived defaults/);
});

test("image lookup guidance covers same-turn local IDs without repeated generation", () => {
  const prompt = prompts.buildProfileInstructions({ ...dndProfile, rulesetId: "custom" });
  assert.match(prompt, /After generating an image, use list_images/);
  assert.match(prompt, /The generation service does not know these local IDs/);
  assert.match(prompt, /Reuse the existing image rather than generating another/);
});

test("image generation guidance limits generation per requested item across games", () => {
  for (const rulesetId of ["custom", "dnd5e", "vtm5"]) {
    const prompt = prompts.buildProfileInstructions({ ...dndProfile, rulesetId });
    assert.match(prompt, /Generate one image per requested item, not one per message/);
    assert.match(prompt, /regenerate only to correct a concrete mismatch/);
    assert.match(prompt, /explicitly asks for a revision or alternatives/);
  }
});

test("5e profiles and the discoverable guide require playable encounter creatures", () => {
  for (const prompt of [prompts.buildProfileInstructions(dndProfile), dndGuide]) {
    assert.match(prompt, /make them playable, not merely decorative tokens/);
    assert.match(prompt, /Unless the GM explicitly requests map artwork or markers only/);
    assert.match(prompt, /import suitable compendium characters when available or create populated NPC sheets, then link their tokens/);
    assert.match(prompt, /independent current HP on each token/);
    assert.match(prompt, /not just suggested stats in notes/);
  }
});

test("Roll20 image workflows apply across games only when UI tools are available", () => {
  for (const rulesetId of ["custom", "dnd5e", "vtm5"]) {
    const profile = { ...dndProfile, rulesetId };
    const enabled = prompts.buildProfileInstructions(profile, { roll20Available: true, roll20UiToolsAvailable: true });
    assert.match(enabled, /## Roll20 layers and image assets/);
    assert.match(enabled, /record the token\/graphic IDs.*before the drop/);
    assert.match(enabled, /List the page's tokens\/graphics again and compare IDs/);
    assert.match(enabled, /delete only that temporary token after capturing the URL/);
    assert.match(enabled, /retain the confirmed new token/);
    assert.match(enabled, /associate it.*through `represents`/);
    assert.match(enabled, /Avoid dropping onto the map layer/);
    assert.match(enabled, /Before calling `compendium_import`, check the selected layer with `get_current_layer`/);
    assert.match(enabled, /Do not import onto the map layer/);
    assert.match(enabled, /Prefer the GM layer for staging so newly imported creatures are not revealed to players/);
    assert.match(enabled, /Each drop creates a separate upload and consumes Art Library storage quota/);
    assert.match(enabled, /create or update a token with that image URL instead/);
    assert.match(enabled, /do not modify or delete a guessed token/);
    assert.doesNotMatch(prompts.buildProfileInstructions(profile), /## Roll20 layers and image assets/);
    assert.doesNotMatch(prompts.buildProfileInstructions(profile, { roll20Available: false, roll20UiToolsAvailable: true }), /## Roll20 layers and image assets/);
  }
});

test("base prompt and on-demand guide preserve sheet and user guidance", () => {
  const prompt = prompts.buildProfileInstructions(dndProfile).replace(
    "Additional instructions from the game master:",
    `${dndGuide}\n\nAdditional instructions from the game master:`,
  );

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
  assert.match(prompt, /Writes use ordinary object\.set\(property, value\)/);
  assert.match(prompt, /setter does not invoke a completion callback/);
  assert.match(prompt, /never wrap object\.set\(property, value, resolve\) in an awaited Promise/);
  assert.match(prompt, /separate callback-based read with a bounded timeout/);
  assert.match(prompt, /Dungeons & Dragons Fifth Edition/);
  assert.match(prompt, /support the legacy 2014 and Beacon-based 2024 sheets/);
  assert.match(prompt, /custom or unsupported sheet/);
  assert.match(prompt, /ask the game master for sheet-specific help/);
  assert.match(prompt, /## Dungeons & Dragons Fifth Edition\n\n/);
  assert.match(prompt, /### Identify the campaign and character sheet/);
  assert.match(prompt, /### Create characters/);
  assert.match(prompt, /### Legacy D&D 5e 2014 sheet/);
  assert.match(prompt, /### Beacon-based D&D 5e 2024 sheet/);
  assert.match(prompt, /mixture of both/);
  assert.match(prompt, /Sandbox v1\.5/);
  assert.match(prompt, /Legacy Roll20 v1 sandboxes remain usable/);
  assert.match(prompt, /requires Sandbox v1.5 capabilities/);
  assert.match(prompt, /getSheetItem and setSheetItem exist in both v1 and v1.5/);
  assert.match(prompt, /getComputed and setComputed require v1.5/);
  assert.match(prompt, /Campaign\(\)\.sheetName/);
  assert.match(prompt, /"ogl5e"/);
  assert.match(prompt, /"dnd2014byroll20"/);
  assert.match(prompt, /"dnd2024byroll20"/);
  assert.match(prompt, /`sheetEnvironment` may be `null` for every character/);
  assert.match(prompt, /character\.get\("charactersheetname"\)/);
  assert.match(prompt, /`createObj` artifact/);
  assert.match(prompt, /worth trying an awaited `getSheetItem` call/);
  assert.match(prompt, /behavior is not guaranteed/);
  assert.match(prompt, /avoid asking the game master to reload/);
  assert.match(prompt, /populate `sheetEnvironment` as `"beacon"`/);
  assert.match(prompt, /A missing or not-yet-populated marker is inconclusive/);
  assert.match(prompt, /reacquire the character with `getObj`/);
  assert.match(prompt, /presence of an `appState` attribute does not identify/);
  assert.match(prompt, /always creates a 2024 Beacon character/);
  assert.match(prompt, /`createObj` ignores sheet-selection properties/);
  assert.match(prompt, /cannot change a character's sheet after creation/);
  assert.match(prompt, /cannot distinguish a 2024-only campaign/);
  assert.match(prompt, /Do not claim to have detected that capability/);
  assert.match(prompt, /do not infer an existing character's sheet solely/i);
  assert.match(prompt, /Legacy D&D 5e 2014 sheet/);
  assert.match(prompt, /strength_mod/);
  assert.match(prompt, /Attribute\.setWithWorker/);
  assert.match(prompt, /`l1mancer_status = "completed"`/);
  assert.match(prompt, /`mancer_confirm_flag = ""`/);
  assert.match(prompt, /`mancer_cancel = "on"`/);
  assert.match(prompt, /`npc` attribute's current value to `"1"`/);
  assert.match(prompt, /`getSheetItem` and `setSheetItem`/);
  assert.match(prompt, /Both functions are asynchronous/);
  assert.match(prompt, /Use `Promise\.all` for independent reads/);
  assert.match(prompt, /getSheetItem\(characterId, itemName, "max"\)/);
  assert.match(prompt, /`user\.` prefix/);
  assert.doesNotMatch(prompt, /Experimental Mod server/);
  assert.match(prompt, /Never infer a Beacon sheet-item name/);
  assert.match(prompt, /documentation and read-only inspection/);
  assert.match(prompt, /do not perform the mutation/);
  assert.match(prompt, /`appState` is a legacy Attribute object/);
  assert.match(prompt, /`attribute\.set\("current", "npc"\)`/);
  assert.match(prompt, /use `"npc"` for an NPC or `"sheet"` for a player character/);
  assert.match(prompt, /first lookup does not find `appState`/);
  assert.match(prompt, /re-query before creating the attribute/);
  assert.match(prompt, /do not use its presence to identify the sheet/);
  assert.match(prompt, /Do not set `appState` with `setSheetItem`/);
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

test("includes the sandbox version in shared Roll20 guidance", () => {
  const prompt = prompts.buildProfileInstructions({
    id: "general-gm",
    name: "General",
    rulesetId: "custom",
    modelSelection: { kind: "recommended" },
    additionalInstructions: "",
  });

  assert.match(prompt, /Sandbox v1\.5/);
  assert.match(prompt, /community or custom sheets/);
  assert.doesNotMatch(prompt, /Dungeons & Dragons Fifth Edition/);
  assert.doesNotMatch(prompt, /Build a complete NPC on the Beacon/);
});

test("includes the validated Beacon NPC workflow and its limitations", () => {
  const prompt = dndGuide;
  assert.match(prompt, /Build a complete NPC on the Beacon 2024 sheet/);
  assert.match(prompt, /Default to 2024\/5\.5e rules and spell definitions/);
  assert.match(prompt, /Prefer Compact layout/);
  assert.match(prompt, /modifier \+ floor\(PB\/2\)/);
  assert.match(prompt, /preserve the printed total with an override/);
  assert.match(prompt, /BEFORE AC, HP, or other stat writes/);
  assert.match(prompt, /fresh NPC may have no store Attribute/);
  assert.match(prompt, /verify current HP through aggregate hp.current/);
  assert.match(prompt, /FULL JSON deep-copy/);
  assert.match(prompt, /Poll WITHOUT rewriting mismatches/);
  assert.match(prompt, /not a verified Beacon-ready barrier/);
  assert.match(prompt, /type:'Passive', skill:'Perception'/);
  assert.match(prompt, /NOT the 2014 repeating-row ID format/);
  assert.match(prompt, /no importer, browser control, local reference PDF/i);
  assert.match(prompt, /Source lore belongs in bio/);
  assert.match(prompt, /including paragraphs, lists and tables/);
  assert.match(prompt, /Do not create such children merely to obtain save\/attack buttons/);
  assert.match(prompt, /_bonus is EXTRA/);
  assert.match(prompt, /automatic spending on casting was NOT established/);
  assert.match(prompt, /not a validated PC class\/species\/background builder/);
  assert.doesNotMatch(prompt, /After allowing Beacon initialization to run, locate/);
  assert.ok(prompt.indexOf("NPC mode first") < prompt.indexOf("CR, abilities, proficiency"));
});

test("Beacon NPC creation records target stats and compares readbacks explicitly", () => {
  const prompt = dndGuide;
  assert.match(prompt, /return \{ characterId, source, expected \}/);
  assert.match(prompt, /Transcribe first, then interpret/);
  assert.match(prompt, /literal printed values before calculating/);
  assert.match(prompt, /status:'absent'/);
  assert.match(prompt, /status:'unreadable'/);
  assert.match(prompt, /status:'generated'/);
  assert.match(prompt, /Check expected against source before writing/);
  assert.match(prompt, /expected contains final totals, not partial contributions/);
  assert.match(prompt, /NOT what that call has already completed/);
  assert.match(prompt, /Sandbox variables do not persist between calls/);
  assert.match(prompt, /Do not replace expected values with sheet readbacks/);
  assert.match(prompt, /\{ field, expected, actual \}/);
  assert.match(prompt, /unknown\/unverified fields/);
  assert.match(prompt, /Verification is sandbox-based/);
  assert.match(prompt, /Routine lack of browser\/UI testing is not unfinished work/);
  assert.match(prompt, /Report concrete discrepancies, failed or unavailable data checks/);
  assert.match(prompt, /expected initiativeBonus:11 versus actual initiative_bonus:6/);
});

test("Beacon total overrides follow mechanic construction and verified mismatches", () => {
  const prompt = dndGuide;
  assert.match(prompt, /defer numeric final-total overrides until verification/);
  assert.match(prompt, /does not prohibit necessary base\/source assignments/);
  assert.match(prompt, /verify pb again before building dependent saves/);
  assert.match(prompt, /If actual matches expected, do not add a redundant total override/);
  assert.match(prompt, /Correct that mechanic and re-read/);
  assert.match(prompt, /Initiative overrides are final values/);
  assert.match(prompt, /initiative bonus and score separately/);
  assert.match(prompt, /unavailable read is not evidence that an override is required/);
  assert.match(prompt, /Update existing correction records rather than adding duplicate bonuses/);
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
