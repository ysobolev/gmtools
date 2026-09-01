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
  CAMPAIGN_STATUS_CHANGED,
  CAMPAIGN_STATUS_REQUEST,
  CHAT_ABORT,
  CHAT_CLEAR,
  CHAT_CHUNK,
  CHAT_COMMIT,
  CHAT_COMPLETE,
  CHAT_ERROR,
  CHAT_PORT_NAME,
  CHAT_RESUME,
  CHAT_RESUME_QUERY,
  CHAT_START,
  isAuthRequest,
  isCampaignStatusRequest,
  isChatControlRequest,
  isChatPortRequest,
  type AuthRequest,
  type AuthResponse,
  type AuthStatus,
  type CampaignStatus,
  type ChatPortResponse,
} from "./openrouter-protocol";
import {
  ROLL20_EXECUTE_REQUEST_TYPE,
  ROLL20_PROTOCOL_VERSION,
  isRoll20AcknowledgementMessage,
  isRoll20ExecuteResponseMessage,
  type Roll20ExecuteRequestMessage,
  type Roll20ExecuteResponseMessage,
  type Roll20ExecutionOutcome,
  type SendAcknowledgement,
} from "../protocol";
import { EXTENSION_BUILD_ID, EXTENSION_VERSION } from "../build-info";
import {
  BACKGROUND_EXECUTION_STORAGE_KEY,
  DEBUG_LOGGING_STORAGE_KEY,
  MAX_STEPS_STORAGE_KEY,
  UNRESTRICTED_WEB_FETCH_STORAGE_KEY,
  WEB_SEARCH_STORAGE_KEY,
  isBackgroundExecutionEnabled,
  isDebugLoggingEnabled,
  isUnrestrictedWebFetchEnabled,
  isWebSearchEnabled,
  normalizeMaxSteps,
} from "./behavior-settings";
import { createDebugLogger, type DebugLogger } from "./debug-logger";
import {
  createOpenRouterImageGenerationTool,
  createOpenRouterWebFetchTool,
  createOpenRouterWebSearchTool,
} from "./openrouter-tools";

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
const ROLL20_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;
const ROLL20_COMMAND_TTL_MS = 10_000;
const CAMPAIGN_BINDINGS_STORAGE_KEY = "gmToolsCampaignBindings";
const CAMPAIGN_ROUTES_STORAGE_KEY = "gmToolsCampaignRoutes";
const ROLL20_TOMBSTONE_STORAGE_KEY = "gmToolsRoll20TimeoutTombstones";
const ROLL20_TOMBSTONE_LIMIT = 100;
const ROLL20_TOMBSTONE_TTL_MS = 15 * 60_000;
const SERVICE_WORKER_KEEPALIVE_INTERVAL_MS = 20_000;
const MAX_ROLL20_CODE_LENGTH = 20_000;
const activeChatControllers = new Set<AbortController>();
let roll20ExecutionQueue: Promise<void> = Promise.resolve();

interface PendingRoll20Execution {
  readonly tabId: number;
  readonly resolve: (outcome: Roll20ExecutionOutcome) => void;
  readonly reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  readonly abortSignal: AbortSignal;
  readonly abortListener: () => void;
  readonly debug: DebugLogger;
  readonly chatId: string;
  readonly toolCallId: string;
  readonly dispatchedAt: number;
  readonly expectedCampaignId: string;
  acknowledged: boolean;
}

const pendingRoll20Executions = new Map<string, PendingRoll20Execution>();

interface PendingCampaignDiscovery {
  readonly tabId: number;
  readonly resolve: (identity: CampaignIdentity) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
  readonly debug: DebugLogger;
}

const pendingCampaignDiscoveries = new Map<string, PendingCampaignDiscovery>();
const campaignDiscoveryAttempts = new Map<
  string,
  Promise<CampaignStatus>
>();

interface CampaignIdentity {
  readonly campaignId: string;
  readonly name: string;
  readonly tabId: number;
  readonly isGM: boolean;
  readonly modVersion: string;
}

interface CampaignBinding {
  readonly campaignId: string;
  readonly name: string;
  readonly modVersion: string;
}

interface CampaignRoute {
  readonly tabId: number;
}

interface CampaignTarget extends CampaignBinding {
  readonly tabId: number;
}

interface Roll20TimeoutTombstone {
  readonly requestId: string;
  readonly chatId: string;
  readonly tabId: number;
  readonly toolCallId: string;
  readonly dispatchedAt: number;
  readonly timedOutAt: number;
  readonly expiresAt: number;
  readonly debug?: DebugLogger;
}

class Roll20ExecutionTimeoutError extends Error {
  constructor() {
    super("Roll20 did not return a result within 45 seconds.");
    this.name = "Roll20ExecutionTimeoutError";
  }
}

class Roll20CompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Roll20CompatibilityError";
  }
}

class Roll20CommandRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Roll20CommandRejectedError";
    this.code = code;
  }
}

class Roll20CampaignMismatchError extends Error {
  constructor(message = "This conversation is bound to a different Roll20 campaign.") {
    super(message);
    this.name = "Roll20CampaignMismatchError";
  }
}

class Roll20TabUnavailableBeforeDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Roll20TabUnavailableBeforeDispatchError";
  }
}

const roll20TimeoutTombstones = new Map<string, Roll20TimeoutTombstone>();

type ConversationTerminal =
  | { readonly type: "complete" }
  | { readonly type: "error"; readonly error: string };

interface ConversationJob {
  readonly chatId: string;
  readonly profileId: string;
  readonly backgroundEnabled: boolean;
  readonly unrestrictedWebFetchEnabled: boolean;
  readonly webSearchEnabled: boolean;
  readonly maxSteps: number;
  targetTabId: number | undefined;
  campaignId?: string;
  campaignName?: string;
  readonly abortController: AbortController;
  readonly chunks: UIMessageChunk[];
  readonly subscribers: Map<chrome.runtime.Port, string>;
  readonly debug: DebugLogger;
  terminal?: ConversationTerminal;
}

const conversationJobs = new Map<string, ConversationJob>();
let conversationStartPending = false;

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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse): boolean | undefined => {
    if (!isCampaignStatusRequest(message) || !isTrustedExtensionSender(sender)) {
      return;
    }
    void discoverAndBindCampaign(message.chatId)
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: errorMessage(error) }),
      );
    return true;
  },
);

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse): boolean | undefined => {
    if (!isChatControlRequest(message) || !isTrustedExtensionSender(sender)) {
      return;
    }
    const job = conversationJobs.get(message.chatId);
    if (message.type === CHAT_RESUME_QUERY) {
      sendResponse({ ok: true, available: job?.backgroundEnabled === true });
      return;
    }
    if (message.type === CHAT_CLEAR) {
      job?.abortController.abort();
      conversationJobs.delete(message.chatId);
      void removeCampaignBinding(message.chatId);
    } else if (message.type === CHAT_COMMIT && job?.terminal) {
      conversationJobs.delete(message.chatId);
    }
    sendResponse({ ok: true });
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

function campaignNameFromPageTitle(pageTitle?: string): string {
  const name = pageTitle
    ?.replace(/\s*[|\u2013\u2014-]\s*Roll20\s*$/i, "")
    .trim();
  return name || "Roll20 campaign";
}

function isCampaignBinding(value: unknown): value is CampaignBinding {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.campaignId === "string" &&
    typeof record.name === "string" &&
    typeof record.modVersion === "string"
  );
}

