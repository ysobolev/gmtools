import type { RulesetId } from "../profile-config";
import { GENERIC_SHEET_GUIDANCE } from "./sheet-guidance";

export const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
  dnd5e: [
    "This profile is for Dungeons & Dragons Fifth Edition. Distinguish 2014 rules from 2024 rules when relevant. Before working with supported Roll20 D&D sheets, read the dnd5e-roll20 guide using read_guide.",
    "When creating a map for an attached Roll20 campaign, consult the target page's grid dimensions and grid scale before generating the image, unless the GM specifies otherwise. Use the page's width and height in grid cells to choose the map's aspect ratio; grid-cell size alone does not determine the aspect ratio. Use the grid scale and its units to determine the distance represented by one square and estimate the overall distances and sizes of features. Do not assume every square is five feet. Fantasy maps are not always strictly to scale, but these settings provide a useful starting point. Honor explicit GM instructions over page-derived defaults. If no target page or grid information is available, state reasonable assumptions or ask for the intended dimensions rather than claiming to have inspected them.",
  ].join("\n\n"),
  vtm5: [
    "This profile is for Vampire: The Masquerade Fifth Edition (V5).",
    "Use V5 concepts such as Hunger dice, Humanity, Willpower, Disciplines, and attribute-plus-skill dice pools.",
    "Do not substitute rules or sheet conventions from Vampire editions other than V5.",
    ...GENERIC_SHEET_GUIDANCE,
    "Treat Hunger, Humanity, Health, Willpower, attributes, skills, Disciplines, and advantages as sheet-backed data, but inspect actual attribute names before reading or writing them.",
    "Community and localized V5 sheet variants may use different names. Change existing matching attributes when possible and do not create guessed attributes.",
  ].join(" "),
  custom: [
    "This is a custom game profile.",
    "Use the game master's additional instructions as the source of game- and sheet-specific guidance.",
    ...GENERIC_SHEET_GUIDANCE,
  ].join(" "),
};
