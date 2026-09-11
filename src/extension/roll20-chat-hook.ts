export const ROLL20_CHAT_HOOK_EVENT = "gmtools:roll20-chat-response";
export const ROLL20_CHAT_SEND_EVENT = "gmtools:roll20-chat-send";

// Serialized by scripting.executeScript into MAIN world. Keep this function
// self-contained: no imports, module constants, or extension APIs inside it.
export function installRoll20ChatHook(eventName: string, buildId: string): boolean {
  type Incoming = (this: unknown, ...args: unknown[]) => unknown;
  type Chat = { incoming: Incoming; rawChatInput?: (message: { type: string; content: string; actionId: string }) => unknown; talktomyself?: boolean };
  const scope = window as typeof window & {
    currentPlayer?: { d20?: { textchat?: Chat } };
    __gmToolsChatHook?: {
      chat: Chat;
      original: Incoming;
      wrapper: Incoming;
      buildId: string;
    };
    __gmToolsChatSender?: EventListener;
  };
  const chat = scope.currentPlayer?.d20?.textchat;
  if (!chat || typeof chat.incoming !== "function") return false;
  // Install only an explicit send listener; ordinary Roll20 input is untouched.
  const sendEvent = "gmtools:roll20-chat-send";
  if (scope.__gmToolsChatSender) document.removeEventListener(sendEvent, scope.__gmToolsChatSender);
  const sender: EventListener = (event) => {
    const command: unknown = (event as CustomEvent).detail;
    const current = scope.currentPlayer?.d20?.textchat;
    if (typeof command !== "string" || !command.startsWith("!gmtools-exec ") ||
        typeof current?.rawChatInput !== "function") return;
    // Claim BEFORE invoking: a thrown error may happen after submission. Never
    // fall back to the composer after an ambiguous send (no Mod deduplication).
    event.preventDefault();
    try {
      if (current.talktomyself) throw new Error("Turn off Roll20's Talk to Myself mode to send GM Tools commands.");
      current.rawChatInput({ type: "api", content: command, actionId: "no-store" });
    } catch (error) {
      console.warn("[GM Tools] Direct chat send failed; not resending", error);
    }
  };
  document.addEventListener(sendEvent, sender);
  scope.__gmToolsChatSender = sender;
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
