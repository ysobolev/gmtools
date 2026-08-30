import {
  RANDOM_REQUEST_TYPE,
  type RandomRequestMessage,
  type SendAcknowledgement,
  isRandomResponseMessage,
} from "../protocol";

const REQUEST_TIMEOUT_MS = 10_000;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing side-panel element: ${selector}`);
  return element;
}

const requestButton = requiredElement<HTMLButtonElement>("#request-button");
const statusElement = requiredElement<HTMLParagraphElement>("#status");
const numberElement = requiredElement<HTMLOutputElement>("#number");

interface PendingRequest {
  readonly requestId: string;
  readonly tabId: number;
  readonly timeoutId: number;
}

let pendingRequest: PendingRequest | null = null;

function setStatus(message: string, isError = false): void {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function finishRequest(): void {
  if (pendingRequest) clearTimeout(pendingRequest.timeoutId);
  pendingRequest = null;
  requestButton.disabled = false;
}

async function getActiveRoll20Tab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://app.roll20.net/editor/")) {
    throw new Error("Open a Roll20 game in the active tab first.");
  }
  return tab;
}

async function requestRandomNumber(): Promise<void> {
  finishRequest();
  requestButton.disabled = true;
  numberElement.textContent = "";
  setStatus("Contacting the Roll20 sandbox…");

  try {
    const tab = await getActiveRoll20Tab();
    const requestId = crypto.randomUUID();
    const request: PendingRequest = {
      requestId,
      tabId: tab.id!,
      timeoutId: window.setTimeout(() => {
        if (pendingRequest !== request) return;
        finishRequest();
        setStatus(
          "No response. Check that the Mod script is installed and enabled.",
          true,
        );
      }, REQUEST_TIMEOUT_MS),
    };
    pendingRequest = request;

    const message: RandomRequestMessage = {
      type: RANDOM_REQUEST_TYPE,
      requestId,
    };
    const acknowledgement = (await chrome.tabs.sendMessage(
      request.tabId,
      message,
    )) as SendAcknowledgement | undefined;

    if (!acknowledgement?.ok) {
      throw new Error(acknowledgement?.error ?? "Roll20 chat is not ready.");
    }

    // A fast response may already have completed the request while the content
    // script acknowledgement was in flight.
    if (pendingRequest === request) {
      setStatus("Waiting for the Mod script…");
    }
  } catch (error) {
    finishRequest();
    setStatus(
      error instanceof Error ? error.message : "Could not send the request.",
      true,
    );
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender): undefined => {
  if (
    !isRandomResponseMessage(message) ||
    !pendingRequest ||
    message.requestId !== pendingRequest.requestId ||
    sender.tab?.id !== pendingRequest.tabId
  ) {
    return;
  }

  numberElement.textContent = String(message.value);
  finishRequest();
  setStatus("Received privately from Roll20");
});

requestButton.addEventListener("click", () => void requestRandomNumber());