async function getCampaignBindings(): Promise<Record<string, CampaignBinding>> {
  const stored = await chrome.storage.session.get(CAMPAIGN_BINDINGS_STORAGE_KEY);
  const value = stored[CAMPAIGN_BINDINGS_STORAGE_KEY];
  if (typeof value !== "object" || value === null) return {};
  let containedLegacyTabId = false;
  const bindings = Object.fromEntries(
    Object.entries(value).flatMap(([chatId, candidate]) => {
      if (!isCampaignBinding(candidate)) return [];
      if ("tabId" in candidate) containedLegacyTabId = true;
      return [
        [
          chatId,
          {
            campaignId: candidate.campaignId,
            name: candidate.name,
            modVersion: candidate.modVersion,
          },
        ],
      ];
    }),
  ) as Record<string, CampaignBinding>;
  if (containedLegacyTabId) {
    await chrome.storage.session.set({
      [CAMPAIGN_BINDINGS_STORAGE_KEY]: bindings,
    });
  }
  return bindings;
}

async function getCampaignBinding(
  chatId: string,
): Promise<CampaignBinding | undefined> {
  return (await getCampaignBindings())[chatId];
}

async function setCampaignBinding(
  chatId: string,
  binding: CampaignBinding,
): Promise<void> {
  const bindings = await getCampaignBindings();
  if (bindings[chatId]) return;
  await chrome.storage.session.set({
    [CAMPAIGN_BINDINGS_STORAGE_KEY]: { ...bindings, [chatId]: binding },
  });
}

async function removeCampaignBinding(chatId: string): Promise<void> {
  const bindings = await getCampaignBindings();
  if (!(chatId in bindings)) return;
  delete bindings[chatId];
  await chrome.storage.session.set({ [CAMPAIGN_BINDINGS_STORAGE_KEY]: bindings });
  await removeCampaignRoute(chatId);
}

function isCampaignRoute(value: unknown): value is CampaignRoute {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).tabId === "number"
  );
}

async function getCampaignRoutes(): Promise<Record<string, CampaignRoute>> {
  const stored = await chrome.storage.session.get(CAMPAIGN_ROUTES_STORAGE_KEY);
  const value = stored[CAMPAIGN_ROUTES_STORAGE_KEY];
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, CampaignRoute] =>
      isCampaignRoute(entry[1]),
    ),
  );
}

async function getCampaignRoute(
  chatId: string,
): Promise<CampaignRoute | undefined> {
  return (await getCampaignRoutes())[chatId];
}

async function setCampaignRoute(chatId: string, tabId: number): Promise<void> {
  const routes = await getCampaignRoutes();
  await chrome.storage.session.set({
    [CAMPAIGN_ROUTES_STORAGE_KEY]: { ...routes, [chatId]: { tabId } },
  });
}

async function removeCampaignRoute(chatId: string): Promise<void> {
  const routes = await getCampaignRoutes();
  if (!(chatId in routes)) return;
  delete routes[chatId];
  await chrome.storage.session.set({ [CAMPAIGN_ROUTES_STORAGE_KEY]: routes });
}

function notifyCampaignStatus(status: CampaignStatus): void {
  void chrome.runtime
    .sendMessage({ type: CAMPAIGN_STATUS_CHANGED, status })
    .catch(() => undefined);
}

async function campaignDebugLogger(chatId: string): Promise<DebugLogger> {
  const stored = await chrome.storage.local.get(DEBUG_LOGGING_STORAGE_KEY);
  return createDebugLogger(
    isDebugLoggingEnabled(stored[DEBUG_LOGGING_STORAGE_KEY]),
    chatId,
  );
}

function removePendingRoll20Execution(requestId: string): void {
  const pending = pendingRoll20Executions.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pending.abortSignal.removeEventListener("abort", pending.abortListener);
  pendingRoll20Executions.delete(requestId);
}

function beginRoll20ExecutionTimeout(
  requestId: string,
  pending: PendingRoll20Execution,
): void {
  clearTimeout(pending.timeoutId);
  pending.timeoutId = setTimeout(() => {
    const timedOutAt = Date.now();
    rememberRoll20Timeout({
      requestId,
      chatId: pending.chatId,
      tabId: pending.tabId,
      toolCallId: pending.toolCallId,
      dispatchedAt: pending.dispatchedAt,
      timedOutAt,
      expiresAt: timedOutAt + ROLL20_TOMBSTONE_TTL_MS,
      debug: pending.debug,
    });
    pending.debug.group("Roll20 execution timed out", {
      "Tool call ID": pending.toolCallId,
      "Bridge request ID": requestId,
      Error: new Roll20ExecutionTimeoutError(),
    });
    removePendingRoll20Execution(requestId);
    pending.reject(new Roll20ExecutionTimeoutError());
  }, ROLL20_EXECUTION_TIMEOUT_MS);
}

function isStoredRoll20TimeoutTombstone(
  value: unknown,
): value is Omit<Roll20TimeoutTombstone, "debug"> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === "string" &&
    typeof record.chatId === "string" &&
    typeof record.tabId === "number" &&
    typeof record.toolCallId === "string" &&
    typeof record.dispatchedAt === "number" &&
    typeof record.timedOutAt === "number" &&
    typeof record.expiresAt === "number"
  );
}

function pruneMemoryTombstones(now = Date.now()): void {
  for (const [requestId, tombstone] of roll20TimeoutTombstones) {
    if (tombstone.expiresAt <= now) roll20TimeoutTombstones.delete(requestId);
  }
  while (roll20TimeoutTombstones.size > ROLL20_TOMBSTONE_LIMIT) {
    const oldestRequestId = roll20TimeoutTombstones.keys().next().value;
    if (typeof oldestRequestId !== "string") break;
    roll20TimeoutTombstones.delete(oldestRequestId);
  }
}

