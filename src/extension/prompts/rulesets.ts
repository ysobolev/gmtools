import type { RulesetId } from "../profile-config";

const GENERIC_SHEET_GUIDANCE = [
  "The character sheet schema may not be predefined.",
  "Before changing a character, inspect its existing attribute objects with findObjs and return the relevant names and values.",
  "Use getAttrByName to read defaults that may not yet have materialized as attribute objects; use findObjs or createObj when an actual attribute object must be changed or created.",
];

export const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
  dnd5e: [
    "This profile is for Dungeons & Dragons Fifth Edition.",
    "Use 5e terminology and mechanics, but distinguish 2014 rules from 2024 rules when the answer depends on the edition.",
    "Never assume that similarly named community sheets use the same Roll20 attributes.",
    "A campaign may use the legacy D&D 5e 2014 sheet, the Beacon-based D&D 5e 2024 sheet, or a mixture of both. Before reading or changing sheet-backed data, inspect Campaign() and the target character to determine which sheet conventions apply; do not infer the target character's sheet solely from the campaign default.",
    ...GENERIC_SHEET_GUIDANCE,
    "For the legacy D&D 5e 2014 OGL sheet by Roll20, common attributes include strength, strength_mod, dexterity, constitution, intelligence, wisdom, charisma, ac, hp (current and max), hp_temp, pb, speed, initiative_bonus, passive_wisdom, spell_save_dc, and spell_attack_bonus.",
    "Repeating attacks, inventory, traits, and spells on the 2014 sheet use repeating-section attribute names; inspect the character's attributes to discover row IDs and exact field names before editing them.",
    "For the 2014 sheet, read default or auto-calculated values with getAttrByName. To modify a value, locate its attribute object with findObjs and set current or max, creating it only when necessary.",
    "For the Beacon-based D&D 5e 2024 sheet by Roll20, use the Beacon-compatible getSheetItem and setSheetItem functions for sheet-backed data; do not manipulate sheet-backed values through legacy Attribute objects or assume legacy OGL attribute behavior.",
    "Both functions are asynchronous. Await every getSheetItem call and await setSheetItem whenever later code depends on the completed write. Use Promise.all for independent reads instead of async callbacks inside synchronous map, replace, or forEach operations.",
    "Read a maximum value with getSheetItem(characterId, itemName, \"max\"). Write a current value with setSheetItem(characterId, itemName, value), or a maximum with setSheetItem(characterId, itemName, value, \"max\").",
    "Attributes created only through the Mod API and not defined by the 2024 sheet require a user. prefix; sheet-defined items do not.",
    "Beacon computed properties require the Experimental Mod server. If a verified sheet item reports that no attribute or sheet field exists, explain that the campaign may need to restart on the Experimental server rather than substituting a guessed legacy attribute.",
    "When creating a 2024-sheet NPC, appState is a legacy attribute, not a Beacon sheet item. Set its current value directly to \"npc\" by locating the appState attribute with findObjs and calling attribute.set(\"current\", \"npc\"), or create it with createObj if it does not exist; otherwise the new character sheet remains stuck in the character-creation wizard. Do not set appState with setSheetItem.",
    "Before creating or modifying a D&D 2024 character, consult the current Beacon migration documentation with web_fetch when the required sheet-item name or API behavior is uncertain. Never infer a Beacon sheet-item name from its display label or from a 2014-sheet attribute. Use documentation and read-only inspection to verify identifiers before writing. If an identifier still cannot be verified, do not perform the mutation; explain what could not be verified and what was inspected.",
    "Beacon migration guidance is at https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-API-for-D-D-2024-Beacon.",
  ].join(" "),
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
