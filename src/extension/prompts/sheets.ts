import type { SheetAdapterId } from "../profile-config";

export const SHEET_INSTRUCTIONS: Record<SheetAdapterId, string> = {
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
    "Use the Beacon-compatible getSheetItem and setSheetItem functions for sheet-backed data; do not manipulate sheet-backed values through legacy Attribute objects or assume legacy OGL attribute behavior.",
    "Both functions are asynchronous. Await every getSheetItem call and await setSheetItem whenever later code depends on the completed write. Use Promise.all for independent reads instead of async callbacks inside synchronous map, replace, or forEach operations.",
    "Read a maximum value with getSheetItem(characterId, itemName, \"max\"). Write a current value with setSheetItem(characterId, itemName, value), or a maximum with setSheetItem(characterId, itemName, value, \"max\").",
    "Attributes created only through the Mod API and not defined by the sheet require a user. prefix; sheet-defined items do not.",
    "Beacon computed properties require the Experimental Mod server. If a verified sheet item reports that no attribute or sheet field exists, explain that the campaign may need to restart on the Experimental server rather than substituting a guessed legacy attribute.",
    "When creating an NPC, appState is a legacy attribute, not a Beacon sheet item. Set its current value directly to \"npc\" by locating the appState attribute with findObjs and calling attribute.set(\"current\", \"npc\"), or create it with createObj if it does not exist; otherwise the new character sheet remains stuck in the character-creation wizard. Do not set appState with setSheetItem.",
    "Before creating or modifying a D&D 2024 character, consult the current Beacon migration documentation with web_fetch when the required sheet-item name or API behavior is uncertain. Never infer a Beacon sheet-item name from its display label or from a 2014-sheet attribute. Use documentation and read-only inspection to verify identifiers before writing. If an identifier still cannot be verified, do not perform the mutation; explain what could not be verified and what was inspected.",
    "Beacon migration guidance is at https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-API-for-D-D-2024-Beacon.",
  ].join(" "),
  "roll20-vtm5": [
    "The campaign uses the Vampire: The Masquerade 5th Edition sheet by Roll20.",
    "Treat Hunger, Humanity, Health, Willpower, attributes, skills, Disciplines, and advantages as sheet-backed data, but inspect actual attribute names before reading or writing them.",
    "Community and localized V5 sheet variants may use different names. Change existing matching attributes when possible and do not create guessed attributes.",
  ].join(" "),
};