function rememberRoll20Timeout(tombstone: Roll20TimeoutTombstone): void {
  roll20TimeoutTombstones.set(tombstone.requestId, tombstone);
  pruneMemoryTombstones(tombstone.timedOutAt);
  const { debug: _debug, ...storedTombstone } = tombstone;
  void chrome.storage.session
    .get(ROLL20_TOMBSTONE_STORAGE_KEY)
    .then((stored) => {
      const now = Date.now();
      const existing = Array.isArray(stored[ROLL20_TOMBSTONE_STORAGE_KEY])
        ? stored[ROLL20_TOMBSTONE_STORAGE_KEY].filter(
            (value: unknown) =>
              isStoredRoll20TimeoutTombstone(value) && value.expiresAt > now,
          )
        : [];
      const next = [
        ...existing.filter(
          (value) => value.requestId !== storedTombstone.requestId,
        ),
        storedTombstone,
      ].slice(-ROLL20_TOMBSTONE_LIMIT);
      return chrome.storage.session.set({
        [ROLL20_TOMBSTONE_STORAGE_KEY]: next,
      });
    })
    .catch(() => undefined);
}

async function findStoredRoll20Timeout(
  requestId: string,
): Promise<Roll20TimeoutTombstone | undefined> {
  pruneMemoryTombstones();
  const memoryTombstone = roll20TimeoutTombstones.get(requestId);
  if (memoryTombstone) return memoryTombstone;
  const stored = await chrome.storage.session.get(ROLL20_TOMBSTONE_STORAGE_KEY);
  const now = Date.now();
  if (!Array.isArray(stored[ROLL20_TOMBSTONE_STORAGE_KEY])) return undefined;
  return stored[ROLL20_TOMBSTONE_STORAGE_KEY].find(
    (value: unknown) =>
      isStoredRoll20TimeoutTombstone(value) &&
      value.requestId === requestId &&
      value.expiresAt > now,
  );
}

function removeStoredRoll20Timeout(requestId: string): void {
  roll20TimeoutTombstones.delete(requestId);
  void chrome.storage.session
    .get(ROLL20_TOMBSTONE_STORAGE_KEY)
    .then((stored) => {
      if (!Array.isArray(stored[ROLL20_TOMBSTONE_STORAGE_KEY])) return;
      return chrome.storage.session.set({
        [ROLL20_TOMBSTONE_STORAGE_KEY]: stored[
          ROLL20_TOMBSTONE_STORAGE_KEY
        ].filter(
          (value: unknown) =>
            !isStoredRoll20TimeoutTombstone(value) ||
            value.requestId !== requestId,
        ),
      });
    })
    .catch(() => undefined);
}

async function loggerForUnexpectedRoll20Result(
  chatId: string,
  tombstone?: Roll20TimeoutTombstone,
): Promise<DebugLogger> {
  if (tombstone?.debug) return tombstone.debug;
  const stored = await chrome.storage.local.get(DEBUG_LOGGING_STORAGE_KEY);
  return createDebugLogger(
    isDebugLoggingEnabled(stored[DEBUG_LOGGING_STORAGE_KEY]),
    chatId,
  );
}

async function logUnexpectedRoll20Result(
  message: Roll20ExecuteResponseMessage,
  senderTabId: number,
): Promise<void> {
  if (!isRoll20ExecuteResponseMessage(message)) return;
  const tombstone = await findStoredRoll20Timeout(message.requestId).catch(
    () => undefined,
  );
  const debug = await loggerForUnexpectedRoll20Result(
    tombstone?.chatId ?? "unknown",
    tombstone,
  );
  if (tombstone && tombstone.tabId === senderTabId) {
    const receivedAt = Date.now();
    debug.group("Late Roll20 result received after timeout", {
      "Tool call ID": tombstone.toolCallId,
      "Bridge request ID": message.requestId,
      "Tab ID": senderTabId,
      "Total duration (ms)": receivedAt - tombstone.dispatchedAt,
      "Arrived after timeout (ms)": receivedAt - tombstone.timedOutAt,
      "Protocol version": message.protocolVersion,
      "Mod version": message.modVersion,
      Outcome: message.outcome,
    });
    removeStoredRoll20Timeout(message.requestId);
    return;
  }
  debug.group("Unmatched Roll20 result received", {
    "Bridge request ID": message.requestId,
    "Tab ID": senderTabId,
    ...(tombstone ? { "Expected tab ID": tombstone.tabId } : {}),
    "Protocol version": message.protocolVersion,
    "Mod version": message.modVersion,
    Outcome: message.outcome,
  });
}

chrome.runtime.onMessage.addListener((message: unknown, sender): void => {
  if (!isTrustedRoll20ContentScript(sender)) return;
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== "number") return;

  if (isRoll20AcknowledgementMessage(message)) {
    const discovery = pendingCampaignDiscoveries.get(message.requestId);
    if (discovery) {
      if (discovery.tabId !== senderTabId) return;
      clearTimeout(discovery.timeoutId);
      pendingCampaignDiscoveries.delete(message.requestId);
      discovery.debug.group("Roll20 campaign handshake received", {
        "Bridge request ID": message.requestId,
        "Tab ID": senderTabId,
        "Campaign ID": message.campaignId,
        "Campaign name": campaignNameFromPageTitle(message.pageTitle),
        "GM access": message.isGM,
        Accepted: message.accepted,
        "Protocol version": message.protocolVersion,
        "Mod version": message.modVersion,
        Error: message.error,
      });
      if (message.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
        discovery.reject(
          new Roll20CompatibilityError(
            `The Roll20 Mod uses protocol ${message.protocolVersion}, but this extension requires protocol ${ROLL20_PROTOCOL_VERSION}. Update the campaign Mod script.`,
          ),
        );
      } else if (!message.accepted && message.isGM) {
        discovery.reject(
          new Roll20CommandRejectedError(
            message.error?.name ?? "Roll20HandshakeRejectedError",
            message.error?.message ?? "The Roll20 Mod rejected the handshake.",
          ),
        );
      } else {
        discovery.resolve({
          campaignId: message.campaignId,
          name: campaignNameFromPageTitle(message.pageTitle),
          tabId: senderTabId,
          isGM: message.isGM,
          modVersion: message.modVersion,
        });
      }
      return;
    }

    const pending = pendingRoll20Executions.get(message.requestId);
    if (!pending || pending.tabId !== senderTabId) return;
    pending.debug.group("Roll20 execution acknowledged", {
      "Tool call ID": pending.toolCallId,
      "Bridge request ID": message.requestId,
      "Tab ID": senderTabId,
      "Campaign ID": message.campaignId,
      Accepted: message.accepted,
      "GM access": message.isGM,
      Error: message.error,
    });
    if (message.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
      removePendingRoll20Execution(message.requestId);
      pending.reject(
        new Roll20CompatibilityError(
          `The Roll20 Mod uses protocol ${message.protocolVersion}, but this extension requires protocol ${ROLL20_PROTOCOL_VERSION}. Update the campaign Mod script.`,
        ),
      );
      return;
    }
    if (message.campaignId !== pending.expectedCampaignId) {
      removePendingRoll20Execution(message.requestId);
      pending.reject(
        !message.accepted && message.error?.name === "CampaignMismatchError"
          ? new Roll20CampaignMismatchError(message.error.message)
          : new Roll20CompatibilityError(
              "The bound Roll20 tab is now showing a different campaign. The command result is unknown.",
            ),
      );
      return;
    }
    if (!message.accepted || !message.isGM) {
      removePendingRoll20Execution(message.requestId);
      pending.reject(
        new Roll20CommandRejectedError(
          message.error?.name ?? "Roll20CommandRejectedError",
          message.error?.message ?? "The Roll20 Mod rejected the command.",
        ),
      );
      return;
    }
    pending.acknowledged = true;
    beginRoll20ExecutionTimeout(message.requestId, pending);
    return;
  }

  if (!isRoll20ExecuteResponseMessage(message)) return;
  const pending = pendingRoll20Executions.get(message.requestId);
  if (!pending || pending.tabId !== senderTabId) {
    void logUnexpectedRoll20Result(message, senderTabId);
    return;
  }
  pending.debug.group("Roll20 result received", {
    "Tool call ID": pending.toolCallId,
    "Bridge request ID": message.requestId,
    "Tab ID": pending.tabId,
    "Campaign ID": message.campaignId,
    "Protocol version": message.protocolVersion,
    "Mod version": message.modVersion,
    Outcome: message.outcome,
  });
  removePendingRoll20Execution(message.requestId);
  if (
    message.protocolVersion !== ROLL20_PROTOCOL_VERSION ||
    message.campaignId !== pending.expectedCampaignId
  ) {
    pending.reject(
      new Roll20CompatibilityError(
        message.campaignId !== pending.expectedCampaignId
          ? "Roll20 returned a result from a different campaign. It was discarded."
          : `The Roll20 Mod uses protocol ${message.protocolVersion}, but this extension requires protocol ${ROLL20_PROTOCOL_VERSION}. Update the campaign Mod script.`,
      ),
    );
    return;
  }
  if (!pending.acknowledged) {
    pending.reject(new Error("Roll20 returned a result without acknowledging the command."));
    return;
  }
  pending.resolve(message.outcome);
});

