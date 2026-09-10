export const ROLL20_CHAT_HOOK_EVENT = "gmtools:roll20-chat-response";

// Serialized by scripting.executeScript into MAIN world. Keep this function
// self-contained: no imports, module constants, or extension APIs inside it.
export function installRoll20ChatHook(eventName: string, buildId: string): boolean {
  type Incoming = (this: unknown, ...args: unknown[]) => unknown;
  type Chat = { incoming: Incoming };
  const scope = window as typeof window & {
    currentPlayer?: { d20?: { textchat?: Chat } };
    __gmToolsChatHook?: {
      chat: Chat;
      original: Incoming;
      wrapper: Incoming;
      buildId: string;
    };
  };
  const chat = scope.currentPlayer?.d20?.textchat;
  if (!chat || typeof chat.incoming !== "function") return false;
  const previous = scope.__gmToolsChatHook;
  if (previous?.chat === chat && chat.incoming === previous.wrapper) {
    if (previous.buildId === buildId) return true;
    chat.incoming = previous.original;
  }
  const original = chat.incoming;
  const wrapper: Incoming = function (...args) {
    try {
      const message = args[1] as { playerid?: unknown; type?: unknown; content?: unknown } | undefined;
      if (
        typeof message?.playerid === "string" &&
        message.playerid.toLowerCase() === "api" &&
        message.type === "whisper" &&
        typeof message.content === "string" &&
        /GMTOOLS_EXECUTION_(RESPONSE|ACKNOWLEDGED):/i.test(message.content)
      ) {
        // String detail works across Firefox's isolated-world boundary too.
        // Cancellation is synchronous: only a live content script that accepts
        // this pending response may prevent the normal render/beep path.
        const event = new CustomEvent(eventName, {
          detail: message.content,
          cancelable: true,
        });
        if (!document.dispatchEvent(event)) return;
      }
    } catch {
      // This optional enhancement must never break normal Roll20 chat.
    }
    return original.apply(this, args);
  };
  chat.incoming = wrapper;
  scope.__gmToolsChatHook = { chat, original, wrapper, buildId };
  return true;
}
