export const OPENROUTER_SESSION_HEADER = "x-session-id";

export function createOpenRouterSessionHeaders(
  chatId: string,
): Record<string, string> {
  return { [OPENROUTER_SESSION_HEADER]: chatId };
}

export function createOpenRouterModelSettings(modelId: string):
  | { readonly cache_control: { readonly type: "ephemeral" } }
  | Record<string, never> {
  return modelId.startsWith("anthropic/")
    ? { cache_control: { type: "ephemeral" } }
    : {};
}