function rejectExecutionsForUnavailableTab(tabId: number, message: string): void {
  for (const job of conversationJobs.values()) {
    if (job.targetTabId === tabId && !job.terminal) {
      job.targetTabId = undefined;
      notifyCampaignStatus({
        chatId: job.chatId,
        state: "connecting",
        ...(job.campaignId ? { campaignId: job.campaignId } : {}),
        ...(job.campaignName ? { name: job.campaignName } : {}),
        detail: `${message} Looking for another tab with the same campaign.`,
      });
      void (async () => {
        await removeCampaignRoute(job.chatId);
        const binding = await getCampaignBinding(job.chatId);
        const identity = binding
          ? await locateBoundCampaign(job.chatId, binding, job.debug).catch(
              () => undefined,
            )
          : undefined;
        notifyCampaignStatus(
          identity && binding
            ? {
                chatId: job.chatId,
                state: "connected",
                campaignId: binding.campaignId,
                name: binding.name,
              }
            : {
                chatId: job.chatId,
                state: "disconnected",
                ...(binding ? { campaignId: binding.campaignId } : {}),
                ...(binding ? { name: binding.name } : {}),
                detail:
                  "No open Roll20 GM tab matches this conversation's campaign.",
              },
        );
      })();
    }
  }
  for (const [requestId, pending] of pendingRoll20Executions) {
    if (pending.tabId !== tabId) continue;
    removePendingRoll20Execution(requestId);
    pending.reject(new Error(message));
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  rejectExecutionsForUnavailableTab(
    tabId,
    "The Roll20 campaign tab was closed. This command must not be retried.",
  );
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    typeof changeInfo.url === "string" &&
    !changeInfo.url.startsWith(ROLL20_EDITOR_URL_PREFIX)
  ) {
    rejectExecutionsForUnavailableTab(
      tabId,
      "The Roll20 campaign tab navigated away. This command must not be retried.",
    );
  }
});

function isSendAcknowledgement(value: unknown): value is SendAcknowledgement {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "extensionVersion" in value &&
    typeof value.extensionVersion === "string" &&
    "buildId" in value &&
    typeof value.buildId === "string" &&
    "protocolVersion" in value &&
    typeof value.protocolVersion === "number" &&
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

async function getBoundRoll20Tab(tabId: number): Promise<chrome.tabs.Tab> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(
      "The Roll20 campaign tab was closed. This command must not be retried.",
    );
  }
  if (!tab.url?.startsWith(ROLL20_EDITOR_URL_PREFIX)) {
    throw new Error(
      "The Roll20 campaign tab navigated away. This command must not be retried.",
    );
  }
  return tab;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendToRoll20ContentScript(
  tabId: number,
  message: Roll20ExecuteRequestMessage,
  debug: DebugLogger,
  toolCallId: string,
): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!errorMessage(error).includes("Receiving end does not exist")) throw error;

    debug.group("Roll20 content script missing; injecting it", {
      "Tool call ID": toolCallId,
      "Bridge request ID": message.requestId,
      "Tab ID": tabId,
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function discoverCampaignInTab(
  tab: chrome.tabs.Tab,
  debug: DebugLogger,
): Promise<CampaignIdentity> {
  if (typeof tab.id !== "number") throw new Error("The Roll20 tab has no ID.");
  const requestId = crypto.randomUUID();
  const issuedAt = Date.now();
  debug.group("Roll20 campaign handshake started", {
    "Bridge request ID": requestId,
    "Tab ID": tab.id,
    "Tab URL": tab.url,
  });

  const identityPromise = new Promise<CampaignIdentity>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingCampaignDiscoveries.delete(requestId);
      reject(new Error("The Roll20 Mod did not answer the campaign handshake."));
    }, ROLL20_ACKNOWLEDGEMENT_TIMEOUT_MS);
    pendingCampaignDiscoveries.set(requestId, {
      tabId: tab.id as number,
      resolve,
      reject,
      timeoutId,
      debug,
    });
  });

  try {
    const acknowledgement = await sendToRoll20ContentScript(
      tab.id,
      {
        type: ROLL20_EXECUTE_REQUEST_TYPE,
        requestId,
        kind: "identify",
        code: "",
        issuedAt,
        expiresAt: issuedAt + ROLL20_COMMAND_TTL_MS,
        extensionVersion: EXTENSION_VERSION,
        buildId: EXTENSION_BUILD_ID,
        protocolVersion: ROLL20_PROTOCOL_VERSION,
      },
      debug,
      "campaign-handshake",
    );
    if (!isSendAcknowledgement(acknowledgement)) {
      throw new Roll20CompatibilityError(
        "The Roll20 page is running an incompatible GM Tools content script. Reload the page.",
      );
    }
    if (
      acknowledgement.extensionVersion !== EXTENSION_VERSION ||
      acknowledgement.buildId !== EXTENSION_BUILD_ID ||
      acknowledgement.protocolVersion !== ROLL20_PROTOCOL_VERSION
    ) {
      throw new Roll20CompatibilityError(
        `The Roll20 page is running GM Tools ${acknowledgement.extensionVersion} build ${acknowledgement.buildId}. Reload the page to use ${EXTENSION_VERSION} build ${EXTENSION_BUILD_ID}.`,
      );
    }
    if (!acknowledgement.ok) {
      throw new Error(acknowledgement.error ?? "Could not use Roll20 chat.");
    }
    return await identityPromise;
  } catch (error) {
    const pending = pendingCampaignDiscoveries.get(requestId);
    if (pending) clearTimeout(pending.timeoutId);
    pendingCampaignDiscoveries.delete(requestId);
    throw error;
  }
}

