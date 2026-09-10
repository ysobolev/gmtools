import type { UIMessage } from "ai";

export const REASONING_RECOVERY_MESSAGE = "OpenRouter could not reuse this chat's encrypted reasoning. Resume will discard the previous reasoning and continue using the conversation and recorded tool results.";

export function isReasoningCompatibilityError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown): boolean => {
    if (typeof value === "string") return /invalid_encrypted_content|encrypted (?:reasoning|payloads?|content|items).*?(?:multiple providers|different model|cannot.*decrypt|could not.*verif|cannot be verified|incompatible)|no single provider can decrypt/i.test(value) || value === REASONING_RECOVERY_MESSAGE;
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    return ["message", "code", "cause", "error", "data", "responseBody"].some(key => visit(record[key]));
  };
  return visit(error);
}

const reasoningKeys = new Set(["reasoning_details", "reasoning", "reasoning_content", "encrypted_content", "encryptedContent", "compaction", "compactionContent", "thinking", "signature", "redactedThinking"]);

function cleanProviderMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanProviderMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reasoningKeys.has(key)).map(([key, child]) => [key, cleanProviderMetadata(child)]));
}

/** Remove reasoning from every historical step, never from user/tool data.
 * Keep call IDs, results, images, submission diagnostics and visible prose. */
export function stripConversationReasoning(messages: readonly UIMessage[]): UIMessage[] {
  const clean = <T extends object>(value: T): T => {
    const result = { ...value } as Record<string, unknown>;
    for (const key of ["providerMetadata", "providerOptions", "callProviderMetadata", "resultProviderMetadata"]) {
      if (key in result) result[key] = cleanProviderMetadata(result[key]);
    }
    return result as T;
  };
  return messages.map(message => ({ ...clean(message), parts: message.parts.filter(part => part.type !== "reasoning").map(clean) }));
}
