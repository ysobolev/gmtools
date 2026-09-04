import {
  isToolUIPart,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

const STOPPED_METADATA_KEY = "gmToolsStopped";
const INTERRUPTED_METADATA_KEY = "gmToolsInterrupted";

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

function hasMessageMetadataFlag(message: UIMessage, key: string): boolean {
  return (
    message.role === "assistant" &&
    isRecord(message.metadata) &&
    message.metadata[key] === true
  );
}

function sanitizeInterruptedAssistantMessage(
  message: UIMessage,
  metadataKey: string,
): UIMessage | undefined {
  if (message.role !== "assistant") return message;
  const parts = sanitizeStoppedParts(message.parts);
  if (parts.length === 0) return undefined;
  return {
    ...message,
    metadata: {
      ...(isRecord(message.metadata) ? message.metadata : {}),
      [metadataKey]: true,
    },
    parts,
  };
}

export function isStoppedAssistantMessage(message: UIMessage): boolean {
  return hasMessageMetadataFlag(message, STOPPED_METADATA_KEY);
}

export function isInterruptedAssistantMessage(message: UIMessage): boolean {
  return hasMessageMetadataFlag(message, INTERRUPTED_METADATA_KEY);
}

export function hasDurableRoll20Result(message: UIMessage): boolean {
  return message.role === "assistant" && message.parts.some((part) =>
    isCompletedToolPart(part) && part.type === "tool-execute_roll20"
  );
}

export function sanitizeStoppedConversation(
  messages: readonly UIMessage[],
): UIMessage[] {
  const finalMessage = messages.at(-1);
  if (!finalMessage || finalMessage.role !== "assistant") return [...messages];
  const stopped = sanitizeInterruptedAssistantMessage(
    finalMessage,
    STOPPED_METADATA_KEY,
  );
  return stopped ? [...messages.slice(0, -1), stopped] : messages.slice(0, -1);
}

export function sanitizeInterruptedConversation(
  messages: readonly UIMessage[],
): UIMessage[] {
  const finalMessage = messages.at(-1);
  if (!finalMessage || finalMessage.role !== "assistant") return [...messages];
  const interrupted = sanitizeInterruptedAssistantMessage(
    finalMessage,
    INTERRUPTED_METADATA_KEY,
  );
  return interrupted
    ? [...messages.slice(0, -1), interrupted]
    : messages.slice(0, -1);
}

export function prepareConversationForResume(
  messages: readonly UIMessage[],
): UIMessage[] {
  const finalMessage = messages.at(-1);
  if (!finalMessage || finalMessage.role !== "assistant") {
    return [...messages];
  }

  const parts: UIMessage["parts"] = [];
  let startsStep = false;
  for (const part of sanitizeStoppedParts(finalMessage.parts)) {
    if (part.type === "step-start") {
      startsStep = true;
      continue;
    }
    if (part.type === "text" || part.type === "reasoning") continue;
    if (startsStep) parts.push({ type: "step-start" });
    startsStep = false;
    parts.push(part);
  }

  const metadata = isRecord(finalMessage.metadata)
    ? { ...finalMessage.metadata }
    : undefined;
  if (metadata) delete metadata[INTERRUPTED_METADATA_KEY];
  const retriedMessage: UIMessage = {
    ...finalMessage,
    ...(metadata && Object.keys(metadata).length > 0
      ? { metadata }
      : { metadata: undefined }),
    parts,
  };
  return parts.length > 0
    ? [...messages.slice(0, -1), retriedMessage]
    : messages.slice(0, -1);
}

export async function reconstructCompletedConversation(
  inputMessages: readonly UIMessage[],
  chunks: readonly UIMessageChunk[],
): Promise<UIMessage[] | undefined> {
  let completedAssistantMessage: UIMessage | undefined;
  const finalInputMessage = inputMessages.at(-1);
  const continuedAssistantMessage =
    finalInputMessage?.role === "assistant" ? finalInputMessage : undefined;
  const replay = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  for await (const message of readUIMessageStream({
    ...(continuedAssistantMessage
      ? { message: continuedAssistantMessage }
      : {}),
    stream: replay,
  })) {
    completedAssistantMessage = message;
  }
  return completedAssistantMessage
    ? [
        ...(continuedAssistantMessage
          ? inputMessages.slice(0, -1)
          : inputMessages),
        completedAssistantMessage,
      ]
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

export async function reconstructInterruptedConversation(
  inputMessages: readonly UIMessage[],
  chunks: readonly UIMessageChunk[],
): Promise<UIMessage[]> {
  const reconstructed = await reconstructCompletedConversation(
    inputMessages,
    chunks,
  );
  return reconstructed
    ? sanitizeInterruptedConversation(reconstructed)
    : [...inputMessages];
}