function campaignStatusForError(chatId: string, error: unknown): CampaignStatus {
  const detail = errorMessage(error);
  return {
    chatId,
    state:
      error instanceof Roll20CompatibilityError ? "incompatible" : "unavailable",
    detail,
  };
}

async function candidateRoll20Tabs(
  chatId: string,
  activeOnly: boolean,
): Promise<chrome.tabs.Tab[]> {
  const candidates: chrome.tabs.Tab[] = [];
  const seen = new Set<number>();
  const add = (tab: chrome.tabs.Tab | undefined): void => {
    if (
      typeof tab?.id !== "number" ||
      seen.has(tab.id) ||
      !tab.url?.startsWith(ROLL20_EDITOR_URL_PREFIX)
    ) {
      return;
    }
    seen.add(tab.id);
    candidates.push(tab);
  };

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  add(activeTab);
  if (activeOnly) return candidates;

  const route = await getCampaignRoute(chatId);
  if (route) {
    try {
      add(await chrome.tabs.get(route.tabId));
    } catch {
      await removeCampaignRoute(chatId);
    }
  }
  const openRoll20Tabs = await chrome.tabs.query({
    url: `${ROLL20_EDITOR_URL_PREFIX}*`,
  });
  openRoll20Tabs.forEach(add);
  return candidates;
}

async function locateBoundCampaign(
  chatId: string,
  binding: CampaignBinding,
  debug: DebugLogger,
  activeOnly = false,
): Promise<CampaignIdentity | undefined> {
  const tabs = await candidateRoll20Tabs(chatId, activeOnly);
  for (const tab of tabs) {
    try {
      const identity = await discoverCampaignInTab(tab, debug);
      if (identity.isGM && identity.campaignId === binding.campaignId) {
        await setCampaignRoute(chatId, identity.tabId);
        const job = conversationJobs.get(chatId);
        if (job) {
          job.targetTabId = identity.tabId;
          job.campaignId = binding.campaignId;
          job.campaignName = binding.name;
        }
        debug.group("Roll20 campaign route selected", {
          "Campaign ID": binding.campaignId,
          "Campaign name": binding.name,
          "Tab ID": identity.tabId,
        });
        return identity;
      }
      debug.group("Roll20 campaign route skipped", {
        "Expected campaign ID": binding.campaignId,
        "Reported campaign ID": identity.campaignId,
        "Tab ID": identity.tabId,
        "GM access": identity.isGM,
      });
    } catch (error) {
      debug.group("Roll20 campaign probe failed", {
        "Campaign ID": binding.campaignId,
        "Tab ID": tab.id,
        Error: error,
      });
    }
  }
  await removeCampaignRoute(chatId);
  const job = conversationJobs.get(chatId);
  if (job) job.targetTabId = undefined;
  return undefined;
}

async function discoverAndBindCampaign(chatId: string): Promise<CampaignStatus> {
  const existingAttempt = campaignDiscoveryAttempts.get(chatId);
  if (existingAttempt) return existingAttempt;
  const attempt = (async (): Promise<CampaignStatus> => {
    const existing = await getCampaignBinding(chatId);
    const debug = await campaignDebugLogger(chatId);
    if (existing) {
      const identity = await locateBoundCampaign(
        chatId,
        existing,
        debug,
      ).catch(() => undefined);
      if (identity) {
        return {
          chatId,
          state: "connected",
          campaignId: existing.campaignId,
          name: existing.name,
        };
      }
      return {
        chatId,
        state: "disconnected",
        campaignId: existing.campaignId,
        name: existing.name,
        detail: "No open Roll20 GM tab matches this conversation's campaign.",
      };
    }

    notifyCampaignStatus({ chatId, state: "connecting" });
    let tab: chrome.tabs.Tab;
    try {
      tab = await findActiveRoll20Tab();
    } catch (error) {
      return { chatId, state: "unbound", detail: errorMessage(error) };
    }
    try {
      const identity = await discoverCampaignInTab(tab, debug);
      if (!identity.isGM) {
        return {
          chatId,
          state: "not-gm",
          name: identity.name,
          detail: "This Roll20 tab is not open as the game master.",
        };
      }
      const binding: CampaignBinding = {
        campaignId: identity.campaignId,
        name: identity.name,
        modVersion: identity.modVersion,
      };
      await setCampaignBinding(chatId, binding);
      await setCampaignRoute(chatId, identity.tabId);
      return {
        chatId,
        state: "connected",
        campaignId: binding.campaignId,
        name: binding.name,
      };
    } catch (error) {
      return campaignStatusForError(chatId, error);
    }
  })();
  campaignDiscoveryAttempts.set(chatId, attempt);
  try {
    const status = await attempt;
    notifyCampaignStatus(status);
    return status;
  } finally {
    campaignDiscoveryAttempts.delete(chatId);
  }
}

