import { isToolUIPart, type ChatStatus, type UIMessage } from "ai";

export interface ChatActivity {
  readonly kind: "Thinking" | "Working";
  readonly summary?: string;
}

export interface Roll20Receipt {
  readonly toolCallId: string;
  readonly summary: string;
  readonly status: "working" | "completed" | "failed" | "timed-out";
}

export type AssistantContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "roll20-status"; readonly receipt: Roll20Receipt };

function getToolSummary(part: unknown): string | undefined {
  if (typeof part !== "object" || part === null) return undefined;
  const input = (part as { readonly input?: unknown }).input;
  if (typeof input !== "object" || input === null) return undefined;
  const summary = (input as { readonly summary?: unknown }).summary;
  if (typeof summary !== "string") return undefined;
  const trimmed = summary.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function explicitlyReportsFailure(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) return true;
  const result = record.result;
  return (
    typeof result === "object" &&
    result !== null &&
    (result as Record<string, unknown>).ok === false
  );
}

function reportsUnknownExecutionState(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as Record<string, unknown>).error;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>).executionState === "unknown"
  );
}

function getRoll20Status(
  part: UIMessage["parts"][number],
): Roll20Receipt | undefined {
  if (!isToolUIPart(part) || part.type !== "tool-execute_roll20") {
    return undefined;
  }
  const summary = getToolSummary(part);
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  ) {
    return {
      toolCallId: part.toolCallId,
      summary: summary ?? "working in Roll20",
      status: "working",
    };
  }
  if (!summary) return undefined;
  if (part.state === "output-available") {
    return {
      toolCallId: part.toolCallId,
      summary,
      status: reportsUnknownExecutionState(part.output)
        ? "timed-out"
        : explicitlyReportsFailure(part.output)
          ? "failed"
          : "completed",
    };
  }
  if (
    part.state === "output-error" ||
    part.state === "output-denied"
  ) {
    return { toolCallId: part.toolCallId, summary, status: "failed" };
  }
  return undefined;
}

export function getAssistantContentBlocks(
  message: UIMessage,
): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      if (!part.text) continue;
      const previous = blocks.at(-1);
      if (previous?.type === "text") {
        blocks[blocks.length - 1] = {
          type: "text",
          text: previous.text + part.text,
        };
      } else {
        blocks.push({ type: "text", text: part.text });
      }
      continue;
    }
    const receipt = getRoll20Status(part);
    if (receipt) blocks.push({ type: "roll20-status", receipt });
  }
  return blocks;
}

export function hasActiveRoll20Status(message: UIMessage): boolean {
  return getAssistantContentBlocks(message).some(
    (block) =>
      block.type === "roll20-status" && block.receipt.status === "working",
  );
}

export function getRoll20Receipts(message: UIMessage): Roll20Receipt[] {
  const receipts: Roll20Receipt[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.type !== "tool-execute_roll20") continue;
    const receipt = getRoll20Status(part);
    if (receipt && receipt.status !== "working") receipts.push(receipt);
  }
  return receipts;
}

export function getChatActivity(
  status: ChatStatus,
  messages: readonly UIMessage[],
): ChatActivity | null {
  if (status === "submitted") return { kind: "Thinking" };
  if (status !== "streaming") return null;

  let assistantMessage: UIMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      assistantMessage = messages[index];
      break;
    }
  }
  if (!assistantMessage) return { kind: "Thinking" };

  let lastTextIndex = -1;
  let lastToolIndex = -1;

  for (const [index, part] of assistantMessage.parts.entries()) {
    if (part.type === "text" && part.text.length > 0) lastTextIndex = index;
    if (!isToolUIPart(part)) continue;
    lastToolIndex = index;
    if (
      part.type !== "tool-execute_roll20" ||
      (part.state !== "input-streaming" && part.state !== "input-available")
    ) continue;
    const summary = getToolSummary(part);
    return summary
      ? { kind: "Working", summary }
      : { kind: "Working" };
  }

  return lastToolIndex >= lastTextIndex ? { kind: "Thinking" } : null;
}
