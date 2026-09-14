## Beacon sheet fundamentals

Beacon is a sheet technology, not a game system. Identify the actual sheet before choosing game-specific guidance. D&D initialization fields and store paths are not a universal Beacon schema.

Use documented sheet interfaces and inspect the target's exposed computed-property metadata before modifying unfamiliar data. getComputed/setComputed require Sandbox v1.5; getSheetItem/setSheetItem exist in both sandbox versions and are not themselves evidence of Beacon support. Await asynchronous reads and writes. Verify exact names and whether computed properties are writable before using setComputed; do not infer identifiers from UI labels or legacy-sheet attribute names.

Legacy Attribute objects do not necessarily represent Beacon's effective sheet values. Do not create guessed legacy attributes to work around missing sheet items. A sheet-owned store, when present, is implementation-specific: do not transplant D&D store structures, initialization flags, or action/spell schemas into another game's sheet.

Read current target values before changes, and verify effective computed values afterward. Initialization and recalculation can be delayed; use bounded polling without repeatedly rewriting a value that does not match. A missing field or unfinished initialization is not proof that no sheet is configured. Do not claim success from a successful write alone.

Use web_fetch for relevant Roll20 documentation when behavior is uncertain. If neither documentation nor inspection establishes a safe schema, explain the specific limitation and ask the game master for sheet-specific help rather than inventing a schema.

For Beacon character Ability macros, avoid parentheses in the Ability name: Roll20's command parser interprets parentheses as arguments when the token macro bar invokes the Ability by name, preventing an exact lookup. Use a name such as "Umbral Eruption — Recharge 5–6" instead of "Umbral Eruption (Recharge 5–6)". This restriction is on the shortcut name, not the underlying sheet action name or description; preserve those and keep the verified action reference unchanged.

For the supported D&D sheets, read dnd5e-roll20 for the tested initialization sequence, field mappings, and NPC recipes. Do not apply those recipes to other sheets merely because they use Beacon.