async function executeRoll20(
  code: string,
  abortSignal: AbortSignal,
  debug: DebugLogger,
  chatId: string,
  toolCallId: string,
  expectedCampaignId: string,
  boundTabId: number,
  backgroundEnabled: boolean,
): Promise<Roll20ExecutionOutcome> {
  if (!code.trim()) throw new Error("execute_roll20 received empty code.");
  if (code.length > MAX_ROLL20_CODE_LENGTH) {
    throw new Error("execute_roll20 code exceeds the 20,000-character limit.");
  }

  let tab: chrome.tabs.Tab;
  if (backgroundEnabled) {
    try {
      tab = await getBoundRoll20Tab(boundTabId);
    } catch (error) {
      throw new Roll20TabUnavailableBeforeDispatchError(errorMessage(error));
    }
  } else {
    tab = await findActiveRoll20Tab();
  }
  if (tab.id !== boundTabId) {
    throw new Error(
      "Focus the Roll20 tab bound to this conversation before using Roll20 tools.",
    );
  }
  const requestId = crypto.randomUUID();
  const dispatchedAt = Date.now();
  debug.group("Roll20 dispatch started", {
    "Tool call ID": toolCallId,
    "Bridge request ID": requestId,
    "Tab ID": tab.id,
    "Tab URL": tab.url,
    "Extension version": EXTENSION_VERSION,
    "Extension build ID": EXTENSION_BUILD_ID,
    "Protocol version": ROLL20_PROTOCOL_VERSION,
    "Expected campaign ID": expectedCampaignId,
  });

  return new Promise<Roll20ExecutionOutcome>((resolve, reject) => {
    const rejectPending = (
      error: Error,
      label = "Roll20 dispatch failed",
    ): void => {
      debug.group(label, {
        "Tool call ID": toolCallId,
        "Bridge request ID": requestId,
        Error: error,
      });
      removePendingRoll20Execution(requestId);
      reject(error);
    };
    const abortListener = (): void => {
      rejectPending(
        new DOMException("Roll20 execution was stopped.", "AbortError"),
        "Roll20 execution aborted",
      );
    };
    const timeoutId = setTimeout(() => {
      rejectPending(
        new Roll20CommandRejectedError(
          "ROLL20_MOD_UNAVAILABLE",
          "The Roll20 Mod did not acknowledge the command.",
        ),
        "Roll20 acknowledgement timed out",
      );
    }, ROLL20_ACKNOWLEDGEMENT_TIMEOUT_MS);

    pendingRoll20Executions.set(requestId, {
      tabId: tab.id as number,
      resolve,
      reject,
      timeoutId,
      abortSignal,
      abortListener,
      debug,
      chatId,
      toolCallId,
      dispatchedAt,
      expectedCampaignId,
      acknowledged: false,
    });
    abortSignal.addEventListener("abort", abortListener, { once: true });

    if (abortSignal.aborted) {
      abortListener();
      return;
    }

    void sendToRoll20ContentScript(
      tab.id as number,
      {
        type: ROLL20_EXECUTE_REQUEST_TYPE,
        requestId,
        kind: "execute",
        code,
        expectedCampaignId,
        issuedAt: dispatchedAt,
        expiresAt: dispatchedAt + ROLL20_COMMAND_TTL_MS,
        extensionVersion: EXTENSION_VERSION,
        buildId: EXTENSION_BUILD_ID,
        protocolVersion: ROLL20_PROTOCOL_VERSION,
      },
      debug,
      toolCallId,
    )
      .then((acknowledgement: unknown) => {
        debug.group("Roll20 content-script response", {
          "Tool call ID": toolCallId,
          "Bridge request ID": requestId,
          Acknowledgement: acknowledgement,
        });
        if (!isSendAcknowledgement(acknowledgement)) {
          rejectPending(
            new Roll20CompatibilityError(
              "The Roll20 page is running an incompatible GM Tools content script. Reload the page.",
            ),
          );
        } else if (
          acknowledgement.extensionVersion !== EXTENSION_VERSION ||
          acknowledgement.buildId !== EXTENSION_BUILD_ID ||
          acknowledgement.protocolVersion !== ROLL20_PROTOCOL_VERSION
        ) {
          rejectPending(
            new Roll20CompatibilityError(
              `The Roll20 page is running GM Tools ${acknowledgement.extensionVersion} build ${acknowledgement.buildId}. Reload the page to use ${EXTENSION_VERSION} build ${EXTENSION_BUILD_ID}.`,
            ),
          );
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
  debug: DebugLogger,
  chatId: string,
  toolCallId: string,
  expectedCampaignId: string,
  boundTabId: number,
  backgroundEnabled: boolean,
): Promise<Roll20ExecutionOutcome> {
  const execution = roll20ExecutionQueue.then(() =>
    executeRoll20(
      code,
      abortSignal,
      debug,
      chatId,
      toolCallId,
      expectedCampaignId,
      boundTabId,
      backgroundEnabled,
    ),
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

async function ensureJobCampaignBinding(
  job: ConversationJob,
  forceRouteDiscovery = false,
): Promise<CampaignTarget> {
  let binding = await getCampaignBinding(job.chatId);
  if (!binding) {
    const status = await discoverAndBindCampaign(job.chatId);
    if (status.state !== "connected") {
      throw new Roll20CommandRejectedError(
        status.state === "not-gm"
          ? "ROLL20_GM_ACCESS_REQUIRED"
          : status.state === "incompatible"
            ? "ROLL20_BRIDGE_INCOMPATIBLE"
            : "ROLL20_CAMPAIGN_UNAVAILABLE",
        status.detail ??
          "Open this conversation from its Roll20 campaign as the GM, with the GM Tools Mod enabled.",
      );
    }
    binding = await getCampaignBinding(job.chatId);
  }
  if (!binding) throw new Error("The Roll20 campaign could not be bound.");
  let tabId = forceRouteDiscovery ? undefined : job.targetTabId;
  if (tabId === undefined && !forceRouteDiscovery) {
    tabId = (await getCampaignRoute(job.chatId))?.tabId;
  }
  if (tabId !== undefined) {
    try {
      await getBoundRoll20Tab(tabId);
    } catch {
      tabId = undefined;
      await removeCampaignRoute(job.chatId);
    }
  }
  if (tabId === undefined) {
    const identity = await locateBoundCampaign(
      job.chatId,
      binding,
      job.debug,
      !job.backgroundEnabled,
    );
    if (!identity) {
      throw new Roll20CommandRejectedError(
        "ROLL20_TAB_UNAVAILABLE",
        "No open Roll20 GM tab matches this conversation's campaign.",
      );
    }
    tabId = identity.tabId;
  }
  job.targetTabId = tabId;
  job.campaignId = binding.campaignId;
  job.campaignName = binding.name;
  return { ...binding, tabId };
}

function modelErrorDebugDetails(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return { Error: error };
  const record = error as Record<string, unknown>;
  return {
    Error: error,
    Name: record.name,
    Message: record.message,
    Type: record.type,
    Code: record.code,
    "Status code": record.statusCode,
    Retryable: record.isRetryable,
    Data: record.data,
    Cause: record.cause,
  };
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
  job: ConversationJob,
  untrustedMessages: unknown,
  profile: AssistantProfile,
): Promise<void> {
  const validation = await safeValidateUIMessages<UIMessage>({
    messages: untrustedMessages,
  });
  if (!validation.success) throw new Error("The chat history is invalid.");

  const stored = await readStoredAuth();
  if (typeof stored.openRouterApiKey !== "string") {
    throw new Error("Connect to OpenRouter before sending a message.");
  }

  const { abortController, debug } = job;
  debug.group("Conversation started", {
    Profile: { id: profile.id, name: profile.name, modelId: profile.modelId },
  });

  const openrouter = createOpenRouter({
    apiKey: stored.openRouterApiKey,
    compatibility: "strict",
    appName: "GM Tools for VTT",
    appUrl: `https://chromewebstore.google.com/detail/${chrome.runtime.id}`,
  });
  const tools = {
    image_generation: createOpenRouterImageGenerationTool(),
    web_search: createOpenRouterWebSearchTool(),
    web_fetch: createOpenRouterWebFetchTool(job.unrestrictedWebFetchEnabled),
    execute_roll20: tool({
      description:
        "Execute JavaScript in the campaign's Roll20 Mod sandbox. Include a concise user-facing summary of the concrete action. The code is a function body with access to Roll20 Mod globals such as findObjs, getObj, createObj, Campaign, sendChat, and state. Include an explicit return statement and return only JSON-serializable data. Returned promises are awaited. If the result says retryable is false, do not retry the command.",
      inputSchema: jsonSchema<{
        readonly summary: string;
        readonly code: string;
      }>({
        type: "object",
        properties: {
          summary: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            description:
              "A plain-text status label no longer than 60 characters, such as 'checking Flippy’s hit points' or 'moving Flippy north'. Start with a lowercase letter unless capitalization is required for a proper noun or acronym. Distinguish inspection from modification, name known targets, and do not include code or internal reasoning.",
          },
          code: {
            type: "string",
            description: "The JavaScript function body to execute in Roll20.",
          },
        },
        required: ["summary", "code"],
        additionalProperties: false,
      }),
      execute: async ({ code }, { abortSignal, toolCallId }) => {
        try {
          const run = (target: CampaignTarget): Promise<Roll20ExecutionOutcome> =>
            queueRoll20Execution(
              code,
              abortSignal ?? abortController.signal,
              debug,
              job.chatId,
              toolCallId,
              target.campaignId,
              target.tabId,
              job.backgroundEnabled,
            );
          const initialTarget = await ensureJobCampaignBinding(job);
          try {
            return await run(initialTarget);
          } catch (error) {
            if (
              !(error instanceof Roll20CampaignMismatchError) &&
              !(error instanceof Roll20TabUnavailableBeforeDispatchError)
            ) {
              throw error;
            }
            debug.group("Recovering Roll20 campaign route", {
              "Campaign ID": initialTarget.campaignId,
              "Previous tab ID": initialTarget.tabId,
              Reason: error,
            });
            job.targetTabId = undefined;
            await removeCampaignRoute(job.chatId);
            notifyCampaignStatus({
              chatId: job.chatId,
              state: "connecting",
              campaignId: initialTarget.campaignId,
              name: initialTarget.name,
              detail: "Looking for the campaign in another Roll20 tab.",
            });
            let recoveredTarget: CampaignTarget;
            try {
              recoveredTarget = await ensureJobCampaignBinding(job, true);
            } catch (recoveryError) {
              if (error instanceof Roll20CampaignMismatchError) {
                throw new Roll20CampaignMismatchError(
                  "The routed tab is showing another campaign, and no open Roll20 GM tab matches this conversation's campaign.",
                );
              }
              throw recoveryError;
            }
            notifyCampaignStatus({
              chatId: job.chatId,
              state: "connected",
              campaignId: recoveredTarget.campaignId,
              name: recoveredTarget.name,
            });
            return await run(recoveredTarget);
          }
        } catch (error) {
          if (error instanceof Roll20ExecutionTimeoutError) {
            return {
              ok: false,
              error: {
                code: "ROLL20_EXECUTION_TIMEOUT",
                message:
                  "Roll20 did not return a result within 45 seconds. The execution may still be running.",
                retryable: false,
                executionState: "unknown",
              },
            };
          }
          if (error instanceof Roll20CompatibilityError) {
            return {
              ok: false,
              error: {
                code: "ROLL20_BRIDGE_INCOMPATIBLE",
                message: error.message,
                retryable: false,
              },
            };
          }
          if (error instanceof Roll20CommandRejectedError) {
            return {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                retryable: false,
              },
            };
          }
          if (error instanceof Roll20CampaignMismatchError) {
            return {
              ok: false,
              error: {
                code: "ROLL20_CAMPAIGN_MISMATCH",
                message: error.message,
                retryable: false,
              },
            };
          }
          let message = errorMessage(error);
          let tabUnavailable =
            message.includes("campaign tab was closed") ||
            message.includes("campaign tab navigated away") ||
            message.includes("No tab with id");
          if (job.targetTabId !== undefined) {
            try {
              await getBoundRoll20Tab(job.targetTabId);
            } catch (tabError) {
              message = errorMessage(tabError);
              tabUnavailable = true;
            }
          }
          if (tabUnavailable) {
            return {
              ok: false,
              error: {
                code: "ROLL20_TAB_UNAVAILABLE",
                message,
                retryable: false,
              },
            };
          }
          throw error;
        }
      },
    }),
  };
  const activeTools: Array<keyof typeof tools> = [
    "image_generation",
    "web_fetch",
    "execute_roll20",
  ];
  if (job.webSearchEnabled) activeTools.unshift("web_search");
  const result = streamText({
    model: openrouter(profile.modelId),
    system: buildProfileInstructions(profile),
    messages: await convertToModelMessages(validation.data),
    tools,
    activeTools,
    stopWhen: isStepCount(job.maxSteps),
    abortSignal: abortController.signal,
    onLanguageModelCallStart: (event) => {
      debug.group("→ Model", {
        "Call ID": event.callId,
        Provider: event.provider,
        Model: event.modelId,
        Instructions: event.instructions,
        Messages: event.messages,
      });
    },
    onLanguageModelCallEnd: (event) => {
      debug.group("← Model", {
        "Call ID": event.callId,
        Provider: event.provider,
        Model: event.modelId,
        "Finish reason": event.finishReason,
        Content: event.content,
        Usage: event.usage,
        Performance: event.performance,
      });
    },
    onToolExecutionStart: (event) => {
      debug.group(`Tool call · ${event.toolCall.toolName}`, {
        "Call ID": event.callId,
        "Tool call ID": event.toolCall.toolCallId,
        Arguments: event.toolCall.input,
      });
    },
    onToolExecutionEnd: (event) => {
      debug.group(`Tool response · ${event.toolCall.toolName}`, {
        "Call ID": event.callId,
        "Tool call ID": event.toolCall.toolCallId,
        "Duration (ms)": event.toolExecutionMs,
        Response:
          event.toolOutput.type === "tool-result"
            ? event.toolOutput.output
            : event.toolOutput.error,
        Status: event.toolOutput.type,
      });
    },
    onError: ({ error }) => {
      debug.group("Model stream error", modelErrorDebugDetails(error));
    },
    onAbort: (event) => {
      debug.group("Conversation aborted", {
        "Completed steps": event.steps.length,
      });
    },
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
    job.chunks.push(chunk);
    broadcastJob(job, (requestId) => ({
      type: CHAT_CHUNK,
      requestId,
      chunk,
    }));
  }
  finishJob(job, { type: "complete" });
  debug.group("Conversation completed", {});
}

function broadcastJob(
  job: ConversationJob,
  createMessage: (requestId: string) => ChatPortResponse,
): void {
  for (const [port, requestId] of job.subscribers) {
    if (!postToPort(port, createMessage(requestId))) {
      job.subscribers.delete(port);
    }
  }
}

function finishJob(job: ConversationJob, terminal: ConversationTerminal): void {
  if (job.terminal) return;
  job.terminal = terminal;
  broadcastJob(job, (requestId) =>
    terminal.type === "complete"
      ? { type: CHAT_COMPLETE, requestId }
      : { type: CHAT_ERROR, requestId, error: terminal.error },
  );
  if (!job.backgroundEnabled && job.subscribers.size === 0) {
    conversationJobs.delete(job.chatId);
  }
}

function attachToJob(
  job: ConversationJob,
  port: chrome.runtime.Port,
  requestId: string,
): void {
  job.subscribers.set(port, requestId);
  job.debug.group("Conversation attached", {
    "Buffered chunks": job.chunks.length,
    Terminal: job.terminal?.type ?? "running",
  });
  for (const chunk of job.chunks) {
    if (!postToPort(port, { type: CHAT_CHUNK, requestId, chunk })) {
      job.subscribers.delete(port);
      return;
    }
  }
  if (job.terminal) {
    postToPort(
      port,
      job.terminal.type === "complete"
        ? { type: CHAT_COMPLETE, requestId }
        : { type: CHAT_ERROR, requestId, error: job.terminal.error },
    );
  }
}

async function keepServiceWorkerAlive<T>(operation: Promise<T>): Promise<T> {
  const intervalId = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, SERVICE_WORKER_KEEPALIVE_INTERVAL_MS);

  try {
    return await operation;
  } finally {
    clearInterval(intervalId);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHAT_PORT_NAME || !isTrustedExtensionSender(port.sender)) {
    port.disconnect();
    return;
  }

  let attachedJob: ConversationJob | null = null;
  let attachedRequestId: string | null = null;
  let disconnected = false;

  port.onMessage.addListener((message: unknown) => {
    if (!isChatPortRequest(message)) return;

    if (message.type === CHAT_ABORT) {
      if (
        message.requestId === attachedRequestId &&
        message.chatId === attachedJob?.chatId
      ) {
        attachedJob.abortController.abort();
      }
      return;
    }

    if (attachedJob) return;
    if (message.type === CHAT_RESUME) {
      const job = conversationJobs.get(message.chatId);
      if (!job?.backgroundEnabled) {
        postToPort(port, {
          type: CHAT_ERROR,
          requestId: message.requestId,
          error: "The background conversation is no longer available.",
        });
        return;
      }
      attachedJob = job;
      attachedRequestId = message.requestId;
      attachToJob(job, port, message.requestId);
      return;
    }

    const runningJob = [...conversationJobs.values()].find(
      (job) => !job.terminal,
    );
    if (runningJob || conversationStartPending) {
      postToPort(port, {
        type: CHAT_ERROR,
        requestId: message.requestId,
        error: "Another conversation is already running.",
      });
      return;
    }
    conversationStartPending = true;

    void (async () => {
      const preferences = await chrome.storage.local.get([
        DEBUG_LOGGING_STORAGE_KEY,
        BACKGROUND_EXECUTION_STORAGE_KEY,
        MAX_STEPS_STORAGE_KEY,
        UNRESTRICTED_WEB_FETCH_STORAGE_KEY,
        WEB_SEARCH_STORAGE_KEY,
      ]);
      const backgroundEnabled = isBackgroundExecutionEnabled(
        preferences[BACKGROUND_EXECUTION_STORAGE_KEY],
      );
      const debug = createDebugLogger(
        isDebugLoggingEnabled(preferences[DEBUG_LOGGING_STORAGE_KEY]),
        message.chatId,
      );
      const maxSteps = normalizeMaxSteps(preferences[MAX_STEPS_STORAGE_KEY]);
      const unrestrictedWebFetchEnabled = isUnrestrictedWebFetchEnabled(
        preferences[UNRESTRICTED_WEB_FETCH_STORAGE_KEY],
      );
      const webSearchEnabled = isWebSearchEnabled(
        preferences[WEB_SEARCH_STORAGE_KEY],
      );
      const campaignBinding = await getCampaignBinding(message.chatId);
      const campaignRoute = campaignBinding
        ? await getCampaignRoute(message.chatId)
        : undefined;
      if (disconnected && !backgroundEnabled) return;
      const abortController = new AbortController();
      const job: ConversationJob = {
        chatId: message.chatId,
        profileId: message.profile.id,
        backgroundEnabled,
        unrestrictedWebFetchEnabled,
        webSearchEnabled,
        maxSteps,
        targetTabId: campaignRoute?.tabId,
        ...(campaignBinding
          ? {
              campaignId: campaignBinding.campaignId,
              campaignName: campaignBinding.name,
            }
          : {}),
        abortController,
        chunks: [],
        subscribers: new Map(),
        debug,
      };
      conversationJobs.set(job.chatId, job);
      attachedJob = job;
      attachedRequestId = message.requestId;
      if (!disconnected) attachToJob(job, port, message.requestId);
      debug.group("Conversation context", {
        "Background execution": backgroundEnabled,
        "Unrestricted web fetch": unrestrictedWebFetchEnabled,
        "Web search": webSearchEnabled,
        "Maximum steps": maxSteps,
        "Bound Roll20 tab ID": job.targetTabId ?? "none",
        "Bound Roll20 campaign ID": job.campaignId ?? "none",
        "Bound Roll20 campaign name": job.campaignName ?? "none",
      });
      activeChatControllers.add(abortController);

      void keepServiceWorkerAlive(streamChat(job, message.messages, message.profile))
        .catch((error: unknown) => {
          finishJob(
            job,
            abortController.signal.aborted
              ? { type: "complete" }
              : { type: "error", error: userFacingModelError(error) },
          );
        })
        .finally(() => {
          activeChatControllers.delete(abortController);
        });
    })().catch((error: unknown) => {
      postToPort(port, {
        type: CHAT_ERROR,
        requestId: message.requestId,
        error: userFacingModelError(error),
      });
    }).finally(() => {
      conversationStartPending = false;
    });
  });

  port.onDisconnect.addListener(() => {
    disconnected = true;
    const job = attachedJob;
    if (!job) return;
    job.subscribers.delete(port);
    job.debug.group("Conversation detached", {
      "Background execution": job.backgroundEnabled,
    });
    if (!job.backgroundEnabled && !job.terminal) job.abortController.abort();
  });
});
