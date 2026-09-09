import beacon from "./guides/beacon.md";
import dnd5eRoll20 from "./guides/dnd5e-roll20.md";

// D&D guidance incorporates our Beacon experiments and the 2014 importer references:
// https://github.com/ByteBard97/roll20-5e-npc-json-importer/blob/master/scripts/5e_NPC_JSON_Importer.js
// https://github.com/ByteBard97/roll20-5e-npc-json-importer/blob/master/README.md
// Raw Beacon store structures remain experimental, not a stable public API.
const GUIDES = [
  {
    id: "beacon",
    description: "Game-independent Beacon sheet inspection and safe API use; read before working with an unfamiliar Beacon sheet.",
    content: beacon.trim(),
  },
  {
    id: "dnd5e-roll20",
    description: "Roll20 D&D 2014 and 2024 sheet identification, initialization, and complete NPC/spell creation recipes. Supported sheet IDs: ogl5e, dnd2014byroll20, dnd2024byroll20.",
    content: dnd5eRoll20.trim(),
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
