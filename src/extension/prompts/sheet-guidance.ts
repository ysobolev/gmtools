export const GENERIC_SHEET_GUIDANCE = [
  "The character sheet schema may not be predefined.",
  "Never assume that similarly named community or custom sheets use the same Roll20 attributes.",
  "Before changing a character, inspect its existing attribute objects with findObjs and return the relevant names and values.",
  "For legacy attribute-backed sheet data, use getAttrByName to read defaults that may not yet have materialized as attribute objects; use findObjs or createObj when an actual attribute object must be changed or created. For Beacon sheet data, read the relevant guide instead of assuming legacy attributes represent the effective values.",
];
