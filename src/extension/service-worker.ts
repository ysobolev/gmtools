import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  isStepCount,
  jsonSchema,
  safeValidateUIMessages,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  OPENROUTER_KEY_INFO_URL,
  OPENROUTER_TOKEN_URL,
  createAuthorizationUrl,
  createPkcePair,
  parseAuthorizationCallback,
  parseKeyInfoResponse,
  parseTokenResponse,
  type OpenRouterKeyInfo,
} from "./openrouter-auth";
import {
  buildProfileInstructions,
  type AssistantProfile,
} from "./profile-config";
import {
  AUTH_CONNECT_REQUEST,
  AUTH_DISCONNECT_REQUEST,
  AUTH_PERSISTENCE_REQUEST,
  AUTH_STATE_CHANGED,
  CHAT_ABORT,
  CHAT_CHUNK,
  CHAT_COMPLETE,
  CHAT_ERROR,
  CHAT_PORT_NAME,
  CHAT_START,
  isAuthRequest,
  isChatPortRequest,
  type AuthRequest,
  type AuthResponse,
  type AuthStatus,
  type ChatPortResponse,
} from "./openrouter-protocol";
import {
  ROLL20_EXECUTE_REQUEST_TYPE,
  isRoll20ExecuteResponseMessage,
  type Roll20ExecutionOutcome,
  type SendAcknowledgement,
} from "../protocol";

const API_KEY_STORAGE_KEY = "openRouterApiKey";
const USER_ID_STORAGE_KEY = "openRouterUserId";
const KEY_INFO_STORAGE_KEY = "openRouterKeyInfo";
const PERSIST_AUTH_STORAGE_KEY = "openRouterPersistAuth";
const AUTH_STORAGE_KEYS = [
  API_KEY_STORAGE_KEY,
  USER_ID_STORAGE_KEY,
  KEY_INFO_STORAGE_KEY,
] as const;
const ROLL20_EDITOR_URL_PREFIX = "https://app.roll20.net/editor/";
const ROLL20_EXECUTION_TIMEOUT_MS = 45_000;
const MAX_ROLL20_CODE_LENGTH = 20_000;
const activeChatControllers = new Set<AbortController>();
let roll20ExecutionQueue: Promise<void> = Promise.resolve();
const pendingRoll20Executions = new Map<
  string,
  {
    readonly tabId: number;
    readonly resolve: (outcome: Roll20ExecutionOutcome) => void;
    readonly reject: (error: Error) => void;
    readonly timeoutId: ReturnType<typeof setTimeout>;
    readonly abortSignal: AbortSignal;
    readonly abortListener: () => void;
  }
>();

interface StoredAuth {
  readonly openRouterApiKey?: unknown;
  readonly openRouterUserId?: unknown;
  readonly openRouterKeyInfo?: unknown;
}

