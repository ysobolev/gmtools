import { isToolUIPart, type ChatStatus, type UIMessage } from "ai";

export interface ChatActivity {
  readonly kind: "Thinking" | "Working";
  readonly summary?: string;
}

export interface Roll20Receipt {
  readonly toolCallId: string;
  readonly summary: string;
  readonly status: "completed" | "failed";
}

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

export function getRoll20Receipts(message: UIMessage): Roll20Receipt[] {
  const receipts: Roll20Receipt[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.type !== "tool-execute_roll20") continue;
    const summary = getToolSummary(part);
    if (!summary) continue;
    if (part.state === "output-available") {
      receipts.push({
        toolCallId: part.toolCallId,
        summary,
        status: explicitlyReportsFailure(part.output) ? "failed" : "completed",
      });
    } else if (part.state === "output-error" || part.state === "output-denied") {
      receipts.push({
        toolCallId: part.toolCallId,
        summary,
        status: "failed",
      });
    }
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
