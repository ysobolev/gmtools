import {
  ROLL20_ACKNOWLEDGEMENT_TYPE,
  ROLL20_PROTOCOL_VERSION,
  type SendAcknowledgement,
  type Roll20ExecuteRequestMessage,
  formatRoll20ExecuteCommand,
  isRoll20ExecuteRequestMessage,
  parseRoll20AcknowledgementText,
  parseRoll20ExecuteResponseText,
} from "../protocol";
import { EXTENSION_BUILD_ID, EXTENSION_VERSION } from "../build-info";
import { Roll20ResponseTracker } from "./roll20-response-tracker";

const pendingRoll20Responses = new Roll20ResponseTracker();

function acknowledgement(
  ok: boolean,
  error?: string,
): SendAcknowledgement {
  return {
    ok,
    ...(error ? { error } : {}),
    extensionVersion: EXTENSION_VERSION,
    buildId: EXTENSION_BUILD_ID,
    protocolVersion: ROLL20_PROTOCOL_VERSION,
  };
}

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

function sendApiCommand(
  request: Roll20ExecuteRequestMessage,
): SendAcknowledgement {
  if (
    request.extensionVersion !== EXTENSION_VERSION ||
    request.buildId !== EXTENSION_BUILD_ID ||
    request.protocolVersion !== ROLL20_PROTOCOL_VERSION
  ) {
    return acknowledgement(
      false,
      "The Roll20 page is running a different GM Tools build. Reload the page.",
    );
  }
  const { input, button } = findChatControls();
  if (!input || !button) {
    return acknowledgement(false, "Open Roll20's Chat tab and try again.");
  }

  const command = formatRoll20ExecuteCommand(request.requestId, request.code, {
    kind: request.kind,
    ...(request.expectedCampaignId
      ? { expectedCampaignId: request.expectedCampaignId }
      : {}),
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
  });
  const previousValue = input.value;
  try {
    pendingRoll20Responses.register(request);
    setNativeValue(input, command);
    button.click();

    // Roll20 reads the value synchronously from its send-button handler. Restore
    // anything the GM was drafting after that handler has returned.
    setTimeout(() => setNativeValue(input, previousValue), 0);
    return acknowledgement(true);
  } catch (error) {
    pendingRoll20Responses.forget(request.requestId);
    return acknowledgement(
      false,
      error instanceof Error ? error.message : "Could not use Roll20 chat.",
    );
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
    const text = candidate.textContent ?? "";
    const response =
      parseRoll20AcknowledgementText(text) ??
      parseRoll20ExecuteResponseText(text);
    if (!response) continue;

    try {
      // An extension reload invalidates content scripts already installed in
      // the page. Do not let a stale observer consume a response that a newly
      // injected observer can still deliver.
      if (!chrome.runtime.id) continue;
      if (!pendingRoll20Responses.has(response.requestId)) continue;
      const delivery = chrome.runtime.sendMessage({
        ...response,
        ...(response.type === ROLL20_ACKNOWLEDGEMENT_TYPE
          ? { pageTitle: document.title }
          : {}),
      });
      pendingRoll20Responses.consume(response);

      // MutationObserver callbacks run at the microtask checkpoint, before the
      // next paint, so the marked whisper is removed before normal display.
      (candidate.closest(".message") ?? candidate).remove();
      void delivery.catch(() => undefined);
    } catch {
      // Leave the message in place when this content-script context is stale.
    }
  }
}

const chatObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(inspectAddedNode);
  }
});

const contentScriptScope = globalThis as typeof globalThis & {
  __gmToolsContentScriptBuildId?: string;
};

if (contentScriptScope.__gmToolsContentScriptBuildId !== EXTENSION_BUILD_ID) {
  contentScriptScope.__gmToolsContentScriptBuildId = EXTENSION_BUILD_ID;
  chatObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse): undefined => {
      if (!isRoll20ExecuteRequestMessage(message)) return;
      sendResponse(sendApiCommand(message));
    },
  );
}
