import { DND5E_GUIDE } from "./dnd5e-guide";

const GUIDES = [
  {
    id: "beacon",
    description: "Game-independent Beacon sheet inspection and safe API use; read before working with an unfamiliar Beacon sheet.",
    content: [
      "## Beacon sheet fundamentals",
      "Beacon is a sheet technology, not a game system. Identify the actual sheet before choosing game-specific guidance. D&D initialization fields and store paths are not a universal Beacon schema.",
      "Use documented sheet interfaces and inspect the target's exposed computed-property metadata before modifying unfamiliar data. getComputed/setComputed require Sandbox v1.5; getSheetItem/setSheetItem exist in both sandbox versions and are not themselves evidence of Beacon support. Await asynchronous reads and writes. Verify exact names and whether computed properties are writable before using setComputed; do not infer identifiers from UI labels or legacy-sheet attribute names.",
      "Legacy Attribute objects do not necessarily represent Beacon's effective sheet values. Do not create guessed legacy attributes to work around missing sheet items. A sheet-owned store, when present, is implementation-specific: do not transplant D&D store structures, initialization flags, or action/spell schemas into another game's sheet.",
      "Read current target values before changes, and verify effective computed values afterward. Initialization and recalculation can be delayed; use bounded polling without repeatedly rewriting a value that does not match. A missing field or unfinished initialization is not proof that no sheet is configured. Do not claim success from a successful write alone.",
      "Use web_fetch for relevant Roll20 documentation when behavior is uncertain. If neither documentation nor inspection establishes a safe schema, explain the specific limitation and ask the game master for sheet-specific help rather than inventing a schema.",
      "For the supported D&D sheets, read dnd5e-roll20 for the tested initialization sequence, field mappings, and NPC recipes. Do not apply those recipes to other sheets merely because they use Beacon.",
    ].join("\n\n"),
  },
  {
    id: "dnd5e-roll20",
    description: "Roll20 D&D 2014 and 2024 sheet identification, initialization, and complete NPC/spell creation recipes. Supported sheet IDs: ogl5e, dnd2014byroll20, dnd2024byroll20.",
    content: DND5E_GUIDE,
  },
] as const;

export const GUIDE_CATALOG = GUIDES.map(({ id, description }) => ({ id, description }));

export function readGuide(guideId: string) {
  const guide = GUIDES.find(({ id }) => id === guideId);
  return guide
    ? { ok: true as const, guideId: guide.id, content: guide.content }
    : { ok: false as const, error: `Unknown guide: ${guideId}`, availableGuides: GUIDE_CATALOG };
}

export const GUIDE_INSTRUCTIONS = [
  "## On-demand sheet guides",
  "Use read_guide with a guideId from the catalog below before performing sheet operations covered by that guide, regardless of the selected profile. Guides are bundled reference material, not additional permissions. Reuse a guide already read in this chat while it remains applicable; do not read it again for every tool call.",
  "When the sheet is not already established for this campaign, inspect Campaign().sheetName (the direct property, not a guessed character_sheet field). For an existing target, also inspect its sheetEnvironment and charactersheetname; campaign defaults do not necessarily identify every character in a mixed campaign. Missing or delayed markers are inconclusive, not proof that there is no character sheet. Reuse confirmed campaign-scoped findings from this chat or campaign memory unless contradicted or the GM reports a change.",
  "Use recognized sheet identifiers as evidence of the game and choose matching guidance. Creature names such as kobold do not establish a game system. Custom or unfamiliar sheet IDs may not identify the game; use explicit user/profile guidance or ask the GM when needed. Knowing the game does not establish a custom sheet's schema. Do not invent a sheet-to-game lookup API or treat unsupported sheets as supported.",
  ...GUIDE_CATALOG.map(({ id, description }) => `- ${id}: ${description}`),
].join("\n\n");
