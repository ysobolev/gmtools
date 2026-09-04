export const ACTIVE_CHAT_SESSION_KEY = "gmToolsActiveChatId";

export async function getActiveChatId(): Promise<string | undefined> {
  const stored = await chrome.storage.session.get(ACTIVE_CHAT_SESSION_KEY);
  const value = stored[ACTIVE_CHAT_SESSION_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function setActiveChatId(chatId: string): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_CHAT_SESSION_KEY]: chatId });
}
