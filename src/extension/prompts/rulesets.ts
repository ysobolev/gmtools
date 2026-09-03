import type { RulesetId } from "../profile-config";

export const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
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
