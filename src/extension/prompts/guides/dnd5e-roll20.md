## Dungeons & Dragons Fifth Edition

Use 5e terminology and mechanics, but distinguish 2014 rules from 2024 rules when the answer depends on the edition. The instructions below support the legacy 2014 and Beacon-based 2024 sheets by Roll20. For any other sheet, inspect its schema and do your best without pretending it is supported; ask the game master for sheet-specific help when inspection cannot establish what to do safely.

### Playable encounters

When setting up an encounter with creatures or NPCs, make them playable, not merely decorative tokens. Unless the GM explicitly requests map artwork or markers only, import suitable compendium characters when available or create populated NPC sheets, then link their tokens. Finding compendium artwork is not a substitute for importing or creating the character's statistics. Multiple interchangeable creatures may share one sheet, with independent current HP on each token. Custom NPCs need usable sheet statistics, not just suggested stats in notes.

For token bars on either sheet, display AC as a single whole number (for example, 16), not a current/max fraction such as 16/16. Set the AC bar's value to the verified AC and leave its maximum empty. HP should retain its current/max values.

### Identify the campaign and character sheet

A campaign may use the legacy D&D 5e 2014 sheet, the Beacon-based D&D 5e 2024 sheet, or a mixture of both. When the campaign or target sheet type is not already established, inspect `Campaign().sheetName`, the target character's `sheetEnvironment` property, and `character.get("charactersheetname")` before reading or changing sheet-backed data. Do not infer an existing character's sheet solely from the campaign default.

Once the campaign's sheet configuration or character-creation behavior is confidently established (for example, by successfully creating and initializing a character), reuse that knowledge from this chat instead of repeatedly probing the sandbox to rediscover it. If campaign memory is enabled, you may store the confirmed facts and their scope there for reuse across chats. Otherwise rely on the prior findings in this chat. Recheck only when the information is missing, uncertain, contradicted by new evidence, or the GM reports a configuration change. In mixed or potentially mixed campaigns, knowing what sheet new characters receive does not identify every existing character: inspect an unfamiliar target once and reuse its confirmed identity thereafter. This avoids redundant sheet-detection calls, not the inspection of current values and row IDs needed for a particular edit.

- `Campaign().sheetName === "ogl5e"` identifies the legacy 2014 Roll20 sheet.
- Also recognize `"dnd2014byroll20"` as a possible legacy 2014 identifier.
- `Campaign().sheetName === "dnd2024byroll20"` identifies a new-style 2024 campaign, which may or may not also support existing 2014 sheets.
- Any other identifier may represent a custom or unsupported sheet and must not be treated as one of the supported Roll20 sheets without additional evidence.
- For an existing character, `sheetEnvironment === "beacon"` identifies a manually created Beacon character in a 2024-only campaign.
- In a mixed-sheet campaign, `sheetEnvironment` may be `null` for every character and therefore does not identify that character's sheet.

Prefer a concrete value from `character.get("charactersheetname")` when distinguishing existing sheets. Treat the campaign and `sheetEnvironment` values as supporting evidence.

A newly created character in a 2024-only campaign may initially report `sheetEnvironment === "legacy"` even though it has a 2024 Beacon sheet. This is a `createObj` artifact, not evidence that the character uses the 2014 sheet. It is worth trying an awaited `getSheetItem` call because that may complete Beacon initialization and populate `sheetEnvironment` as `"beacon"`, but this behavior is not guaranteed. If the markers still do not populate, a Roll20 page reload may be required; avoid asking the game master to reload unless initialization remains blocked and safer inspection cannot resolve it.

Roll20 may populate `sheetEnvironment`, `charactersheetname`, `appState`, and other initialization attributes only after sheet functions run or the page reloads. A missing or not-yet-populated marker is inconclusive. After a relevant `getSheetItem` or sheet-worker operation, reacquire the character with `getObj` and query its attributes again before deciding its sheet type or creating a missing initialization attribute. Use positive, mutually consistent markers; do not classify a sheet from an absent marker.

The presence of an `appState` attribute does not identify a 2024 sheet because a 2014 character in a mixed-sheet campaign may also have `appState`. Use `appState` only after independently identifying the target as a 2024 character.

### Create characters

Observed creation behavior appears to depend on the campaign's original sheet configuration, not just its current default: campaigns originally created with 2014 have continued to create legacy characters after adding 2024 support, while campaigns originally created with 2024 have continued to create Beacon characters even with a 2014 default selected. Treat this as an observed pattern, not a guaranteed API contract. `Campaign().sheetName === "dnd2024byroll20"` does not guarantee that `createObj("character", ...)` creates a Beacon character. `createObj` ignores sheet-selection properties such as `sheet`, `sheetName`, and `charactersheetname`, and the Mod API cannot change a character's sheet after creation.

After creating each character, reacquire it and read `character.get("charactersheetname")` before choosing the legacy or Beacon initialization recipe. Include this check in the creation or next initialization call; no separate discovery call is required when the marker is already populated. Allow for delayed initialization as described above. If the identity remains unknown or contradictory, use bounded checks and ask the GM for help if necessary rather than inventing a Beacon store. Successful `getComputed` or `setComputed` calls alone do not establish the character's sheet type: they have been observed to work initially on a character later identified as `ogl5e`. A concrete legacy identity takes precedence over the campaign default and those successful calls.

With no existing character, the Mod API cannot distinguish a 2024-only campaign from a new-style campaign that also permits 2014 sheets. Do not claim to have detected that capability or infer which sheet a new character will receive from the campaign label alone.

### Inspect character data

The character sheet schema may not be predefined. Never assume that similarly named community or custom sheets use the same Roll20 attributes. Before changing a character, inspect its existing attribute objects with findObjs and return the relevant names and values. For legacy attribute-backed sheet data, use getAttrByName to read defaults that may not yet have materialized as attribute objects; use findObjs or createObj when an actual attribute object must be changed or created. For Beacon sheet data, read the relevant guide instead of assuming legacy attributes represent the effective values.

### Legacy D&D 5e 2014 sheet

