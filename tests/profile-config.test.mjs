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

test("accepts custom models and rejects unknown rulesets", () => {
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
      rulesetId: "unknown",
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
