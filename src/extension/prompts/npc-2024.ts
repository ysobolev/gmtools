// Based on sandbox and sheet-UI experiments, including the Ursinal end-to-end test.
// Raw store structures are experimental Beacon internals, not a stable public API.
export const NPC_2024_INSTRUCTIONS = String.raw`
#### Build a complete NPC on the Beacon 2024 sheet

Use execute_roll20 directly; no importer, browser control, local reference PDF, or pre-existing template character is required or available to you by default. Default to 2024/5.5e rules and spell definitions for this recipe unless the GM requests otherwise. Sheet technology does not override an explicit rules-edition request. This is an NPC recipe, not a validated PC class/species/background builder. Prefer Compact layout for spellcasters and anything beyond a very simple monster. Stat Block layout has reduced editing capabilities, including limitations around multiple damage types; do not switch layouts as an initialization workaround.

##### 1. Establish the intended creature before writing

If supplied a stat block, read it and preserve its printed totals, exceptions, triggers, riders, action categories, spellcasting blocks, and resource limits. Otherwise generate a coherent stat block first, choosing reasonable unspecified details and an appropriate name rather than making the GM answer a questionnaire. A requested class level is not a CR: emulate the intended class features in an NPC stat block; do not bolt on a PC class progression or automatically set CR equal to level.

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

Set store.npc.challengeRating to the intended CR string. Read npc_challenge AND pb until both agree with the intended values before writing dependent data. PB derives from CR; it is not universally +2. Set the six ability scores. Only add a PB override if the source's intended PB differs from the derived value, then verify pb again. Do not write an override just because the sheet has a box for it.

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

After each dependent phase, read back the actual character's source fields and effective stats. Final checks: HP current/max, CR/PB, all ability scores, relevant saves/skills/passives, AC/movement, initiative, defenses, action names/categories/children, spell names/levels/preparation/components/DC, resource pools, and ID/reference integrity. A successful raw write or setter return alone does not prove persistence, computation, a functioning roll, or resource consumption. Repair the same character and IDs; after a timeout inspect before retrying, and do not restart creation or fight sheet/user changes with repeated writes. Report unresolved fields precisely rather than claiming a complete sheet.

Skip artwork import. If a suitable token already exists for THIS creature, set represents, configure HP/AC bars using verified sheet links, and save the configured default token with setDefaultTokenForCharacter. Prefer HP/AC linkage where supported; independent HP may be appropriate for multiple NPC copies. Do not reuse unrelated art/tokens or claim links were verified merely because bar values were filled. Without a suitable token, finish the character and report token setup separately. Give a short completion summary and invite the GM to inspect; do not claim browser/UI tests you cannot perform.
`.trim();
