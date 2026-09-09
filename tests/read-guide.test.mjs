import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function load(path) {
  const { outputFiles } = await build({
    entryPoints: [path], bundle: true, format: "esm", platform: "node", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { createReadGuideTool } = await load("src/extension/read-guide-tool.ts");
const { buildProfileInstructions } = await load("src/extension/prompts/build-profile-instructions.ts");

test("bundled guides are readable without campaign, network, or storage access", async () => {
  const tool = createReadGuideTool();
  for (const guideId of ["beacon", "dnd5e-roll20"]) {
    assert.ok(tool.description.includes(guideId));
    const result = await tool.execute({ guideId });
    assert.equal(result.ok, true);
    assert.equal(result.guideId, guideId);
    assert.ok(result.content.length > 500);
  }
  const beacon = await tool.execute({ guideId: "beacon" });
  assert.match(beacon.content, /not a universal Beacon schema/);
  assert.match(beacon.content, /whether computed properties are writable/);
  const dnd = await tool.execute({ guideId: "dnd5e-roll20" });
  assert.match(dnd.content, /Build a complete NPC on the 2014 Roll20 sheet/);
  assert.match(dnd.content, /Build a complete NPC on the Beacon 2024 sheet/);
});

test("unknown guides return recoverable errors and cannot read arbitrary files", async () => {
  for (const guideId of ["missing", "constructor", "__proto__", "../../.scratch/feedback.token"]) {
    const result = await createReadGuideTool().execute({ guideId });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown guide/);
    assert.deepEqual(result.availableGuides.map(({ id }) => id), ["beacon", "dnd5e-roll20"]);
    assert.equal(result.content, undefined);
  }
});

test("all profiles discover guides without embedding the NPC recipes", () => {
  for (const rulesetId of ["custom", "dnd5e", "vtm5"]) {
    for (const roll20Available of [true, false]) {
      const prompt = buildProfileInstructions({
        id: "test", name: "Test", rulesetId,
        modelSelection: { kind: "recommended" }, additionalInstructions: "",
      }, { roll20Available });
      assert.match(prompt, /read_guide/);
      assert.match(prompt, /dnd5e-roll20/);
      assert.match(prompt, /Campaign\(\)\.sheetName/);
      assert.match(prompt, /kobold do not establish a game system/);
      assert.match(prompt, /Missing or delayed markers are inconclusive/);
      assert.doesNotMatch(prompt, /Build a complete NPC|l1mancer_status|crInterface/);
    }
  }
});
