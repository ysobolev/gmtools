import { isToolUIPart, type ChatStatus, type UIMessage } from "ai";
import { isRoll20ActionPart, roll20ActionInput } from "./roll20-ui-events";

export interface ChatActivity {
  readonly kind: "Thinking" | "Working" | "Generating image";
  readonly summary?: string;
}

export interface Roll20Receipt {
  readonly toolCallId: string;
  readonly summary: string;
  readonly status:
    | "working"
    | "approved"
    | "completed"
    | "denied"
    | "failed"
    | "timed-out";
}

export interface Roll20ApprovalRequest {
  readonly detailsLabel?: string;
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly summary: string;
  readonly code: string;
}

export interface MemoryReceipt {
  readonly toolCallId: string;
  readonly action: "stored" | "already-stored" | "updated" | "deleted";
  readonly content: string;
}

export type AssistantContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "roll20-approval";
      readonly approval: Roll20ApprovalRequest;
    }
  | { readonly type: "roll20-status"; readonly receipt: Roll20Receipt }
  | { readonly type: "memory-receipt"; readonly receipt: MemoryReceipt };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getMemoryReceipt(
  part: UIMessage["parts"][number],
): MemoryReceipt | undefined {
  if (
    !isToolUIPart(part) ||
    part.state !== "output-available" ||
    part.preliminary === true ||
    !isRecord(part.output) ||
    typeof part.output.content !== "string"
  ) {
    return undefined;
  }
  const content = part.output.content.trim();
  if (!content) return undefined;
  if (part.type === "tool-memory_store") {
    return {
      toolCallId: part.toolCallId,
      action: part.output.created === false ? "already-stored" : "stored",
      content,
    };
  }
  if (part.type === "tool-memory_update") {
    return { toolCallId: part.toolCallId, action: "updated", content };
  }
  if (part.type === "tool-memory_delete") {
    return { toolCallId: part.toolCallId, action: "deleted", content };
  }
  return undefined;
}

function getRoll20ApprovalRequest(
  part: UIMessage["parts"][number],
): Roll20ApprovalRequest | undefined {
  if (
    !isToolUIPart(part) ||
    !isRoll20ActionPart(part.type) ||
    part.state !== "approval-requested" ||
    part.approval.isAutomatic
  ) {
    return undefined;
  }
  const input = roll20ActionInput(part.type, part.input);
  const summary = getToolSummary(part) ?? "run a command in Roll20";
  return input
    ? {
        approvalId: part.approval.id,
        toolCallId: part.toolCallId,
        summary,
        code: input.code,
        ...(part.type !== "tool-execute_roll20" ? { detailsLabel: "Review UI action" } : {}),
      }
    : undefined;
}

function getToolSummary(part: unknown): string | undefined {
  if (typeof part !== "object" || part === null) return undefined;
  const value = part as { type?: unknown; input?: unknown };
  if (value.type === "tool-switch_layer" || value.type === "tool-drop_image" || value.type === "tool-compendium_import" || value.type === "tool-close_character_window") {
    return roll20ActionInput(value.type, value.input)?.summary;
  }
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
  if (!isToolUIPart(part) || !isRoll20ActionPart(part.type)) {
    return undefined;
  }
  const summary = getToolSummary(part);
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested"
  ) {
    return {
      toolCallId: part.toolCallId,
      summary: summary ?? "working in Roll20",
      status: "working",
    };
  }
  if (part.state === "approval-responded") {
    return {
      toolCallId: part.toolCallId,
      summary: summary ?? "run a command in Roll20",
      status: part.approval.approved ? "approved" : "denied",
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
    return {
      toolCallId: part.toolCallId,
      summary,
      status: part.state === "output-denied" ? "denied" : "failed",
    };
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
    const approval = getRoll20ApprovalRequest(part);
    if (approval) {
      blocks.push({ type: "roll20-approval", approval });
      continue;
    }
    const receipt = getRoll20Status(part);
    if (receipt) {
      blocks.push({ type: "roll20-status", receipt });
      continue;
    }
    const memoryReceipt = getMemoryReceipt(part);
    if (memoryReceipt) {
      blocks.push({ type: "memory-receipt", receipt: memoryReceipt });
    }
  }
  return blocks;
}

export function hasActiveRoll20Status(message: UIMessage): boolean {
  return getAssistantContentBlocks(message).some(
    (block) =>
      block.type === "roll20-approval" ||
      (block.type === "roll20-status" &&
        (block.receipt.status === "working" ||
          block.receipt.status === "approved")),
  );
}

export function countPendingRoll20Approvals(
  messages: readonly UIMessage[],
): number {
  return messages.reduce(
    (count, message) =>
      count +
      message.parts.filter(
        (part) => getRoll20ApprovalRequest(part) !== undefined,
      ).length,
    0,
  );
}

export function getRoll20Receipts(message: UIMessage): Roll20Receipt[] {
  const receipts: Roll20Receipt[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part) || !isRoll20ActionPart(part.type)) continue;
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

  if (assistantMessage.parts.some(part =>
    isToolUIPart(part) && part.type === "tool-generate_image" && part.state === "input-available"
  )) return { kind: "Generating image" };

  let lastTextIndex = -1;
  let lastToolIndex = -1;

  for (const [index, part] of assistantMessage.parts.entries()) {
    if (part.type === "text" && part.text.length > 0) lastTextIndex = index;
    if (!isToolUIPart(part)) continue;
    lastToolIndex = index;
    if (
      !isRoll20ActionPart(part.type) ||
      (part.state !== "input-streaming" && part.state !== "input-available")
    ) continue;
    const summary = getToolSummary(part);
    return summary
      ? { kind: "Working", summary }
      : { kind: "Working" };
  }

  return lastToolIndex >= lastTextIndex ? { kind: "Thinking" } : null;
}
