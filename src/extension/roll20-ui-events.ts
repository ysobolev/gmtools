export const ROLL20_LAYERS = ["token", "gm", "map", "foreground", "lighting"] as const;
export type Roll20Layer = typeof ROLL20_LAYERS[number];
export type Roll20UiAction = import("./compendium").CompendiumAction |
    { readonly tool: "get_current_layer" }
  | { readonly tool: "switch_layer"; readonly layer: Roll20Layer }
  | { readonly tool: "drop_image"; readonly imageId: string; readonly x?: number | null; readonly y?: number | null };

export function isRoll20ActionPart(type: string): boolean {
  return ["tool-execute_roll20", "tool-switch_layer", "tool-drop_image", "tool-compendium_import"].includes(type);
}

// A stable representation shared by approval registration, display, and claiming.
export function roll20ActionInput(type: string, input: unknown): { summary: string; code: string } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (type === "tool-compendium_import" && typeof value.pageName === "string" && typeof value.category === "string" && typeof value.expansionId === "number") {
    return { summary: `importing ${value.pageName} from the compendium`, code: JSON.stringify({ tool: "compendium_import", pageName: value.pageName, category: value.category, expansionId: value.expansionId }) };
  }
  if (type === "tool-execute_roll20") {
    return typeof value.summary === "string" && typeof value.code === "string"
      ? { summary: value.summary, code: value.code } : undefined;
  }
  if (type === "tool-switch_layer" && ROLL20_LAYERS.includes(value.layer as Roll20Layer)) {
    return { summary: `switching to the ${value.layer} layer`, code: JSON.stringify({ tool: "switch_layer", layer: value.layer }) };
  }
  if (type === "tool-drop_image" && typeof value.imageId === "string") {
    return { summary: "dropping an image onto the Roll20 canvas", code: JSON.stringify({ tool: "drop_image", imageId: value.imageId, x: value.x, y: value.y }) };
  }
  return undefined;
}

// Serialized into the isolated content-script world; no page API or mutations.
export function readRoll20CurrentLayer(documentToken: string): { ok: boolean; layer: Roll20Layer | "unknown"; error?: string } {
  const scope = window as unknown as { __gmToolsUiDocument?: string };
  if (scope.__gmToolsUiDocument !== documentToken) {
    return { ok: false, layer: "unknown", error: "The Roll20 page changed before the layer could be read." };
  }
  const buttons = [
    ["token", "tokens-layer-button"],
    ["gm", "gm-layer-button"],
    ["map", "map-layer-button"],
    ["foreground", "foreground-layer-button"],
    ["lighting", "lighting-layer-button"],
  ] as const;
  const selected = buttons.filter(([, id]) => document.querySelector(`#${id} .icon-selected`));
  if (selected.length !== 1) {
    return { ok: false, layer: "unknown", error: "The Roll20 toolbar does not identify exactly one selected layer." };
  }
  return { ok: true, layer: selected[0]![0] };
}

// Serialized into MAIN for drops, ISOLATED for shortcuts: keep self-contained.
// The document token prevents sending to a replacement document after a handshake.
export function sendRoll20UiEvent(
  documentToken: string,
  action?: Exclude<Roll20UiAction, { tool: "get_current_layer" | "compendium_search" | "compendium_import" }>,
  image?: { base64: string; filename: string; mediaType: string } | null,
): { ok: boolean; eventSent?: boolean; error?: string } {
  const scope = window as unknown as { __gmToolsUiDocument?: string };
  if (!action) {
    scope.__gmToolsUiDocument = documentToken;
    return { ok: true };
  }
  if (scope.__gmToolsUiDocument !== documentToken) {
    return { ok: false, error: "The Roll20 page changed before the event could be sent." };
  }
  const canvas = document.getElementById("babylonCanvas");
  if (!canvas) return { ok: false, error: "The Roll20 canvas is unavailable." };
  if (action.tool === "switch_layer") {
    const keys = { token: ["o", "KeyO", 79], gm: ["k", "KeyK", 75], map: ["m", "KeyM", 77], foreground: [".", "Period", 190], lighting: [",", "Comma", 188] } as const;
    const [key, code, keyCode] = keys[action.layer];
    canvas.focus();
    for (const type of ["keydown", "keyup"]) {
      canvas.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, ctrlKey: true, bubbles: true, cancelable: true }));
    }
  } else {
    if (!image) return { ok: false, error: "The stored image is unavailable." };
    const rect = canvas.getBoundingClientRect();
    const x = action.x ?? rect.width / 2;
    const y = action.y ?? rect.height / 2;
    if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
      return { ok: false, error: "Drop coordinates must be inside the visible canvas (CSS pixels)." };
    }
    const bytes = Uint8Array.from(atob(image.base64), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], image.filename, { type: image.mediaType }));
    transfer.effectAllowed = "copy";
    transfer.dropEffect = "copy";
    for (const type of ["dragenter", "dragover", "drop"]) {
      canvas.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true }));
    }
  }
  return { ok: true, eventSent: true };
}
