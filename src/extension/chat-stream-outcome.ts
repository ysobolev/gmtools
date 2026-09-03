import type { UIMessageChunk } from "ai";

export interface CompletedStepLike {
  readonly finishReason: string;
  readonly toolCalls: readonly {
    readonly providerExecuted?: boolean;
  }[];
}

export function getChatStreamError(
  chunks: readonly UIMessageChunk[],
): string | undefined {
  return chunks.find((chunk) => chunk.type === "error")?.errorText;
}

export function stoppedAtStepLimit(
  steps: readonly CompletedStepLike[],
  stepLimit: number,
): boolean {
  const finalStep = steps.at(-1);
  return (
    steps.length >= stepLimit &&
    finalStep?.finishReason === "tool-calls" &&
    finalStep.toolCalls.some((toolCall) => toolCall.providerExecuted !== true)
  );
}
