import {
  type SendAcknowledgement,
  formatRoll20ExecuteCommand,
  isRoll20ExecuteRequestMessage,
  parseRoll20ExecuteResponseText,
} from "../protocol";

function findChatControls(): {
  input: HTMLTextAreaElement | null;
  button: HTMLElement | null;
} {
  const container = document.querySelector("#textchat-input");
  return {
    input: container?.querySelector<HTMLTextAreaElement>("textarea") ?? null,
    button:
      container?.querySelector<HTMLElement>("button[type='submit']") ??
      container?.querySelector<HTMLElement>("button") ??
      container?.querySelector<HTMLElement>(".btn") ??
      null,
  };
}

function setNativeValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  if (!setter) {
    throw new Error("Unable to access Roll20's chat input.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function sendApiCommand(requestId: string, code: string): SendAcknowledgement {
  const { input, button } = findChatControls();
  if (!input || !button) {
    return { ok: false, error: "Open Roll20's Chat tab and try again." };
  }

  const previousValue = input.value;
  try {
    setNativeValue(input, formatRoll20ExecuteCommand(requestId, code));
    button.click();

    // Roll20 reads the value synchronously from its send-button handler. Restore
    // anything the GM was drafting after that handler has returned.
    setTimeout(() => setNativeValue(input, previousValue), 0);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not use Roll20 chat.",
    };
  }
}

function inspectAddedNode(node: Node): void {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || !element.closest("#textchat, .textchatcontainer")) return;

  const candidates = new Set<Element>();
  const containingMessage = element.closest(".message");
  if (containingMessage) candidates.add(containingMessage);
  if (element.matches(".message")) candidates.add(element);
  element
    .querySelectorAll(".message")
    .forEach((message) => candidates.add(message));

  // Some Roll20 layouts add the body before its wrapper receives the standard
  // class. Inspect the added subtree as a fallback.
  if (candidates.size === 0) candidates.add(element);

  for (const candidate of candidates) {
    const response = parseRoll20ExecuteResponseText(candidate.textContent ?? "");
    if (!response) continue;

    // MutationObserver callbacks run at the microtask checkpoint, before the
    // next paint, so the marked whisper is removed before normal display.
    (candidate.closest(".message") ?? candidate).remove();
    void chrome.runtime.sendMessage(response).catch(() => undefined);
  }
}

const chatObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(inspectAddedNode);
  }
});

const contentScriptScope = globalThis as typeof globalThis & {
  __gmToolsContentScriptLoaded?: boolean;
};

if (!contentScriptScope.__gmToolsContentScriptLoaded) {
  contentScriptScope.__gmToolsContentScriptLoaded = true;
  chatObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse): undefined => {
      if (!isRoll20ExecuteRequestMessage(message)) return;
      sendResponse(sendApiCommand(message.requestId, message.code));
    },
  );
}
