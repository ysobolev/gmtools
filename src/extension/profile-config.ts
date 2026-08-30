export const PROFILES_STORAGE_KEY = "gmToolsProfiles";
export const ACTIVE_PROFILE_STORAGE_KEY = "gmToolsActiveProfileId";

export const MODEL_IDS = [
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4.6",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const RULESET_IDS = ["dnd5e", "vtm5", "custom"] as const;
export type RulesetId = (typeof RULESET_IDS)[number];

export const SHEET_ADAPTER_IDS = [
  "generic",
  "roll20-dnd5e-2014",
  "roll20-dnd5e-2024",
  "roll20-vtm5",
] as const;
export type SheetAdapterId = (typeof SHEET_ADAPTER_IDS)[number];

export interface AssistantProfile {
  readonly id: string;
  readonly name: string;
  readonly rulesetId: RulesetId;
  readonly sheetAdapterId: SheetAdapterId;
  readonly modelId: ModelId;
  readonly additionalInstructions: string;
}

export interface ModelDefinition {
  readonly id: ModelId;
  readonly label: string;
  readonly description: string;
}

export interface RulesetDefinition {
  readonly id: RulesetId;
  readonly label: string;
}

export interface SheetAdapterDefinition {
  readonly id: SheetAdapterId;
  readonly rulesetId: RulesetId;
  readonly label: string;
}

export const MODELS: readonly ModelDefinition[] = [
  {
    id: "openai/gpt-5.2",
    label: "ChatGPT (GPT-5.2)",
    description: "OpenAI's current GM Tools default.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Anthropic's balanced agentic model.",
  },
];

export const RULESETS: readonly RulesetDefinition[] = [
  { id: "dnd5e", label: "D&D 5e" },
  { id: "vtm5", label: "Vampire: The Masquerade 5th Edition" },
  { id: "custom", label: "Custom prompt" },
];

export const SHEET_ADAPTERS: readonly SheetAdapterDefinition[] = [
  {
    id: "roll20-dnd5e-2014",
    rulesetId: "dnd5e",
    label: "D&D 5e 2014 by Roll20",
  },
  {
    id: "roll20-dnd5e-2024",
    rulesetId: "dnd5e",
    label: "D&D 5e 2024 by Roll20",
  },
  {
    id: "generic",
    rulesetId: "dnd5e",
    label: "Other / inspect attributes",
  },
  {
    id: "roll20-vtm5",
    rulesetId: "vtm5",
    label: "Vampire 5th Edition by Roll20",
  },
  {
    id: "generic",
    rulesetId: "vtm5",
    label: "Other / inspect attributes",
  },
  {
    id: "generic",
    rulesetId: "custom",
    label: "Custom / inspect attributes",
  },
];

export const DEFAULT_PROFILE: AssistantProfile = {
  id: "general-gm",
  name: "General GM",
  rulesetId: "custom",
  sheetAdapterId: "generic",
  modelId: "openai/gpt-5.2",
  additionalInstructions: "",
};

const BASE_INSTRUCTIONS = [
  "You are a practical assistant for a tabletop role-playing game master.",
  "Help with preparation, improvisation, rules-neutral ideas, descriptions, characters, and session management.",
  "You can inspect and modify the active game through execute_roll20, which runs JavaScript in the Roll20 Mod sandbox.",
  "Code passed to execute_roll20 is a function body: use Roll20 Mod globals directly and include an explicit return value for anything you need to observe.",
  "Return only JSON-serializable values from execute_roll20. Inspect relevant objects and attributes before modifying them, and do not invent object IDs or sheet attribute names.",
  "Roll20 Mod documentation begins at https://help.roll20.net/hc/en-us/articles/360037256714-Introduction-to-Mod-Scripts-API.",
  "Be concise by default, but include useful detail when the game master asks for it.",
].join(" ");

const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
  dnd5e: [
    "This profile is for Dungeons & Dragons Fifth Edition.",
    "Use 5e terminology and mechanics, but distinguish 2014 rules from 2024 rules when the answer depends on the edition.",
    "Never assume that similarly named community sheets use the same Roll20 attributes.",
  ].join(" "),
  vtm5: [
    "This profile is for Vampire: The Masquerade Fifth Edition (V5).",
    "Use V5 concepts such as Hunger dice, Humanity, Willpower, Disciplines, and attribute-plus-skill dice pools.",
    "Do not substitute rules or sheet conventions from Vampire editions other than V5.",
  ].join(" "),
  custom: [
    "This is a custom game profile.",
    "Use the game master's additional instructions as the source of game- and sheet-specific guidance.",
  ].join(" "),
};

