const REQUEST_TYPE = "GMTOOLS_RANDOM_REQUEST";
const RESPONSE_TYPE = "GMTOOLS_RANDOM_RESPONSE";
const REQUEST_TIMEOUT_MS = 10_000;

const requestButton = document.querySelector("#request-button");
const statusElement = document.querySelector("#status");
const numberElement = document.querySelector("#number");

let pendingRequest = null;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function finishRequest() {
  if (pendingRequest?.timeoutId) {
    clearTimeout(pendingRequest.timeoutId);
  }
  pendingRequest = null;
  requestButton.disabled = false;
}

async function getActiveRoll20Tab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://app.roll20.net/editor/")) {
    throw new Error("Open a Roll20 game in the active tab first.");
  }
  return tab;
}

async function requestRandomNumber() {
  finishRequest();
  requestButton.disabled = true;
  numberElement.textContent = "";
  setStatus("Contacting the Roll20 sandbox…");

  try {
    const tab = await getActiveRoll20Tab();
    const requestId = crypto.randomUUID();
    const request = {
      requestId,
      tabId: tab.id,
      timeoutId: setTimeout(() => {
        if (pendingRequest !== request) return;
        finishRequest();
        setStatus(
          "No response. Check that the Mod script is installed and enabled.",
          true,
        );
      }, REQUEST_TIMEOUT_MS),
    };
    pendingRequest = request;

    const acknowledgement = await chrome.tabs.sendMessage(tab.id, {
      type: REQUEST_TYPE,
      requestId,
    });

    if (!acknowledgement?.ok) {
      throw new Error(acknowledgement?.error || "Roll20 chat is not ready.");
    }

    // A fast response may already have completed the request while the content
    // script acknowledgement was in flight.
    if (pendingRequest === request) {
      setStatus("Waiting for the Mod script…");
    }
  } catch (error) {
    finishRequest();
    setStatus(error.message || "Could not send the request.", true);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message?.type !== RESPONSE_TYPE ||
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

requestButton.addEventListener("click", requestRandomNumber);
