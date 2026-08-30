const REQUEST_TYPE = "GMTOOLS_RANDOM_REQUEST";
const RESPONSE_TYPE = "GMTOOLS_RANDOM_RESPONSE";
const COMMAND = "!gmtools-poc";
const RESPONSE_PATTERN = /GMTOOLS_RESPONSE\s*:\s*([a-f0-9-]{8,64})\s*:\s*(\d{1,3})/i;

function findChatControls() {
  const container = document.querySelector("#textchat-input");
  return {
    input: container?.querySelector("textarea") ?? null,
    button:
      container?.querySelector("button[type='submit']") ??
      container?.querySelector("button") ??
      container?.querySelector(".btn") ??
      null,
  };
}

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function sendApiCommand(requestId) {
  if (!/^[a-f0-9-]{8,64}$/i.test(requestId)) {
    return { ok: false, error: "The request ID is invalid." };
  }

  const { input, button } = findChatControls();
  if (!input || !button) {
    return { ok: false, error: "Open Roll20's Chat tab and try again." };
  }

  const previousValue = input.value;
  setNativeValue(input, `${COMMAND} ${requestId}`);
  button.click();

  // Roll20 reads the value synchronously from its send-button handler. Restore
  // anything the GM was drafting after that handler has returned.
  setTimeout(() => setNativeValue(input, previousValue), 0);
  return { ok: true };
}

function inspectAddedNode(node) {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return;

  const chatRoot = element.closest("#textchat, .textchatcontainer");
  if (!chatRoot) return;

  const candidates = new Set();
  const containingMessage = element.closest(".message");
  if (containingMessage) candidates.add(containingMessage);
  if (element.matches?.(".message")) candidates.add(element);
  element.querySelectorAll?.(".message").forEach((message) =>
    candidates.add(message),
  );

  // Some Roll20 layouts add the message body before its wrapper receives the
  // standard class. Inspect the added subtree as a fallback.
  if (candidates.size === 0) candidates.add(element);

  for (const candidate of candidates) {
    const match = candidate.textContent?.match(RESPONSE_PATTERN);
    if (!match) continue;

    const requestId = match[1];
    const value = Number(match[2]);
    const messageContainer = candidate.closest(".message") ?? candidate;

    // MutationObserver callbacks run at the microtask checkpoint, before the
    // browser's next paint, so the marked whisper is removed before display.
    messageContainer.remove();
    chrome.runtime
      .sendMessage({ type: RESPONSE_TYPE, requestId, value })
      .catch(() => {});
  }
}

const chatObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(inspectAddedNode);
  }
});

chatObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== REQUEST_TYPE) return;
  sendResponse(sendApiCommand(message.requestId));
});
