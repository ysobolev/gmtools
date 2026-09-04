import {
  isToolUIPart,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

const STOPPED_METADATA_KEY = "gmToolsStopped";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompletedToolPart(part: UIMessage["parts"][number]): boolean {
  return (
    isToolUIPart(part) &&
    (part.state === "output-error" ||
      part.state === "output-denied" ||
      (part.state === "output-available" && part.preliminary !== true))
  );
}

function sanitizeStoppedParts(
  parts: readonly UIMessage["parts"][number][],
): UIMessage["parts"] {
  const groups: Array<{
    readonly startsStep: boolean;
    readonly parts: UIMessage["parts"];
  }> = [];

  for (const part of parts) {
    if (part.type === "step-start") {
      groups.push({ startsStep: true, parts: [] });
      continue;
    }
    const group = groups.at(-1);
    const target = group ?? { startsStep: false, parts: [] };
    if (!group) groups.push(target);

    if (isToolUIPart(part)) {
      if (isCompletedToolPart(part)) target.parts.push(part);
      continue;
    }
    if (part.type === "text" || part.type === "reasoning") {
      if (part.text) target.parts.push({ ...part, state: "done" });
      continue;
    }
    target.parts.push(part);
  }

  return groups.flatMap((group) =>
    group.parts.length === 0
      ? []
      : group.startsStep
        ? [{ type: "step-start" as const }, ...group.parts]
        : group.parts,
  );
}

export function isStoppedAssistantMessage(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    isRecord(message.metadata) &&
    message.metadata[STOPPED_METADATA_KEY] === true
  );
}

export function sanitizeStoppedAssistantMessage(
  message: UIMessage,
): UIMessage | undefined {
  if (message.role !== "assistant") return message;
  const parts = sanitizeStoppedParts(message.parts);
  if (parts.length === 0) return undefined;
  return {
    ...message,
    metadata: {
      ...(isRecord(message.metadata) ? message.metadata : {}),
      [STOPPED_METADATA_KEY]: true,
    },
    parts,
  };
}

export function sanitizeStoppedConversation(
  messages: readonly UIMessage[],
): UIMessage[] {
  const finalMessage = messages.at(-1);
  if (!finalMessage || finalMessage.role !== "assistant") return [...messages];
  const stopped = sanitizeStoppedAssistantMessage(finalMessage);
  return stopped ? [...messages.slice(0, -1), stopped] : messages.slice(0, -1);
}

export async function reconstructCompletedConversation(
  inputMessages: readonly UIMessage[],
  chunks: readonly UIMessageChunk[],
): Promise<UIMessage[] | undefined> {
  let completedAssistantMessage: UIMessage | undefined;
  const replay = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  for await (const message of readUIMessageStream({ stream: replay })) {
    completedAssistantMessage = message;
  }
  return completedAssistantMessage
    ? [...inputMessages, completedAssistantMessage]
    : undefined;
}

export async function reconstructStoppedConversation(
  inputMessages: readonly UIMessage[],
  chunks: readonly UIMessageChunk[],
): Promise<UIMessage[]> {
  const reconstructed = await reconstructCompletedConversation(
    inputMessages,
    chunks,
  );
  return reconstructed
    ? sanitizeStoppedConversation(reconstructed)
    : [...inputMessages];
}