Common attributes include `strength`, `strength_mod`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`, `ac`, `hp` (current and max), `hp_temp`, `pb`, `speed`, `initiative_bonus`, `passive_wisdom`, `spell_save_dc`, and `spell_attack_bonus`.

Repeating attacks, inventory, traits, and spells use repeating-section attribute names. Inspect the character's attributes to discover row IDs and exact field names before editing them.

Read default or auto-calculated values with `getAttrByName`. To modify a value, locate its Attribute object with `findObjs` and set `current` or `max`, creating it only when necessary. Use `Attribute.setWithWorker` for sheet-backed changes that must trigger 2014 sheet workers.

When initializing a newly created 2014 character, clear the Level 1 Charactermancer with these current values:

- `l1mancer_status = "completed"`
- `mancer_confirm_flag = ""`
- `mancer_cancel = "on"`

Locate or, after initialization and re-querying, create those Attribute objects. Write them with `attribute.setWithWorker({ current: value })`.

To make a 2014 character an NPC, set the `npc` attribute's current value to `"1"` with `setWithWorker`. Do not substitute the 2024 `appState` recipe for this legacy-sheet operation.

#### Build a complete NPC on the 2014 Roll20 sheet

Implement this recipe directly through execute_roll20 using standard Mod objects and functions. The reference importer need not be installed; do not call its private helpers or chat commands.

When asked to create an NPC, carry the request through to a usable character sheet, not just a proposed stat block or a character with a name. Pick an ancestry-appropriate fantasy name unless the GM supplies one or requests otherwise. Choose reasonable ability scores, equipment, proficiencies, subclass, class features, and other unspecified details yourself, respecting campaign instructions. Briefly report the choices afterward rather than asking the GM to fill out a character-building questionnaire.

For this 2014-sheet recipe, default to 2014 D&D 5e rules unless the GM explicitly requests 2024/5.5e. Rules edition and sheet technology are distinct: never silently override an explicit edition request. Apply this recipe only to a positively identified 2014 sheet, including a legacy character created in a mixed campaign. If the new character is identified as 2024, follow the separate Beacon guidance instead. Do not switch campaign settings or force one recipe onto the other sheet; report any unsupported creation steps.

A class level is not a challenge rating. A 'level 3 gnome warlock NPC' means a 3rd-level warlock represented using the NPC sheet, not a CR 3 monster. Give it level-appropriate class and racial features, hit points, proficiency, and Pact Magic. Set CR/XP only when requested or when you can justify an estimate; label estimates. Never use a monster CR benchmark's HP or damage as the class character's stats merely because its level is the same number.

##### Creation and worker sequencing

- Establish the campaign and target sheet type first, reusing confirmed findings from chat or enabled campaign memory rather than probing again. Inspect an existing target's current data before edits. For a new NPC, create a character with its chosen name and brief bio; keep controlledby and inplayerjournals empty unless the GM requested sharing. Return its actual character ID early and use that ID in subsequent calls.
- Use a local attribute-upsert helper: findObjs({ type: 'attribute', characterid: characterId, name })[0], or createObj('attribute', { characterid: characterId, name }) if absent; then call attribute.setWithWorker({ current: value }) (and max when appropriate). Reuse attributes rather than making duplicate names. Merely passing current to createObj does not replace an explicit worker-triggering write.
- Initialize npc='1', charactersheet_type='npc', character_name and npc_name. Apply the Charactermancer values above: l1mancer_status='completed', mancer_confirm_flag='', mancer_cancel='on'. Set npc_options-flag='0' to close the NPC editor after setup. Do not overwrite version, sheet_version, npc_version, or sheet-identity markers with the importer's hard-coded versions.
- Batch related source-field writes. When waiting for derived fields, register onSheetWorkerCompleted(callback) BEFORE the setWithWorker calls, and wrap completion in an awaited Promise with a bounded timeout. setWithWorker itself is not an awaitable worker-completion promise. Re-read derived fields after completion; the callback alone is not proof that every field is correct.
- Allow for asynchronous initialization. The reference importer reports roughly 5–25 seconds for complex NPCs, so a fixed one-second sleep is not a completion guarantee. Use a few bounded phases (create/initialize, populate, verify/repair); return progress and IDs before the tool deadline. Never leave a fire-and-forget timer to finish creation after reporting success. If a tool times out, inspect the known character before deciding what remains; do not repeat the whole creation script or create a duplicate.

##### Core attributes and calculated values

- Identity: npc_size, npc_type, npc_alignment; record ancestry, class/level, subclass and equipment in the bio and relevant traits so the NPC's build is evident.
- Defenses and movement: npc_ac (numeric AC), npc_actype and npc_ac_notes (armor explanation), hp with both current and max, npc_hp, npc_hpbase, npc_hpformula (hit-dice expression), and npc_speed. NPC AC uses npc_ac; writing only the PC ac field is insufficient.
- Abilities: strength, dexterity, constitution, intelligence, wisdom, charisma and their corresponding <ability>_base values. Verify <ability>_mod = floor((score - 10) / 2) after workers run.
- Proficiency: for a class-level build use pb_type='custom', pb_custom and pb equal to its numeric proficiency bonus, plus npc_pb as its signed display bonus. Derive it from class level, not an assumed CR. For a stat-block monster use its actual proficiency and npc_challenge/npc_xp where known.
- Saves: the importer populates npc_<short>_save, npc_<short>_save_base, npc_<short>_save_flag (short = str/dex/con/int/wis/cha), plus <full>_save_bonus. The numeric field is the TOTAL save bonus; _base is its signed display value. Its flags are '0' for the ability modifier alone, '1' for modifier plus proficiency, '2' for a custom total. It also mirrors npc_<full>_save/_base/_flag. Check worker output rather than assuming every mirrored field is necessary. npc_saving_flag is a bit mask: str=1, dex=2, con=4, int=8, wis=16, cha=32 for displayed non-default saves.
- Skills: use the exact sheet keys (including animal_handling and sleight_of_hand). For each trained/custom skill populate npc_<skill>, npc_<skill>_base, npc_<skill>_bonus, npc_<skill>_flag and <skill>_bonus; use the total bonus, including expertise if applicable, not just proficiency. Set npc_skills_flag='1' when displaying skills. Do not collapse multiword names into animalhandling or sleightofhand. Verify passive_wisdom = 10 + total Perception bonus and initiative_bonus = Dexterity modifier plus actual initiative features.
- Other stat-block fields: npc_vulnerabilities, npc_resistances, npc_immunities, npc_condition_immunities, npc_senses (include darkvision and passive Perception where appropriate), npc_languages. Preserve full qualifications such as advantage only on certain saves as traits; do not turn conditional advantages into permanent numeric bonuses or immunities.

##### Traits, actions, and useful shortcuts

Create real repeating rows so the NPC sheet itself is usable. Attribute names have the form repeating_<section>_<rowId>_<field>. For EVERY manually created repeating row (traits, actions, spells, linked attacks, etc.), generate a Roll20-style ID in JavaScript: exactly 20 characters, one leading dash followed by 19 random characters. Use the alphanumeric alphabet A-Z, a-z, 0-9 for our generated suffixes; validate those generated IDs with /^-[A-Za-z0-9]{19}$/ before writing any row attributes. Do not use UUIDs, descriptive names, counters, shortened IDs, or extra prefixes as row IDs. Do not assume generateRowID is a Mod global. Existing Roll20-generated IDs may use other characters such as additional dashes: preserve actual existing IDs exactly, rather than applying our generator's narrower alphabet rule to them. Character, attribute, ability, token and other object IDs must come from Roll20 objects; never manufacture or replace those IDs.

Generate one fresh unique row ID per new row, check for collisions with existing rows and IDs generated in the current operation, and use that SAME ID for all fields belonging to that row. Never share an ID between different new rows or reuse a source character's row IDs when copying to another character. Generate fresh destination IDs and remap spellattackid, rollcontent, Ability references and row order to the destination character and rows. This is a defensive creation convention, not a reason to rename existing rows. Return and reuse the same character's established row IDs during repairs so retries update rather than duplicate rows. Upsert _reporder_repeating_<section> as a comma-separated list of row IDs; preserve existing order and append new IDs when editing.

- Traits: repeating_npctrait rows use name and desc. Trigger setWithWorker on desc so the displayed text initializes. Include racial features, class/subclass features, invocations, pact boon, resource/recharge rules, and a concise spellcasting trait as applicable.
- Actions: repeating_npcaction rows use name and description (not desc). Text-only actions should preserve all mechanics, including save DC/ability, targets, conditions, duration, and recharge. Multiattack should explain its component attacks, not invent a single combined attack roll.
- Attack actions: set attack_flag='on', attack_type, attack_range, attack_target, attack_tohit (total numeric attack bonus), attack_damage (full dice expression including modifier), and attack_damagetype. For a second damage component use attack_damage2 and attack_damagetype2. Critical dice fields attack_crit/attack_crit2 must contain the extra dice only, not duplicated flat modifiers. Preserve riders and saving throws in description.
- Check the worker-generated attack_tohitrange, attack_onhit, damage_flag, attack_display_flag, attack_options and rollbase. The importer's display flag is '{{attack=1}}', and damage_flag uses '{{damage=1}} {{dmg1flag=1}}' plus '{{dmg2flag=1}}' when needed. Those are template fragments, not booleans. Do not blindly replace working worker-generated roll formulas.
- Bonus actions: repeating_npcbonusaction; enable npcbonusactionsflag='1'. The importer fills name/description and mirrors them as wp_name/wp_description with corresponding wp_* attack fields and wp_rollbase. Inspect the actual initialized row to determine which fields/buttons this sheet version uses; do not assume its text-only bonus-action implementation automates bonus-action attacks.
- Reactions: repeating_npcreaction with name and desc, with a worker-triggering desc write; enable npcreactionsflag='1'. Legendary actions, when appropriate, use repeating_npcaction-l and npc_legendary_actions for the per-round count. Preserve action costs and triggers. Do not grant legendary, mythic or lair actions to an ordinary class-level NPC merely because the sheet supports them.

Provide character Ability objects (createObj('ability', { characterid: characterId, name, action, istokenaction: true })) for useful combat shortcuts: attacks, initiative, and frequently used actions/reactions. Prefer verified native sheet roll buttons referenced with %{characterId|buttonName}, including exact repeating row IDs. A rollbase ATTRIBUTE containing macro text is not automatically a callable button named rollbase: do not blindly copy the importer's %{characterId|repeating_..._rollbase} references. If the native button cannot be verified, create a self-contained Ability macro with fully qualified @{characterId|attributeName} references and explicit inline rolls for the attack/damage/save details. Never copy a row-local formula with unqualified @{name} or @{attack_tohit} into an Ability outside that row's context.

Check that shortcut descriptions contain actual ability text, not the literal '1'. The importer writes show_desc='1' while some formulas interpolate @{show_desc} as the description; inspect the installed sheet's expected value and resolved output. Preserve or deliberately configure the sheet's whisper/advantage settings; dtype='full' enables automatic damage and critical rolls. Avoid unresolved rtype/wtype references to missing toggle attributes. Initiative shortcuts should use the initiative modifier and tracker behavior, not merely print a number. Keep complicated choices or conditional riders in readable output when full automation cannot represent them faithfully.

##### Spellcasting and Pact Magic

Set npcspellcastingflag='1', caster_level, and spellcasting_ability using the sheet formula (for Charisma, '@{charisma_mod}+'), after ability scores and proficiency are initialized. Populate lvl1_slots_total through lvl9_slots_total according to the actual build. A 2014 level-3 warlock has two 2nd-level Pact Magic slots, recovered on a short rest; do not give it the standard full-caster slot progression. Describe Pact Magic separately from racial/innate spells or at-will abilities. Choose appropriate known spells/cantrips and list them, their resource rules, and the selected invocations/pact boon in traits.

Verify spell_save_dc = 8 + proficiency + casting modifier and spell_attack_bonus = proficiency + casting modifier, adjusted for real features. The README notes these may remain stale after import. First reapply spellcasting_ability with setWithWorker after dependent fields settle and re-read. If needed, try one bounded 'None' then restore cycle, awaiting worker completion between writes and restoring the intended value before returning. Do not endlessly toggle, assume a delay fixed it, or start by asking the GM to reload. Report any unresolved calculation explicitly.

Do not blindly set caster_level to total character or class level: the NPC sheet's slot calculation may require an effective caster level for partial casters. In the GM's verified 2014 level-3 Arcane Trickster example, caster_level='1', lvl1_slots_total=2, and lvl2_slots_total through lvl9_slots_total=0. Adjust caster_level to obtain the correct progression, or manually override slot totals after workers settle. Then re-read ALL slot totals; a correct prose description does not mean the sheet is correct. Keep actual class level and features unchanged and do not derive proficiency or cantrip scaling from this sheet workaround. For a newly created, fully rested character initialize lvlN_slots_expended to 0; when editing an existing character preserve spent resources unless asked to reset them. Confirm later worker updates have not overwritten your slot corrections.

##### Populate the 2014 spellbook directly

Compendium access and the reference importer are not required to create spell rows. Use known 2014 SRD/basic-rules spell definitions or definitions supplied by the GM, keeping mechanics and edition consistent. Create actual spellbook entries for the selected spells, not only a Spellcasting trait. The following mapping comes from the GM's manually imported ogl5e spell rows; it establishes SPELLCARD entries and the spell-side link for an ATTACK entry, not every attack/healing automation variant.

- Use repeating_spell-cantrip_<rowId>_<field> for cantrips and repeating_spell-1_<rowId>_<field> through repeating_spell-9_<rowId>_<field> for leveled spells. Generate a fresh unique row ID with the repeating-row method above; these are locally created IDs, not compendium IDs. Reuse that ID for every field of the spell and in subsequent repairs. Preserve/append _reporder_repeating_spell-cantrip or _reporder_repeating_spell-N. Inspect existing rows first to avoid duplicating spells.
- Core fields: spellname, spelllevel ('cantrip' or the level as a string), spellschool (e.g. 'illusion'), spellcastingtime, spellrange, spelltarget, spellduration, spelldescription, spellathigherlevels, and spellcomp_materials. Include the complete relevant mechanics, limitations and higher-level effects, not just flavor text. Set spelloutput='SPELLCARD', spell_ability='spell', spellattack='None' for these non-attack cards, and options-flag=0 and details-flag=0 for a collapsed presentation.
- If a spell is prepared, explicitly set its row's spellprepared='1'. Do not merely describe it as prepared in prose. Choose and mark an appropriate prepared selection when the build uses preparation; do not mark every spell in a spellbook as prepared or confuse spells known with preparation. Verify the stored flags against the intended selection.
- Components are template fragments: spellcomp_v='{{v=1}}', spellcomp_s='{{s=1}}', spellcomp_m='{{m=1}}' when present, and 0 when absent. The observed concentration value is spellconcentration='{{concentration=1}}', otherwise ''. These are not ordinary true/false flags. The supplied examples have spellritual=''; verify the enabled ritual representation before setting it, and preserve ritual eligibility in the description regardless.
- For the non-damaging cards shown, unused fields are empty strings: innate, spellclass, spellsource, spell_damage_progression, spelldamage, spelldamage2, spelldamagetype, spelldamagetype2, spelldmgmod, spellhealing, spellhlbonus, spellhldie, spellhldietype, spellsave and spellsavesuccess. Do not erase applicable mechanics just to copy these defaults: for a different spell include its save, damage or healing in the description and use verified automation fields where available. roll_output_dc was the numeric spell DC; verify it after initialization rather than copying the sample's 12.
- Populate fields with the attribute-upsert/setWithWorker workflow, await bounded worker completion, then inspect the rows. rollcontent was populated on one imported card but empty on the others, so an empty stored rollcontent alone does not prove failure. Do not copy a different spell's rollcontent or hard-code the sample's level-1 upcast query for cantrips or other spell levels. Prefer native sheet-generated/default rolls and verified button references. If a shortcut needs a fallback, use a self-contained, fully qualified spell-card Ability rather than an invented repeating roll button name.

Attack spell example: the GM's imported 2014 Chromatic Orb row has spelloutput='ATTACK', spellattack='Ranged', spell_ability='spell', spelldamage='3d8', spelldmgmod='', and spelldamagetype listing acid, cold, fire, lightning, poison, or thunder as alternatives, not six simultaneous damage components. Its higher-slot increment is spellhldie='1', spellhldietype='d8', with spellathigherlevels explaining one extra d8 per slot level above 1st. Preserve its 90-foot range, target, material requirement and choice of damage type. These are this spell's values, not defaults for all attack spells; do not add the casting ability modifier to damage unless the spell or a real feature calls for it.

An ATTACK spell also needs a linked repeating_attack row: spellattackid holds that attack row's ID (distinct from the spell row ID), and rollcontent has the form %{characterId|repeating_attack_<attackRowId>_attack}. Use the actual character and attack IDs, never the sample IDs. Populate spell source fields with setWithWorker, await completion, and inspect whether the worker created or updated the linked attack before creating anything yourself. Verify the target row exists and its attack bonus, damage, critical dice and higher-slot behavior match the spell. The supplied export does not include the linked attack row's fields, so do not invent that schema or assume setting spellattackid alone creates it. If manual repair is needed, inspect a working linked attack or documentation, reuse its verified structure with fresh IDs, and keep the link consistent. Avoid duplicate attack rows on retries. If the link cannot be made usable, retain a readable spell card and a verified standalone shortcut, and report the missing native attack automation.

For attack, damage, healing, scaling or automatic slot-use behavior not demonstrated by these cards, inspect a matching working row or sheet documentation before promising automation. A complete readable spell card is still useful when that automation cannot be established; add verified combat shortcuts where possible. Report any remaining automation limitations explicitly, but do not skip spellbook creation solely because compendium import is unavailable. Verify spell names, levels, definitions, component/concentration flags, row order, and intended casting ability/DC along with the slot totals. Do not claim a roll button or resource decrement was tested merely because its attributes were saved.

##### Verify and finish

Re-read the created character and its attributes after workers settle. Check HP current/max, AC, abilities/modifiers, saves/skills, proficiency, spell DC/attack, repeating row names/descriptions/order, and the Ability objects and their referenced fields. Inspect for duplicate attributes, malformed dice, unresolved references, and lost riders. Successful attribute creation is not proof that roll buttons work; distinguish storage verification from an actually tested roll. Repair the known character and rows rather than generating replacements. Return a compact verification result with character ID, name, key stats, created actions/shortcuts, and any unresolved items, then give the GM a short completion summary.

When the experimental image tools are available and artwork is part of the request, follow the general Roll20 layers and image assets guidance. Otherwise, skip artwork import and do not claim to have uploaded artwork. If the GM supplied an existing token for this NPC, it can be linked via represents, configured with independent HP and AC bars, and saved with setDefaultTokenForCharacter after configuration; do not repurpose an unrelated token or expose its bars/name to players without a reason. Without an existing suitable token or a usable image workflow, complete the character and token-action Abilities and leave artwork/default-token setup for later.

### Beacon-based D&D 5e 2024 sheet

Use verified Beacon interfaces: `getSheetItem` and `setSheetItem`, or the tested `getComputed`/`setComputed` properties in the NPC recipe below. Do not assume legacy OGL attribute behavior. The recipe explicitly identifies appState and the sheet-owned store Attribute as exceptions requiring direct Attribute access; raw store edits are experimental and must be verified.

Both functions are asynchronous. Await every `getSheetItem` call, and await `setSheetItem` whenever later code depends on the completed write. Use `Promise.all` for independent reads instead of async callbacks inside synchronous `map`, `replace`, or `forEach` operations.

- Read a maximum with `getSheetItem(characterId, itemName, "max")`.
- Write a current value with `setSheetItem(characterId, itemName, value)`.
- Write a maximum with `setSheetItem(characterId, itemName, value, "max")`.

Attributes created only through the Mod API and not defined by the 2024 sheet require a `user.` prefix; sheet-defined items do not.

#### Initialize a 2024 character

`appState` is a legacy Attribute object used by the Beacon sheet, not a Beacon sheet item. Immediately after creation, locate `appState` with `findObjs` and set its current value directly: use `"npc"` for an NPC or `"sheet"` for a player character. Select the mode before setting dependent stats. For example, use `attribute.set("current", "npc")` for an NPC. Without the appropriate value, the sheet remains stuck on its dashboard or character-creation wizard. If the first lookup does not find `appState`, reacquire the character and re-query before creating the attribute. On a new character, create it if still absent; do not rely on an uninitialized computed read as an initialization barrier. Do not set `appState` with `setSheetItem`, do not use its presence to identify the sheet, and do not confuse it with the 2014 `npc` attribute.

Before creating or modifying a D&D 2024 character, consult the current Beacon migration documentation with `web_fetch` when the required sheet-item name or API behavior is uncertain. Never infer a Beacon sheet-item name from its display label or from a 2014-sheet attribute. Use documentation and read-only inspection to verify identifiers before writing. If an identifier still cannot be verified, do not perform the mutation; explain what could not be verified and what was inspected.

Beacon migration guidance: https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-API-for-D-D-2024-Beacon

#### Build a complete NPC on the Beacon 2024 sheet

Use execute_roll20 directly; no importer, browser control, local reference PDF, or pre-existing template character is required or available to you by default. Default to 2024/5.5e rules and spell definitions for this recipe unless the GM requests otherwise. Sheet technology does not override an explicit rules-edition request. This is an NPC recipe, not a validated PC class/species/background builder. Prefer Compact layout for spellcasters and anything beyond a very simple monster. Stat Block layout has reduced editing capabilities, including limitations around multiple damage types; do not switch layouts as an initialization workaround.

##### 1. Establish the intended creature before writing

If supplied a stat block, read it and preserve its printed totals, exceptions, triggers, riders, action categories, spellcasting blocks, and resource limits. Otherwise generate a coherent stat block first, choosing reasonable unspecified details and an appropriate name rather than making the GM answer a questionnaire. A requested class level is not a CR: emulate the intended class features in an NPC stat block; do not bolt on a PC class progression or automatically set CR equal to level.

Transcribe first, then interpret. For a supplied stat block, build a JSON-serializable source object containing the literal printed values before calculating or inferring mechanics. Preserve signs, units, parentheses, dice expressions, and exceptions as text. Include the numeric stat lines and tables, movement, defenses, senses/languages, and feature/action/spellcasting text and limits; do not silently skip initiative or passive scores. Mark absent fields as { status:'absent' } and unreadable fields as { status:'unreadable' }; never fill those source fields from formulas, remembered rules, or sheet defaults. For example, source:{initiative:'+11 (21)',dexterity:'23',proficiencyBonus:'+5'} records three independent printed values. Never subtract assumed Dexterity or proficiency contributions from a printed total in source. If no source stat block was supplied, mark source as { status:'generated' } rather than presenting invented values as a transcription.

Record the interpreted target stats as a separate JSON-serializable expected object in an early execute_roll20 result, before substantive stat writes. Include both objects in the first creation/initialization call's return alongside the actual characterId: return { characterId, source, expected }; preliminary campaign discovery calls may come first. No separate recording tool or extra round trip is needed. expected describes the intended finished creature, NOT what that call has already completed. Include HP current/max and hit dice, AC, CR/XP/PB, ability scores, save and skill totals, passive scores, initiative bonus AND score when printed, movement, defenses, senses/languages, and the expected traits, actions/categories, spellcasting/DCs, spells and resource limits. Check expected against source before writing. Preserve printed numbers independently of inferred mechanics; record absent or unreadable values as unknown rather than silently substituting a formula. For example, printed Initiative +11 (21) means initiativeBonus:11 and initiativeScore:21, even if Dexterity alone gives +6 or proficiency might later contribute +5. expected contains final totals, not partial contributions. These are examples, not defaults for other creatures.

Reuse the returned expected data from tool history throughout the staged build. Sandbox variables do not persist between calls, so reconstruct the needed targets from that result in later calls; do not store this bookkeeping on the character sheet. Do not replace expected values with sheet readbacks merely to make verification pass. Revise a target only for a genuine source-reading correction or a GM-requested change, and explicitly report that revision.

Infer underlying mechanics when supported by the numbers. Compare a skill bonus with its ability modifier, modifier + PB, modifier + 2*PB (expertise), and modifier + floor(PB/2) where an applicable half-proficiency feature explains it. Prefer matching proficiency/expertise over a redundant total override. Apply the same reasoning to saves and attacks. Do not grant a bard feature merely because a number happens to match half proficiency. If no supported explanation fits, preserve the printed total with an override. Explicit stat-block DCs, attack/damage bonuses, passive scores, and initiative values win over textbook formulas—even when printed values disagree with each other. Do not change ability scores to force a match.

Do not turn a similarly named ability into a spell: an ability that does not say the creature casts a spell is not automatically a spell. Preserve the general Spellcasting/Psionic Spellcasting block as an action or trait in its original category AND create the actual spellbook entries. Only create individual spell Actions/Bonus Actions/Reactions when explicitly listed that way in the source. For example, a separately listed ability that casts Misty Step belongs in that action category and the spellbook; an ordinary spell merely listed under Spellcasting does not need another Action.

##### 2. Create and initialize NPC mode first

Reuse confirmed campaign/sheet knowledge. Create the character with empty controlledby/inplayerjournals unless sharing was requested. Return its actual ID early and reuse it throughout. Immediately find or create the legacy appState Attribute and set current to 'npc', then read it back. Do this BEFORE AC, HP, or other stat writes; PC and NPC modes derive some values differently. Do not use setSheetItem for appState.

A fresh NPC may have no store Attribute at all. Locate the sheet-owned Attribute named 'store'; decode current if it is JSON text, or deep-copy it if it is an object. If absent on this newly created character, create a minimal store. Ensure a missing hitpoints container has currentHP:0. Never reset an existing character's HP during initialization. Set settings.layoutState='Compact', settings.newRules to the intended edition, settings.addDexTiebreaker=true, and settings.rolls={privacy:'public',mode:'Automatic',advancedMode:'Normal'} unless the GM requests different roll preferences. Public rolls do not imply sharing the character or its GM notes.

The following local helper illustrates store handling; it is not a Roll20 global. Here characterId is the actual ID returned by createObj, not a name or invented ID:

~~~js
function readStore(characterId) {
  const attribute = findObjs({type:'attribute', characterid:characterId, name:'store'})[0];
  const raw = attribute && attribute.get('current');
  const store = raw ? (typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw))) : {};
  return {attribute, store};
}
// On a NEW NPC only, preserve any existing values:
const {attribute, store} = readStore(characterId);
store.hitpoints = store.hitpoints || {};
if (store.hitpoints.currentHP === undefined) store.hitpoints.currentHP = 0;
// Add the intended initialization fields, then write once:
if (attribute) attribute.set('current', store);
else createObj('attribute', {characterid:characterId, name:'store', current:store});
~~~

An appState readback is not a sheet-ready barrier. Computed reads on an uninitialized character have returned unrelated/stale values in testing. Initialize explicitly and verify the intended character's raw sources AND effective computed values. Generated scaffolding can also contain inactive artifacts: inspect activation and parent relationships rather than treating every record as a real feature.

##### 3. CR, abilities, proficiency, then dependent stats

Set store.npc.challengeRating to the intended CR string. Read npc_challenge AND pb to confirm the CR write and observe the resulting PB before writing dependent data. PB derives from CR; it is not universally +2. Set the six ability scores. Compare the resulting PB with expected.pb; if a confirmed source exception requires a PB override, apply it and verify pb again before building dependent saves, skills, and attacks. Do not wait indefinitely for a source exception to appear automatically. Do not write an override just because the sheet has a box for it.

Build supported mechanics first; defer numeric final-total overrides until verification of the relevant phase. Set ability scores, inferred or explicit proficiency/expertise, and supported bonuses/features before considering save, skill, passive, initiative, attack, or DC overrides. If those mechanics already produce the printed target, leave the override unset. This does not prohibit necessary base/source assignments such as NPC AC, HP, movement, or sense range, nor the verified PB exception above. A field named 'Set Value' is not automatically an override of a derived stat; distinguish the sheet's source data from calculated totals. Do not invent an unsupported mechanic solely to avoid an override.

Prefer verified writable computed properties to raw derived values. The tested calls are:

~~~js
await setComputed({characterId, property:'strength', args:['18']});
const strength = await getComputed({characterId, property:'strength', args:[]});
await setComputed({characterId, property:'hp_max', args:['199']});
await setComputed({characterId, property:'hp_current', args:['199']});
const hp = await getComputed({characterId, property:'hp', args:[]}); // {current,max}
~~~

Use the actual intended numbers, not these examples. Set maximum HP before current HP. Individual getComputed('hp_current') reads have hung even when writes worked: verify current HP through aggregate hp.current instead. hp_max/hp_current setters require the initialized hitpoints container. Do not write hp_current before initialization or respond to a worker error by blindly retrying it. Bound potentially hanging API waits with Promise.race and a timeout that returns a diagnostic before the tool deadline. A timed-out Promise.race does not cancel the underlying operation: inspect afterward, and do not dispatch another write merely because its confirmation timed out.

Raw writes: always obtain a fresh FULL JSON deep-copy of the current store, change only intended fields, and call storeAttribute.set('current', copy) once for a related batch. In-place or partially copied writes have failed to propagate reliably. Never replace it with another character's store, nor invent updateId or readiness markers. Wait for each raw-write phase to propagate before another raw write or computed setter; immediately interleaving them has lost changes. Poll relevant effective values roughly every 250ms for a bounded 1–2 seconds initially; if still pending, return observations and inspect again in a later call within the tool deadline. Poll WITHOUT rewriting mismatches: another editor or sheet calculation may have legitimately changed them. There is no proven global quiescence signal. setWithWorker/onSheetWorkerCompleted are not a verified Beacon-ready barrier.

##### Reference: source fields and effective verification

Here S is the decoded store, R is S.integrants.integrants, and V means valueFormula:{flatValue:number}. Preserve existing containers and records. For a new empty container, initialize only what this recipe needs. Do not overwrite computed summaries or action summaries.

| Trait | Preferred write / source | Verify |
| --- | --- | --- |
| Six ability scores | setComputed strength/dexterity/constitution/intelligence/wisdom/charisma | Same property and corresponding *_mod |
| CR / XP | S.npc.challengeRating string; S.npc.customXP number if needed | npc_challenge, npc_xp; pb after CR |
| PB exception | R record type 'Proficiency Bonus Modifier', calculation:'Set Value', V | pb (read-only) |
| HP | Initialized S.hitpoints.currentHP; setComputed hp_max then hp_current | hp aggregate; hp_max |
| Hit-dice expression | S.npc.rollHP string | npc_hpformula |
| AC | setComputed ac in NPC mode; notes in S.npc.acNotes | ac, npc_ac |
| Movement | setComputed speed, speed_climb, speed_fly, speed_swim, speed_burrow as needed | Same properties; no invented movement modes |
| Alignment / size | setComputed alignment / size | Same properties |
| Type / species | S.character.creatureType; optional type:'Species', name, description:'', preventSubspecies:false | npc_type and actual records |
| Initiative exception | S.npc.initiativeModOverride / initiativeScoreOverride numbers | initiative_bonus; raw score; preserve Dex tiebreak preference |
| Save proficiency | type:'Proficiency', category:'Saving Throw', proficiency:'Dexterity' etc., proficiencyLevel:'Proficient' | npc_str_save/npc_dex_save/npc_con_save/npc_int_save/npc_wis_save/npc_cha_save |
| Skill proficiency | type:'Proficiency', category:'Skill', proficiency:'Arcana' etc., proficiencyLevel:'Proficient' or 'Expertise' | npc_<skill_slug>, e.g. npc_animal_handling |
| Save total exception | type:'Saving Throw', ability:'Wisdom' etc., calculation:'Set Value', V | Relevant npc_*_save |
| Skill total / additive exception | type:'Skill Bonus', skill:'Perception' etc., calculation:'Set Value' / 'Modify', V | Relevant npc_<skill_slug> |
| Passive exception | type:'Passive', skill:'Perception', calculation:'Set Value', V | passive_wisdom (read-only), separately from npc_perception |
| Resistances / immunities / vulnerabilities | type:'Defense', defense:'Resistance'/'Immunity'/'Vulnerability', damage:'Cold' etc. | npc_resistances/npc_immunities/npc_vulnerabilities |
| Condition immunity | type:'Defense', defense:'Immunity', condition:'Charmed' etc.; no unrelated damage field | npc_condition_immunities |
| Sense | type:'Sense', name:'Darkvision' or 'Blindsight', ignoreValue:false, calculation:'Set Value', V | Raw record; do not claim UI verified |
| Languages | type:'Language', name:'All' or actual language | Raw records |
| Habitat / treasure / gear | S.npc.habitat / treasure / gear strings | Raw values |

Proficiency records also use increaseIfAlreadyAt:false, rollAbility:'Query Attribute', notes:''. Existing Skill definitions use type:'Skill', name, ability, custom:false, showAsPassive. Keep their identities; do not replace names with blanks. showAsPassive controls presentation, not skill proficiency. Avoid cluttering Senses with every skill; show the requested passive skills. Disable a zero-distance creation-artifact Darkvision entry if the creature lacks that sense; update the existing intrinsic sense rather than duplicating it.

Conditional child records are not intrinsic defenses or movement: e.g. Petrified's resistances and Grappled's zero speed depend on their parent Condition and cascades. Do not copy them as always-active traits. For custom intrinsic records use an empty parentID. Respect _enabled and relationships. Removing a record from a copied object alone has not always cleared it reliably; disabling an unwanted record with _enabled:false has worked. Re-read to verify removal/disable behavior.

##### Integrants, traits, and actions

For a new custom integrant, generate a fresh UUID in your code (do not assume crypto or a UUID helper is a sandbox global), use it as the R map key and _id, and generate a unique nine-character alphanumeric shortID. This is NOT the 2014 repeating-row ID format. Generate fresh IDs for every new record/child, never reuse IDs from another character, and remap all links. Preserve existing IDs when repairing this character. A common envelope is:

~~~js
{_enabled:true, _id:id, shortID, type, name, label:'', source:'Custom',
 parentID:'', childIDs:'[]', builderDisplayName:'', createdTime:Date.now()}
~~~

childIDs and display-order lists below are JSON-encoded strings, not arrays. Keep all parent/child links consistent. Traits use type:'Features' (plural), name and description; put their IDs in S.features.otherDisplayOrder (JSON string), preserving any existing list. Use readable HTML in bio, gmnotes, and descriptions where supported, including paragraphs, lists and tables. Source lore belongs in bio; encounter/roll tables, private guidance, provenance and creation caveats belong in gmnotes, not player-facing lore. Read bio/gmnotes with their callback getters and preserve unrelated notes.

Action and attack description fields must contain plain text, never HTML. Convert any source HTML to readable text, using line breaks as needed; do not include tags such as <p>, <br>, or <strong>. This applies to all action categories and spell-linked attacks. HTML guidance for bio and gmnotes does not apply to action or attack descriptions.

Text actions use type:'Action', actionType:'Action'/'Bonus Action'/'Reaction'/'Legendary', description, excludeFamilialResources:false. Keep Multiattack and Spellcasting readable and preserve source categories. Do not add legendary/mythic/lair actions unless the source grants them. Costs and trigger conditions must remain visible even when automatic tracking cannot be established.

A tested melee Attack and typed damage child are:

~~~js
// Add common envelopes; use the creature's actual values.
{type:'Attack', name:'Claw', actionType:'Action',
 attack:{abilityBonus:'Strength',proficiencyLevel:'Proficient',type:'Melee'},
 autoHit:false,repeat:1,_reach:false,_reachText:'',range:'',
 description:'Full hit effect, grapple/save rider, duration, etc.',
 childIDs:JSON.stringify([damageId,secondDamageId])}
{type:'Damage',parentID:attackId,_diceCount:2,diceSize:'d10',_bonus:5,
 ability:'none',damageType:'Slashing',overrideCrit:false,
 critDiceCount:0,critDiceSize:'',_critBonus:0}
~~~

Use one Damage child for each simultaneous damage type. Do not combine alternatives into simultaneous damage, double-add an ability bonus, or include later ongoing damage in the initial hit. For a fixed attack total, the tested form uses abilityBonus:'none', proficiencyLevel:'Untrained', and attack.bonus equal to the intended bonus. Ranged attacks use attack.type:'Ranged' and a range string. For unfamiliar attack variants, inspect a working example or documentation rather than inventing fields.

Native shortcuts tested include %{characterId|repeating_attack_<shortID>_attack}, %{characterId|repeating_action_<shortID>_action}, and %{characterId|initiative}. These use the actual shortID, not the integrant UUID. sendChat can submit verified actions, but submission is not proof of a successful roll. Do not depend on performAction or invented spell button suffixes. Prioritize correct human-GM sheet entries over Mod-driven spell casting. Create useful Ability shortcuts only with verified references or self-contained fully qualified roll formulas.

##### Spellbook and resources

Populate real Spell records from correct-edition definitions supplied by the GM or verified rules sources; compendium access is not required. Include complete relevant effects, saves, components, range, duration, concentration, limitations and upcast text. Honor source overrides such as no Material components. Do not silently substitute 2014 spells for 2024 versions.

The tested casting-source graph is a common-envelope Class named 'Spellcasting', with a Spellcasting child whose parentID and sourceID point to that Class, source:'Class', ability:'Charisma' (or intended ability), casterType:'other', overviewDisplay:true. Class.childIDs contains the child ID. This is a casting-source grouping, not a grant of PC class levels. S.spells.generalSpellSettings.spellcastings is '$__$' + JSON.stringify([{checked:true,id:castingChildId,name:'Spellcasting'}]). Verify spell_save_dc/spell_attack_bonus against the intended values. A source-wide Spellcasting.saveBonus adjustment was observed through UI, but sandbox recalculation was not fully verified: inspect and verify before claiming a DC override works.

Spell fields: type:'Spell', name, level:number, castingTime:'Action'/'Bonus Action' or actual time string, school, range, duration, description, components:{verbal:boolean,somatic:boolean,material:boolean}, concentration:boolean, ritual:boolean, _prepared:true when prepared, alwaysPrepared:true only when appropriate. source:'Custom', sourceID points to the casting CLASS ID, not its Spellcasting child. Append the full Spell ID to S.spells.displayOrder[level] as a JSON string. Preserve existing ordering. For innate spells, generalSpellSettings.useSlotAlwaysPrepared=false and useSlotDefault=false avoid requiring nonexistent slots; per-day and at-will casting are not standard slot progression.

IMPORTANT: A Spell→Attack child can make that spell appear as an individual Action. Do not create such children merely to obtain save/attack buttons when the source only lists that spell under Spellcasting. Prefer a complete readable spell entry with the source's DC and mechanics. This presentation constraint wins over extra automation. Only use that graph for a spell explicitly granted its own action, or if a verified way of suppressing the extra Action is available. A tested child uses type:'Attack', attack:{type:'Spell Save'}, actionType:'Action', save:{bonus:0,saveAbility:'Wisdom'}, parentID:spellId, and optional Damage grandchildren. The save bonus is an adjustment, not the full DC. Preserve source spell text independently of roll automation.

A healing Spell can instead have a direct child type:'Healing', parentID:spellId, _diceCount, diceSize:'d8', _bonus, isTemp:false, overrideCrit:false, critDiceSize:''. The tested spell automatically added its casting ability modifier; _bonus is EXTRA, so _bonus:0 gave +5 with CHA20. Check for double-counting. For a source that always casts Cure Wounds at level2, a clearly named fixed-level entry 'Cure Wounds (Healing Touch)', level:2, castingTime:'Bonus Action', four d8 and _bonus:0 correctly displayed 4d8+5 under 2024 rules. This is a source-specific fixed cast, NOT proof of general automatic upcasting. Do not apply it to an ordinary unrestricted spell. Spell upcast prose alone does not implement dice scaling.

Limited-use counters can use a Resource child with value:n, maxValueFormula:{flatValue:n}, parentID:ownerId. Owner.childIDs includes resourceId; owner.relations[resourceId]='uses' and resource.relations[ownerId]='usedBy'. A separately listed casting ability and its spell should share one resource, not get duplicate allowances. These counters displayed correctly, but automatic spending on casting was NOT established. Describe them as manual unless actually verified. A UI-observed recoveryRate:{'Long Rest':{type:'Full'}} is not justification for treating every n/day ability as long-rest recovery. Preserve the source's daily/dawn/rest rules in text; do not invent reset or legendary-cost automation.

##### Verify and finish

Verification is sandbox-based: use source-record and computed-value readbacks. You cannot inspect or operate the character-sheet UI with the available tools. Routine lack of browser/UI testing is not unfinished work and should not be listed as an unknown field or repeated in the completion summary. Report concrete discrepancies, failed or unavailable data checks, and uncertain automation instead. A correctly read-back source field does not need an additional "UI display unverified" caveat merely because no computed equivalent exists. Do not claim visual inspection; ask the GM to check a specific UI behavior only when a concrete unresolved issue requires it.

After each dependent phase, read back the actual character's source fields and effective stats. Final checks: HP current/max, CR/PB, all ability scores, relevant saves/skills/passives, AC/movement, initiative, defenses, action names/categories/children, spell names/levels/preparation/components/DC, resource pools, and ID/reference integrity. A successful raw write or setter return alone does not prove persistence, computation, a functioning roll, or resource consumption. Repair the same character and IDs; after a timeout inspect before retrying, and do not restart creation or fight sheet/user changes with repeated writes. Report unresolved fields precisely rather than claiming a complete sheet.

Verification must compare against the recorded expected targets, not merely list actual values. Return explicit mismatches as { field, expected, actual } entries and separately list unknown/unverified fields (including timed-out or unavailable reads). For example, expected initiativeBonus:11 versus actual initiative_bonus:6 is a mismatch requiring correction or explicit disclosure, not a successful verification. Use effective computed values where available and raw source checks where necessary, distinguishing the two. Check names, categories and mechanics for nonnumeric features too. After justified corrections, read back and compare again; do not claim completion while silently ignoring mismatches or treating unverified fields as matches.

If only one suitable image is available for a character, use it for both the token image and the character sheet portrait (avatar), unless the GM specifies otherwise. Reuse the same uploaded art URL; do not generate or upload a second image merely to fill the other location.

Reconcile confirmed mismatches only after dependent writes have propagated:
1. Keep source and expected fixed. Compare every applicable target, including initiative bonus and score separately; do not skip a target merely because there is no computed equivalent. For the initiative score, check S.npc.initiativeScoreOverride when explicitly set; otherwise use a verified effective score accessor if available, or report the score as unverified rather than assuming a formula proves the readback.
2. If actual matches expected, do not add a redundant total override. For a mismatch, first check whether an intended, supported mechanic was omitted or misconfigured. Correct that mechanic and re-read before deciding an override is needed.
3. If the supported mechanics cannot reproduce a confirmed printed total, use the documented final-total override for that field. Initiative overrides are final values: initiativeModOverride:11 means a total bonus of +11, not +11 plus Dexterity or PB; initiativeScoreOverride:21 means a score of 21. Do not subtract assumed future contributions. Preserve any intentional disagreement between printed totals, such as passive Perception differing from 10 + the Perception bonus. Never adjust ability scores merely to force a match.
4. Re-read the affected effective totals and dependent fields after each justified correction. Return remaining mismatches and unverified fields explicitly. A timeout, pending computation, or unavailable read is not evidence that an override is required. Poll without rewriting; do not fight concurrent sheet/user edits or repeatedly reapply values. Update existing correction records rather than adding duplicate bonuses on each pass.

When the experimental image tools are available and artwork is part of the request, follow the general Roll20 layers and image assets guidance. Otherwise, skip artwork import. If a suitable token already exists for THIS creature, set represents, configure HP/AC bars using verified sheet links, and save the configured default token with setDefaultTokenForCharacter. Prefer HP/AC linkage where supported; independent HP may be appropriate for multiple NPC copies. Do not reuse unrelated art/tokens or claim links were verified merely because bar values were filled. Without a suitable token or a usable image workflow, finish the character and report token setup separately. Give a short completion summary and invite the GM to inspect; do not claim browser/UI tests you cannot perform.
