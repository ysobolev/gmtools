import { isToolUIPart, type ChatStatus, type UIMessage } from "ai";

export type ChatActivity = "Thinking" | "Working";

export function getChatActivity(
  status: ChatStatus,
  messages: readonly UIMessage[],
): ChatActivity | null {
  if (status === "submitted") return "Thinking";
  if (status !== "streaming") return null;

  let assistantMessage: UIMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      assistantMessage = messages[index];
      break;
    }
  }
  if (!assistantMessage) return "Thinking";

  let lastTextIndex = -1;
  let lastToolIndex = -1;

  for (const [index, part] of assistantMessage.parts.entries()) {
    if (part.type === "text" && part.text.length > 0) lastTextIndex = index;
    if (!isToolUIPart(part)) continue;
    lastToolIndex = index;
    if (part.state === "input-streaming" || part.state === "input-available") {
      return "Working";
    }
  }

  return lastToolIndex >= lastTextIndex ? "Thinking" : null;
}