const SHEET_INSTRUCTIONS: Record<SheetAdapterId, string> = {
  generic: [
    "The character sheet schema is not predefined.",
    "Before changing a character, inspect its existing attribute objects with findObjs and return the relevant names and values.",
    "Use getAttrByName to read defaults that may not yet have materialized as attribute objects; use findObjs or createObj when an actual attribute object must be changed or created.",
  ].join(" "),
  "roll20-dnd5e-2014": [
    "The campaign uses the legacy D&D 5e 2014 OGL sheet by Roll20.",
    "Common attributes include strength, strength_mod, dexterity, constitution, intelligence, wisdom, charisma, ac, hp (current and max), hp_temp, pb, speed, initiative_bonus, passive_wisdom, spell_save_dc, and spell_attack_bonus.",
    "Repeating attacks, inventory, traits, and spells use repeating-section attribute names; inspect the character's attributes to discover row IDs and exact field names before editing them.",
    "Read default or auto-calculated values with getAttrByName. To modify a value, locate its attribute object with findObjs and set current or max, creating it only when necessary.",
  ].join(" "),
  "roll20-dnd5e-2024": [
    "The campaign uses the Beacon-based D&D 5e 2024 sheet by Roll20.",
    "Prefer the Beacon-compatible getSheetItem and setSheetItem functions for sheet data rather than assuming legacy OGL attribute behavior.",
    "For example, getSheetItem(characterId, \"hp\") reads HP and setSheetItem(characterId, \"hp\", 20, \"max\") sets maximum HP.",
    "Attributes created only through the Mod API and not defined by the sheet require a user. prefix. Inspect before changing unfamiliar fields.",
    "Migration guidance is at https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-API-for-D-D-2024-Beacon.",
  ].join(" "),
  "roll20-vtm5": [
    "The campaign uses the Vampire: The Masquerade 5th Edition sheet by Roll20.",
    "Treat Hunger, Humanity, Health, Willpower, attributes, skills, Disciplines, and advantages as sheet-backed data, but inspect actual attribute names before reading or writing them.",
    "Community and localized V5 sheet variants may use different names. Change existing matching attributes when possible and do not create guessed attributes.",
  ].join(" "),
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
    includesValue(SHEET_ADAPTER_IDS, value.sheetAdapterId) &&
    SHEET_ADAPTERS.some(
      (sheet) =>
        sheet.id === value.sheetAdapterId &&
        sheet.rulesetId === value.rulesetId,
    ) &&
    includesValue(MODEL_IDS, value.modelId) &&
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
  return profiles.length > 0 ? profiles.slice(0, 50) : [DEFAULT_PROFILE];
}

export function getModelDefinition(modelId: ModelId): ModelDefinition {
  return MODELS.find((model) => model.id === modelId) ?? MODELS[0]!;
}

export function getRulesetDefinition(
  rulesetId: RulesetId,
): RulesetDefinition {
  return RULESETS.find((ruleset) => ruleset.id === rulesetId) ?? RULESETS[0]!;
}

export function getSheetAdapterDefinition(
  sheetAdapterId: SheetAdapterId,
  rulesetId: RulesetId,
): SheetAdapterDefinition {
  return (
    SHEET_ADAPTERS.find(
      (sheet) =>
        sheet.id === sheetAdapterId && sheet.rulesetId === rulesetId,
    ) ?? SHEET_ADAPTERS.find((sheet) => sheet.rulesetId === rulesetId)!
  );
}

export function sheetsForRuleset(
  rulesetId: RulesetId,
): readonly SheetAdapterDefinition[] {
  return SHEET_ADAPTERS.filter((sheet) => sheet.rulesetId === rulesetId);
}

export function buildProfileInstructions(profile: AssistantProfile): string {
  if (!isAssistantProfile(profile)) throw new Error("The assistant profile is invalid.");
  return [
    BASE_INSTRUCTIONS,
    RULESET_INSTRUCTIONS[profile.rulesetId],
    SHEET_INSTRUCTIONS[profile.sheetAdapterId],
    profile.additionalInstructions.trim()
      ? `Additional instructions from the game master:\n${profile.additionalInstructions.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createProfile(
  id: string,
  number: number,
): AssistantProfile {
  return {
    id,
    name: `D&D 5e Profile ${number}`,
    rulesetId: "dnd5e",
    sheetAdapterId: "roll20-dnd5e-2014",
    modelId: "openai/gpt-5.2",
    additionalInstructions: "",
  };
}
