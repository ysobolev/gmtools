export const MODEL_IDS = [
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "anthropic/claude-fable-5.1",
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const RECOMMENDED_MODEL_ID: ModelId = "openai/gpt-5.6-sol";
export const FREE_MODEL_ID: ModelId = "openrouter/free";

export type ModelSelection =
  | { readonly kind: "recommended" }
  | { readonly kind: "free" }
  | { readonly kind: "fixed"; readonly modelId: string };

export const RULESET_IDS = ["dnd5e", "vtm5", "custom"] as const;
export type RulesetId = (typeof RULESET_IDS)[number];

export interface AssistantProfile {
  readonly id: string;
  readonly name: string;
  readonly rulesetId: RulesetId;
  readonly modelSelection: ModelSelection;
  readonly additionalInstructions: string;
}

export interface ModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface RulesetDefinition {
  readonly id: RulesetId;
  readonly label: string;
}

export const MODELS: readonly ModelDefinition[] = [
  {
    id: FREE_MODEL_ID,
    label: "OpenRouter Free",
    description: "Automatically selects a compatible free model through OpenRouter.",
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B IT",
    description: "Google's Gemma model, available through OpenRouter's free tier.",
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "OpenAI's flagship model for complex reasoning and agentic work.",
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "OpenAI's balanced model for capability, speed, and cost.",
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "OpenAI's fast, cost-efficient model for lighter workloads.",
  },
  {
    id: "anthropic/claude-fable-5.1",
    label: "Claude Fable 5.1",
    description: "Anthropic's highest-capability model for demanding work.",
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    description: "Anthropic's powerful model for complex agentic tasks.",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Anthropic's balanced agentic model.",
  },
];

export const RULESETS: readonly RulesetDefinition[] = [
  { id: "dnd5e", label: "D&D 5e" },
  { id: "vtm5", label: "Vampire: The Masquerade 5th Edition" },
  { id: "custom", label: "Custom prompt" },
];

export const DEFAULT_PROFILE: AssistantProfile = {
  id: "general-gm",
  name: "General",
  rulesetId: "custom",
  modelSelection: { kind: "recommended" },
  additionalInstructions: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/\s/.test(value)
  );
}

function isModelSelection(value: unknown): value is ModelSelection {
  return (
    isRecord(value) &&
    (value.kind === "recommended" ||
      value.kind === "free" ||
      (value.kind === "fixed" && isModelIdentifier(value.modelId)))
  );
}

export function isAssistantProfile(value: unknown): value is AssistantProfile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length >= 1 &&
    value.id.length <= 80 &&
    typeof value.name === "string" &&
    value.name.trim().length >= 1 &&
    value.name.length <= 80 &&
    includesValue(RULESET_IDS, value.rulesetId) &&
    isModelSelection(value.modelSelection) &&
    typeof value.additionalInstructions === "string" &&
    value.additionalInstructions.length <= 8_000
  );
}

export function normalizeProfiles(value: unknown): AssistantProfile[] {
  if (!Array.isArray(value)) return [DEFAULT_PROFILE];
  const seen = new Set<string>();
  const profiles = value.filter((profile): profile is AssistantProfile => {
    if (!isAssistantProfile(profile) || seen.has(profile.id)) return false;
    seen.add(profile.id);
    return true;
  });
  const general =
    profiles.find((profile) => profile.id === DEFAULT_PROFILE.id) ??
    DEFAULT_PROFILE;
  const customProfiles = profiles
    .filter((profile) => profile.id !== DEFAULT_PROFILE.id)
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
    );
  return [
    general,
    ...customProfiles,
  ].slice(0, 50);
}

export function isCuratedModelId(value: string): value is ModelId {
  return includesValue(MODEL_IDS, value);
}

export function getModelDefinition(modelId: string): ModelDefinition {
  return (
    MODELS.find((model) => model.id === modelId) ?? {
      id: modelId,
      label: modelId,
      description:
        "This custom OpenRouter model has not been tested with GM Tools.",
    }
  );
}

export function resolveModelId(selection: ModelSelection): string {
  return selection.kind === "recommended"
    ? RECOMMENDED_MODEL_ID
    : selection.kind === "free"
      ? FREE_MODEL_ID
      : selection.modelId;
}

export function getModelSelectionLabel(selection: ModelSelection): string {
  const definition = getModelDefinition(resolveModelId(selection));
  return selection.kind === "recommended"
    ? `Recommended (${definition.label})`
    : selection.kind === "free"
      ? `Free (${definition.label})`
      : definition.label;
}

export function getRulesetDefinition(
  rulesetId: RulesetId,
): RulesetDefinition {
  return RULESETS.find((ruleset) => ruleset.id === rulesetId) ?? RULESETS[0]!;
}

export function createProfile(
  id: string,
  number: number,
): AssistantProfile {
  return {
    id,
    name: number === 1 ? "New Profile" : `New Profile ${number}`,
    rulesetId: "dnd5e",
    modelSelection: { kind: "recommended" },
    additionalInstructions: "",
  };
}
