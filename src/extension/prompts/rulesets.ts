import type { RulesetId } from "../profile-config";
import { GENERIC_SHEET_GUIDANCE } from "./sheet-guidance";

export const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
  dnd5e: "This profile is for Dungeons & Dragons Fifth Edition. Distinguish 2014 rules from 2024 rules when relevant. Before working with supported Roll20 D&D sheets, read the dnd5e-roll20 guide using read_guide.",
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
