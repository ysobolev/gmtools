export type CompendiumAction =
  | { tool: "close_character_window"; characterId: string }
  | { tool: "compendium_search"; query: string }
  | { tool: "compendium_import"; pageName: string; category: string; expansionId: number };

// Serialized into the page world. Keep dependencies local to this function.
export async function runCompendiumAction(documentToken: string, action: CompendiumAction) {
  // Roll20's private page APIs have no published TypeScript declarations.
  const page = window as unknown as {
    __gmToolsUiDocument?: string;
    campaign_id: string;
    currentPlayer: { d20: { compendium: { shortName: string }; Campaign: { characters: { get(id: string): any } } } };
    jQuery: any;
  };
  if (page.__gmToolsUiDocument !== documentToken) throw new Error("The Roll20 page changed.");
  if (action.tool === "close_character_window") {
    const character = page.currentPlayer?.d20?.Campaign?.characters?.get(action.characterId);
    if (!character) throw new Error("The character is not present in this campaign.");
    if (character.view?.popoutWindow || character.view?.popoutWindowElement) {
      throw new Error("Closing popped-out character windows is not supported. Ask the GM to close it after import verification.");
    }
    const container = Array.from(document.querySelectorAll<HTMLElement>(".asv[data-characterid]")).find(element => element.getAttribute("data-characterid") === action.characterId);
    const button = container?.querySelector<HTMLButtonElement>(".asv__close")
      ?? character.view?.$el?.closest(".ui-dialog")?.find(".ui-dialog-titlebar-close")?.[0];
    if (!button) {
      if (container) throw new Error("The character window's close control is unavailable.");
      return { ok: true, characterId: action.characterId, closeRequested: false, note: "No supported in-page character window was found open; nothing was closed." };
    }
    button.click();
    return { ok: true, characterId: action.characterId, closeRequested: true, note: "Requested closing this character window through its normal close control. This does not verify import completion." };
  }
  const book = page.currentPlayer?.d20?.compendium?.shortName;
  if (!book) throw new Error("This campaign has no available compendium.");
  if (action.tool === "compendium_search") {
    const params = new URLSearchParams({ sharedCompendium: String(page.campaign_id), terms: action.query });
    const response = await fetch(`/compendium/compendium/globalsearch/${encodeURIComponent(book)}/?${params}`, {
      credentials: "same-origin", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Compendium search failed (HTTP ${response.status}).`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected compendium search response.");
    return { ok: true, total: rows.length, results: rows.slice(0,50).map(row => ({
      pageName: row.pagename, category: row.category, expansionId: row.expansion,
      source: row.source, pageId: row.pageid, tokenUrl: row.token,
    })) };
  }
  const $ = page.jQuery;
  const target = document.getElementById("editor-wrapper");
  const canvas = document.getElementById("babylonCanvas");
  const handler = $?.(target).data("ui-droppable")?.options?.drop;
  if (!canvas || !target || typeof handler !== "function") throw new Error("Roll20's compendium drop handler is unavailable.");
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error("The canvas is not visible.");
  const item = $(document.createElement("div"));
  item.addClass("compendium-page__upper");
  item.attr("data-pagename", `${encodeURIComponent(action.category)}%3A${encodeURIComponent(action.pageName)}`);
  item.attr("data-expansionid", String(action.expansionId));
  const event = $.Event("drop", {
    pageX: rect.left + rect.width / 2 + window.scrollX,
    pageY: rect.top + rect.height / 2 + window.scrollY,
    originalEvent: { dropHandled: false },
  });
  await handler.call(target, event, { draggable: item, helper: item });
  return { ok: true, importInitiated: true, note: "Import initiated, NOT confirmed complete. Roll20 may reuse an existing character or open a new sheet to finish importing. Leave the sheet open until loading completes. Inspect the character and token through the sandbox before reporting success. Never automatically retry an import." };
}
