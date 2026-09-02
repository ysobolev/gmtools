import type { UIMessageChunk } from "ai";

export function getChatStreamError(
  chunks: readonly UIMessageChunk[],
): string | undefined {
  return chunks.find((chunk) => chunk.type === "error")?.errorText;
}
