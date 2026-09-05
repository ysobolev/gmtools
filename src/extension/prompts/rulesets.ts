import type { RulesetId } from "../profile-config";
import { NPC_2014_INSTRUCTIONS } from "./npc-2014";

const GENERIC_SHEET_GUIDANCE = [
  "The character sheet schema may not be predefined.",
  "Never assume that similarly named community or custom sheets use the same Roll20 attributes.",
  "Before changing a character, inspect its existing attribute objects with findObjs and return the relevant names and values.",
  "Use getAttrByName to read defaults that may not yet have materialized as attribute objects; use findObjs or createObj when an actual attribute object must be changed or created.",
];

export const RULESET_INSTRUCTIONS: Record<RulesetId, string> = {
  dnd5e: [
    "## Dungeons & Dragons Fifth Edition",
    [
      "Use 5e terminology and mechanics, but distinguish 2014 rules from 2024 rules when the answer depends on the edition.",
      "The instructions below support the legacy 2014 and Beacon-based 2024 sheets by Roll20.",
      "For any other sheet, inspect its schema and do your best without pretending it is supported; ask the game master for sheet-specific help when inspection cannot establish what to do safely.",
    ].join(" "),
    "### Identify the campaign and character sheet",
    [
      "A campaign may use the legacy D&D 5e 2014 sheet, the Beacon-based D&D 5e 2024 sheet, or a mixture of both.",
      "When the campaign or target sheet type is not already established, inspect `Campaign().sheetName`, the target character's `sheetEnvironment` property, and `character.get(\"charactersheetname\")` before reading or changing sheet-backed data.",
      "Do not infer an existing character's sheet solely from the campaign default.",
    ].join(" "),
    "Once the campaign's sheet configuration or character-creation behavior is confidently established (for example, by successfully creating and initializing a character), reuse that knowledge from this chat instead of repeatedly probing the sandbox to rediscover it. If campaign memory is enabled, you may store the confirmed facts and their scope there for reuse across chats. Otherwise rely on the prior findings in this chat. Recheck only when the information is missing, uncertain, contradicted by new evidence, or the GM reports a configuration change. In mixed or potentially mixed campaigns, knowing what sheet new characters receive does not identify every existing character: inspect an unfamiliar target once and reuse its confirmed identity thereafter. This avoids redundant sheet-detection calls, not the inspection of current values and row IDs needed for a particular edit.",
    [
      "- `Campaign().sheetName === \"ogl5e\"` identifies the legacy 2014 Roll20 sheet.",
      "- Also recognize `\"dnd2014byroll20\"` as a possible legacy 2014 identifier.",
      "- `Campaign().sheetName === \"dnd2024byroll20\"` identifies a new-style 2024 campaign, which may or may not also support existing 2014 sheets.",
      "- Any other identifier may represent a custom or unsupported sheet and must not be treated as one of the supported Roll20 sheets without additional evidence.",
      "- For an existing character, `sheetEnvironment === \"beacon\"` identifies a manually created Beacon character in a 2024-only campaign.",
      "- In a mixed-sheet campaign, `sheetEnvironment` may be `null` for every character and therefore does not identify that character's sheet.",
    ].join("\n"),
    "Prefer a concrete value from `character.get(\"charactersheetname\")` when distinguishing existing sheets. Treat the campaign and `sheetEnvironment` values as supporting evidence.",
    [
      "A newly created character in a 2024-only campaign may initially report `sheetEnvironment === \"legacy\"` even though it has a 2024 Beacon sheet.",
      "This is a `createObj` artifact, not evidence that the character uses the 2014 sheet.",
      "It is worth trying an awaited `getSheetItem` call because that may complete Beacon initialization and populate `sheetEnvironment` as `\"beacon\"`, but this behavior is not guaranteed.",
      "If the markers still do not populate, a Roll20 page reload may be required; avoid asking the game master to reload unless initialization remains blocked and safer inspection cannot resolve it.",
    ].join(" "),
    [
      "Roll20 may populate `sheetEnvironment`, `charactersheetname`, `appState`, and other initialization attributes only after sheet functions run or the page reloads.",
      "A missing or not-yet-populated marker is inconclusive.",
      "After a relevant `getSheetItem` or sheet-worker operation, reacquire the character with `getObj` and query its attributes again before deciding its sheet type or creating a missing initialization attribute.",
      "Use positive, mutually consistent markers; do not classify a sheet from an absent marker.",
    ].join(" "),
    "The presence of an `appState` attribute does not identify a 2024 sheet because a 2014 character in a mixed-sheet campaign may also have `appState`. Use `appState` only after independently identifying the target as a 2024 character.",
    "### Create characters",
    [
      "Character creation is determined by the campaign type.",
      "`createObj(\"character\", ...)` creates a legacy 2014 character in a legacy campaign and always creates a 2024 Beacon character in any new-style campaign, including one with mixed-sheet support.",
      "`createObj` ignores sheet-selection properties such as `sheet`, `sheetName`, and `charactersheetname`, and the Mod API cannot change a character's sheet after creation.",
      "Do not claim that it can create a new 2014-sheet character in a new-style campaign or convert one afterward.",
    ].join(" "),
    "With no existing character, the Mod API cannot distinguish a 2024-only campaign from a new-style campaign that also permits 2014 sheets. Do not claim to have detected that capability; it does not change the fact that `createObj` will create a 2024 character.",
    "### Inspect character data",
    GENERIC_SHEET_GUIDANCE.join(" "),
    "### Legacy D&D 5e 2014 sheet",
    "Common attributes include `strength`, `strength_mod`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`, `ac`, `hp` (current and max), `hp_temp`, `pb`, `speed`, `initiative_bonus`, `passive_wisdom`, `spell_save_dc`, and `spell_attack_bonus`.",
    "Repeating attacks, inventory, traits, and spells use repeating-section attribute names. Inspect the character's attributes to discover row IDs and exact field names before editing them.",
    [
      "Read default or auto-calculated values with `getAttrByName`.",
      "To modify a value, locate its Attribute object with `findObjs` and set `current` or `max`, creating it only when necessary.",
      "Use `Attribute.setWithWorker` for sheet-backed changes that must trigger 2014 sheet workers.",
    ].join(" "),
    "When initializing a newly created 2014 character, clear the Level 1 Charactermancer with these current values:",
    [
      "- `l1mancer_status = \"completed\"`",
      "- `mancer_confirm_flag = \"\"`",
      "- `mancer_cancel = \"on\"`",
    ].join("\n"),
    "Locate or, after initialization and re-querying, create those Attribute objects. Write them with `attribute.setWithWorker({ current: value })`.",
    "To make a 2014 character an NPC, set the `npc` attribute's current value to `\"1\"` with `setWithWorker`. Do not substitute the 2024 `appState` recipe for this legacy-sheet operation.",
    NPC_2014_INSTRUCTIONS,
    "### Beacon-based D&D 5e 2024 sheet",
    "Use the Beacon-compatible `getSheetItem` and `setSheetItem` functions for sheet-backed data. Do not manipulate sheet-backed values through legacy Attribute objects or assume legacy OGL attribute behavior.",
    [
      "Both functions are asynchronous.",
      "Await every `getSheetItem` call, and await `setSheetItem` whenever later code depends on the completed write.",
      "Use `Promise.all` for independent reads instead of async callbacks inside synchronous `map`, `replace`, or `forEach` operations.",
    ].join(" "),
    [
      "- Read a maximum with `getSheetItem(characterId, itemName, \"max\")`.",
      "- Write a current value with `setSheetItem(characterId, itemName, value)`.",
      "- Write a maximum with `setSheetItem(characterId, itemName, value, \"max\")`.",
    ].join("\n"),
    "Attributes created only through the Mod API and not defined by the 2024 sheet require a `user.` prefix; sheet-defined items do not.",
    "#### Initialize a 2024 character",
    [
      "`appState` is a legacy Attribute object used by the Beacon sheet, not a Beacon sheet item.",
      "After allowing Beacon initialization to run, locate `appState` with `findObjs` and set its current value directly: use `\"npc\"` for an NPC or `\"sheet\"` for a player character.",
      "For example, use `attribute.set(\"current\", \"npc\")` for an NPC.",
      "Without the appropriate value, the sheet remains stuck on its dashboard or character-creation wizard.",
      "If the first lookup does not find `appState`, perform and await the relevant `getSheetItem` initialization read, reacquire the character, and re-query before creating the attribute.",
      "Do not set `appState` with `setSheetItem`, do not use its presence to identify the sheet, and do not confuse it with the 2014 `npc` attribute.",
    ].join(" "),
    "Before creating or modifying a D&D 2024 character, consult the current Beacon migration documentation with `web_fetch` when the required sheet-item name or API behavior is uncertain. Never infer a Beacon sheet-item name from its display label or from a 2014-sheet attribute. Use documentation and read-only inspection to verify identifiers before writing. If an identifier still cannot be verified, do not perform the mutation; explain what could not be verified and what was inspected.",
    "Beacon migration guidance: https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-API-for-D-D-2024-Beacon",
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