function enableActionClick(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

function restrictExtensionStorage(): void {
  void chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  void chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}

chrome.runtime.onInstalled.addListener(() => {
  enableActionClick();
  restrictExtensionStorage();
});
chrome.runtime.onStartup.addListener(() => {
  enableActionClick();
  restrictExtensionStorage();
});
restrictExtensionStorage();

function isTrustedExtensionSender(
  sender:
    | Pick<chrome.runtime.MessageSender, "id" | "origin" | "tab" | "url">
    | undefined,
): boolean {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const extensionOrigin = chrome.runtime.getURL("");
  const extensionOriginWithoutSlash = extensionOrigin.slice(0, -1);
  const hasExtensionOrigin =
    sender.origin === extensionOriginWithoutSlash ||
    sender.url?.startsWith(extensionOrigin) === true;
  if (sender.tab) {
    return hasExtensionOrigin;
  }
  return (!sender.url && !sender.origin) || hasExtensionOrigin;
}

async function restorePersistentAuth(): Promise<void> {
  const local = await chrome.storage.local.get([
    PERSIST_AUTH_STORAGE_KEY,
    ...AUTH_STORAGE_KEYS,
  ]);
  if (
    local[PERSIST_AUTH_STORAGE_KEY] !== true ||
    typeof local[API_KEY_STORAGE_KEY] !== "string"
  ) {
    return;
  }
  await chrome.storage.session.set({
    [API_KEY_STORAGE_KEY]: local[API_KEY_STORAGE_KEY],
    ...(typeof local[USER_ID_STORAGE_KEY] === "string"
      ? { [USER_ID_STORAGE_KEY]: local[USER_ID_STORAGE_KEY] }
      : {}),
    ...(typeof local[KEY_INFO_STORAGE_KEY] === "object" &&
    local[KEY_INFO_STORAGE_KEY] !== null
      ? { [KEY_INFO_STORAGE_KEY]: local[KEY_INFO_STORAGE_KEY] }
      : {}),
  });
}

const authRestoration = restorePersistentAuth().catch(() => undefined);

async function readStoredAuth(): Promise<StoredAuth> {
  await authRestoration;
  return chrome.storage.session.get([...AUTH_STORAGE_KEYS]);
}

function authStatusFromStored(
  stored: StoredAuth,
  persistent: boolean,
): AuthStatus {
  if (typeof stored.openRouterApiKey !== "string") {
    return { connected: false, persistent };
  }

  const info =
    typeof stored.openRouterKeyInfo === "object" &&
    stored.openRouterKeyInfo !== null
      ? (stored.openRouterKeyInfo as OpenRouterKeyInfo)
      : {};

  return {
    connected: true,
    persistent,
    ...(typeof stored.openRouterUserId === "string"
      ? { userId: stored.openRouterUserId }
      : {}),
    ...(typeof info.label === "string" ? { keyLabel: info.label } : {}),
    ...(typeof info.limitRemaining === "number" || info.limitRemaining === null
      ? { limitRemaining: info.limitRemaining }
      : {}),
  };
}

async function getAuthStatus(): Promise<AuthStatus> {
  const [stored, local] = await Promise.all([
    readStoredAuth(),
    chrome.storage.local.get(PERSIST_AUTH_STORAGE_KEY),
  ]);
  return authStatusFromStored(
    stored,
    local[PERSIST_AUTH_STORAGE_KEY] === true,
  );
}

async function notifyAuthState(status: AuthStatus): Promise<void> {
  await chrome.runtime
    .sendMessage({ type: AUTH_STATE_CHANGED, status })
    .catch(() => undefined);
}

async function clearAuth(): Promise<void> {
  for (const controller of activeChatControllers) controller.abort();
  await authRestoration;
  await Promise.all([
    chrome.storage.session.remove([...AUTH_STORAGE_KEYS]),
    chrome.storage.local.remove([
      ...AUTH_STORAGE_KEYS,
      PERSIST_AUTH_STORAGE_KEY,
    ]),
  ]);
  await notifyAuthState({ connected: false, persistent: false });
}

async function setAuthPersistence(enabled: boolean): Promise<AuthStatus> {
  if (!enabled) {
    await chrome.storage.local.remove([...AUTH_STORAGE_KEYS]);
    await chrome.storage.local.set({ [PERSIST_AUTH_STORAGE_KEY]: false });
  } else {
    const stored = await readStoredAuth();
    await chrome.storage.local.set({
      [PERSIST_AUTH_STORAGE_KEY]: true,
      ...(typeof stored.openRouterApiKey === "string"
        ? { [API_KEY_STORAGE_KEY]: stored.openRouterApiKey }
        : {}),
      ...(typeof stored.openRouterUserId === "string"
        ? { [USER_ID_STORAGE_KEY]: stored.openRouterUserId }
        : {}),
      ...(typeof stored.openRouterKeyInfo === "object" &&
      stored.openRouterKeyInfo !== null
        ? { [KEY_INFO_STORAGE_KEY]: stored.openRouterKeyInfo }
        : {}),
    });
  }
  const status = await getAuthStatus();
  await notifyAuthState(status);
  return status;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
): Promise<ReturnType<typeof parseTokenResponse>> {
  const response = await fetch(OPENROUTER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: "S256",
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenRouter authorization failed (${response.status}).`);
  }
  return parseTokenResponse(body);
}

async function fetchKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo> {
  try {
    const response = await fetch(OPENROUTER_KEY_INFO_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.status === 401) throw new Error("OpenRouter rejected the API key.");
    if (!response.ok) return {};
    return parseKeyInfoResponse(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message.includes("rejected")) throw error;
    return {};
  }
}

let connectionAttempt: Promise<AuthStatus> | null = null;

async function connectOpenRouter(): Promise<AuthStatus> {
  if (connectionAttempt) return connectionAttempt;

  connectionAttempt = (async () => {
    const callbackUrl = chrome.identity.getRedirectURL("openrouter");
    const pkce = await createPkcePair();
    const redirectedUrl = await chrome.identity.launchWebAuthFlow({
      url: createAuthorizationUrl(callbackUrl, pkce.challenge),
      interactive: true,
    });
    if (!redirectedUrl) throw new Error("OpenRouter authorization was cancelled.");

    const code = parseAuthorizationCallback(redirectedUrl, callbackUrl);
    const token = await exchangeAuthorizationCode(code, pkce.verifier);
    const keyInfo = await fetchKeyInfo(token.key);
    await chrome.storage.session.set({
      [API_KEY_STORAGE_KEY]: token.key,
      ...(token.userId ? { [USER_ID_STORAGE_KEY]: token.userId } : {}),
      [KEY_INFO_STORAGE_KEY]: keyInfo,
    });
    const persistence = await chrome.storage.local.get(
      PERSIST_AUTH_STORAGE_KEY,
    );
    if (persistence[PERSIST_AUTH_STORAGE_KEY] === true) {
      await chrome.storage.local.set({
        [API_KEY_STORAGE_KEY]: token.key,
        ...(token.userId ? { [USER_ID_STORAGE_KEY]: token.userId } : {}),
        [KEY_INFO_STORAGE_KEY]: keyInfo,
      });
    }

    const status = await getAuthStatus();
    await notifyAuthState(status);
    return status;
  })();

  try {
    return await connectionAttempt;
  } finally {
    connectionAttempt = null;
  }
}

async function handleAuthRequest(message: AuthRequest): Promise<AuthResponse> {
  try {
    if (message.type === AUTH_CONNECT_REQUEST) {
      return { ok: true, status: await connectOpenRouter() };
    }
    if (message.type === AUTH_DISCONNECT_REQUEST) {
      await clearAuth();
      return {
        ok: true,
        status: { connected: false, persistent: false },
      };
    }
    if (message.type === AUTH_PERSISTENCE_REQUEST) {
      return {
        ok: true,
        status: await setAuthPersistence(message.enabled),
      };
    }
    return { ok: true, status: await getAuthStatus() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "OpenRouter login failed.",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse): boolean | undefined => {
    if (!isAuthRequest(message) || !isTrustedExtensionSender(sender)) return;
    void handleAuthRequest(message).then(sendResponse);
    return true;
  },
);

function isTrustedRoll20ContentScript(
  sender: Pick<chrome.runtime.MessageSender, "id" | "tab" | "url">,
): boolean {
  const senderUrl = sender.url ?? sender.tab?.url;
  return (
    sender.id === chrome.runtime.id &&
    typeof sender.tab?.id === "number" &&
    typeof senderUrl === "string" &&
    senderUrl.startsWith(ROLL20_EDITOR_URL_PREFIX)
  );
}

function removePendingRoll20Execution(requestId: string): void {
  const pending = pendingRoll20Executions.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pending.abortSignal.removeEventListener("abort", pending.abortListener);
  pendingRoll20Executions.delete(requestId);
}

chrome.runtime.onMessage.addListener((message: unknown, sender): void => {
  if (
    !isRoll20ExecuteResponseMessage(message) ||
    !isTrustedRoll20ContentScript(sender)
  ) {
    return;
  }

  const pending = pendingRoll20Executions.get(message.requestId);
  if (!pending || pending.tabId !== sender.tab?.id) return;
  removePendingRoll20Execution(message.requestId);
  pending.resolve(message.outcome);
});

function isSendAcknowledgement(value: unknown): value is SendAcknowledgement {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    (!("error" in value) ||
      value.error === undefined ||
      typeof value.error === "string")
  );
}

async function findActiveRoll20Tab(): Promise<chrome.tabs.Tab> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (
    typeof activeTab?.id !== "number" ||
    !activeTab.url?.startsWith(ROLL20_EDITOR_URL_PREFIX)
  ) {
    throw new Error("Focus the Roll20 campaign tab before using Roll20 tools.");
  }
  return activeTab;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendToRoll20ContentScript(
  tabId: number,
  message: {
    readonly type: typeof ROLL20_EXECUTE_REQUEST_TYPE;
    readonly requestId: string;
    readonly code: string;
  },
): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!errorMessage(error).includes("Receiving end does not exist")) throw error;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function executeRoll20(
  code: string,
  abortSignal: AbortSignal,
): Promise<Roll20ExecutionOutcome> {
  if (!code.trim()) throw new Error("execute_roll20 received empty code.");
  if (code.length > MAX_ROLL20_CODE_LENGTH) {
    throw new Error("execute_roll20 code exceeds the 20,000-character limit.");
  }

  const tab = await findActiveRoll20Tab();
  const requestId = crypto.randomUUID();

  return new Promise<Roll20ExecutionOutcome>((resolve, reject) => {
    const rejectPending = (error: Error): void => {
      removePendingRoll20Execution(requestId);
      reject(error);
    };
    const abortListener = (): void => {
      rejectPending(new DOMException("Roll20 execution was stopped.", "AbortError"));
    };
    const timeoutId = setTimeout(() => {
      rejectPending(new Error("Roll20 did not return a result within 45 seconds."));
    }, ROLL20_EXECUTION_TIMEOUT_MS);

    pendingRoll20Executions.set(requestId, {
      tabId: tab.id as number,
      resolve,
      reject,
      timeoutId,
      abortSignal,
      abortListener,
    });
    abortSignal.addEventListener("abort", abortListener, { once: true });

    if (abortSignal.aborted) {
      abortListener();
      return;
    }

    void sendToRoll20ContentScript(tab.id as number, {
        type: ROLL20_EXECUTE_REQUEST_TYPE,
        requestId,
        code,
      })
      .then((acknowledgement: unknown) => {
        if (!isSendAcknowledgement(acknowledgement)) {
          rejectPending(new Error("The Roll20 bridge returned an invalid acknowledgement."));
        } else if (!acknowledgement.ok) {
          rejectPending(new Error(acknowledgement.error ?? "Could not use Roll20 chat."));
        }
      })
      .catch((error: unknown) => {
        rejectPending(
          new Error(
            error instanceof Error
              ? error.message
              : "Could not connect to the Roll20 campaign tab.",
          ),
        );
      });
  });
}

function queueRoll20Execution(
  code: string,
  abortSignal: AbortSignal,
): Promise<Roll20ExecutionOutcome> {
  const execution = roll20ExecutionQueue.then(() =>
    executeRoll20(code, abortSignal),
  );
  roll20ExecutionQueue = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
}

function findStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  return findStatusCode(record.cause);
}

function userFacingModelError(error: unknown): string {
  const status = findStatusCode(error);
  if (status === 401) {
    void clearAuth();
    return "Your OpenRouter session is no longer valid. Connect again.";
  }
  if (status === 402) return "Your OpenRouter account needs additional credit.";
  if (status === 429) return "OpenRouter is rate-limiting requests. Try again shortly.";
  return error instanceof Error && error.message
    ? error.message
    : "The model request failed.";
}

function postToPort(port: chrome.runtime.Port, message: ChatPortResponse): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function streamChat(
  port: chrome.runtime.Port,
  requestId: string,
  untrustedMessages: unknown,
  profile: AssistantProfile,
  abortController: AbortController,
): Promise<void> {
  const validation = await safeValidateUIMessages<UIMessage>({
    messages: untrustedMessages,
  });
  if (!validation.success) throw new Error("The chat history is invalid.");

  const stored = await readStoredAuth();
  if (typeof stored.openRouterApiKey !== "string") {
    throw new Error("Connect to OpenRouter before sending a message.");
  }

  const openrouter = createOpenRouter({
    apiKey: stored.openRouterApiKey,
    compatibility: "strict",
    appName: "GM Tools for VTT",
    appUrl: `https://chromewebstore.google.com/detail/${chrome.runtime.id}`,
  });
  const tools = {
    execute_roll20: tool({
      description:
        "Execute JavaScript in the active campaign's Roll20 Mod sandbox. The code is a function body with access to Roll20 Mod globals such as findObjs, getObj, createObj, Campaign, sendChat, and state. Include an explicit return statement and return only JSON-serializable data. Returned promises are awaited.",
      inputSchema: jsonSchema<{ readonly code: string }>({
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript function body to execute in Roll20.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      }),
      execute: ({ code }, { abortSignal }) =>
        queueRoll20Execution(code, abortSignal ?? abortController.signal),
    }),
  };
  const result = streamText({
    model: openrouter(profile.modelId),
    system: buildProfileInstructions(profile),
    messages: await convertToModelMessages(validation.data),
    tools,
    stopWhen: isStepCount(8),
    abortSignal: abortController.signal,
  });
  const stream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: validation.data,
    generateMessageId: () => crypto.randomUUID(),
    sendReasoning: false,
    sendSources: false,
    onError: userFacingModelError,
  });

  for await (const chunk of stream as ReadableStream<UIMessageChunk>) {
    if (!postToPort(port, { type: CHAT_CHUNK, requestId, chunk })) {
      abortController.abort();
      return;
    }
  }
  postToPort(port, { type: CHAT_COMPLETE, requestId });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHAT_PORT_NAME || !isTrustedExtensionSender(port.sender)) {
    port.disconnect();
    return;
  }

  let activeRequestId: string | null = null;
  let abortController: AbortController | null = null;

  port.onMessage.addListener((message: unknown) => {
    if (!isChatPortRequest(message)) return;

    if (message.type === CHAT_ABORT) {
      if (message.requestId === activeRequestId) abortController?.abort();
      return;
    }

    if (message.type !== CHAT_START || activeRequestId) return;
    activeRequestId = message.requestId;
    abortController = new AbortController();
    activeChatControllers.add(abortController);

    void streamChat(
      port,
      message.requestId,
      message.messages,
      message.profile,
      abortController,
    )
      .catch((error: unknown) => {
        if (abortController?.signal.aborted) {
          postToPort(port, { type: CHAT_COMPLETE, requestId: message.requestId });
          return;
        }
        postToPort(port, {
          type: CHAT_ERROR,
          requestId: message.requestId,
          error: userFacingModelError(error),
        });
      })
      .finally(() => {
        if (abortController) activeChatControllers.delete(abortController);
        activeRequestId = null;
        abortController = null;
      });
  });

  port.onDisconnect.addListener(() => abortController?.abort());
});
