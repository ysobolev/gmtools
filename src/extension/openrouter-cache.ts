export const OPENROUTER_SESSION_HEADER = "x-session-id";
export const OPENROUTER_APP_CATEGORIES = "personal-agent,game";

export function createOpenRouterRequestHeaders(
  chatId: string,
): Record<string, string> {
  return {
    [OPENROUTER_SESSION_HEADER]: chatId,
    "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORIES,
  };
}

export function createOpenRouterModelSettings(modelId: string):
  | { readonly cache_control: { readonly type: "ephemeral" } }
  | Record<string, never> {
  return modelId.startsWith("anthropic/")
    ? { cache_control: { type: "ephemeral" } }
    : {};
}
