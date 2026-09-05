import type { UIMessage, UIMessageChunk } from "ai";
import type { ChatContinuation } from "./chat-store";

export const AUTH_STATUS_REQUEST = "GMTOOLS_AUTH_STATUS" as const;
export const AUTH_CONNECT_REQUEST = "GMTOOLS_AUTH_CONNECT" as const;
export const AUTH_DISCONNECT_REQUEST = "GMTOOLS_AUTH_DISCONNECT" as const;
export const AUTH_PERSISTENCE_REQUEST = "GMTOOLS_AUTH_PERSISTENCE" as const;
export const AUTH_STATE_CHANGED = "GMTOOLS_AUTH_STATE_CHANGED" as const;
export const CAMPAIGN_STATUS_REQUEST = "GMTOOLS_CAMPAIGN_STATUS" as const;
export const CAMPAIGN_CANDIDATES_REQUEST =
  "GMTOOLS_CAMPAIGN_CANDIDATES" as const;
export const CAMPAIGN_ATTACH_REQUEST = "GMTOOLS_CAMPAIGN_ATTACH" as const;
export const CAMPAIGN_DETACH_REQUEST = "GMTOOLS_CAMPAIGN_DETACH" as const;
export const CAMPAIGN_DELETE_REQUEST = "GMTOOLS_CAMPAIGN_DELETE" as const;
export const CAMPAIGN_DELETE_PREVIEW_REQUEST =
  "GMTOOLS_CAMPAIGN_DELETE_PREVIEW" as const;
export const CAMPAIGN_STATUS_CHANGED =
  "GMTOOLS_CAMPAIGN_STATUS_CHANGED" as const;

export const CHAT_PORT_NAME = "GMTOOLS_OPENROUTER_CHAT" as const;
export const PANEL_PRESENCE_PORT_NAME = "GMTOOLS_PANEL_PRESENCE" as const;
export const CHAT_START = "GMTOOLS_CHAT_START" as const;
export const CHAT_CONTINUE = "GMTOOLS_CHAT_CONTINUE" as const;
export const CHAT_RESUME = "GMTOOLS_CHAT_RESUME" as const;
export const CHAT_ABORT = "GMTOOLS_CHAT_ABORT" as const;
export const CHAT_RESUME_QUERY = "GMTOOLS_CHAT_RESUME_QUERY" as const;
export const CHAT_COMMIT = "GMTOOLS_CHAT_COMMIT" as const;
export const CHAT_CLEAR = "GMTOOLS_CHAT_CLEAR" as const;
export const CHAT_CHUNK = "GMTOOLS_CHAT_CHUNK" as const;
export const CHAT_COMPLETE = "GMTOOLS_CHAT_COMPLETE" as const;
export const CHAT_ERROR = "GMTOOLS_CHAT_ERROR" as const;
export const CHAT_ACTIVITIES_REQUEST = "GMTOOLS_CHAT_ACTIVITIES" as const;
export const CHAT_ACTIVITY_CHANGED = "GMTOOLS_CHAT_ACTIVITY_CHANGED" as const;
export const CHAT_CONTINUATION_CHANGED =
  "GMTOOLS_CHAT_CONTINUATION_CHANGED" as const;
export const CHAT_APPROVALS_CHANGED = "GMTOOLS_CHAT_APPROVALS_CHANGED" as const;
export const CHAT_MESSAGES_CHANGED = "GMTOOLS_CHAT_MESSAGES_CHANGED" as const;

export interface AuthStatus {
  readonly connected: boolean;
  readonly persistent: boolean;
  readonly userId?: string;
  readonly keyLabel?: string;
  readonly limitRemaining?: number | null;
}

export type AuthRequest =
  | { readonly type: typeof AUTH_STATUS_REQUEST }
  | {
      readonly type: typeof AUTH_CONNECT_REQUEST;
      readonly persistent: boolean;
    }
  | { readonly type: typeof AUTH_DISCONNECT_REQUEST }
  | {
      readonly type: typeof AUTH_PERSISTENCE_REQUEST;
      readonly enabled: boolean;
    };

export type AuthResponse =
  | { readonly ok: true; readonly status: AuthStatus }
  | { readonly ok: false; readonly error: string };

export interface AuthStateChangedMessage {
  readonly type: typeof AUTH_STATE_CHANGED;
  readonly status: AuthStatus;
}

export type CampaignConnectionState =
  | "unbound"
  | "connecting"
  | "connected"
  | "unavailable"
  | "not-gm"
  | "disconnected"
  | "incompatible";

export interface CampaignStatus {
  readonly chatId: string;
  readonly state: CampaignConnectionState;
  readonly campaignId?: string;
  readonly name?: string;
  readonly detail?: string;
}

export interface CampaignStatusRequest {
  readonly type:
    | typeof CAMPAIGN_STATUS_REQUEST
    | typeof CAMPAIGN_DETACH_REQUEST;
  readonly chatId: string;
}

export interface CampaignCandidate {
  readonly campaignId: string;
  readonly name: string;
  readonly modVersion: string;
  readonly tabId?: number;
  readonly activeTab: boolean;
}

export interface CampaignCandidatesRequest {
  readonly type: typeof CAMPAIGN_CANDIDATES_REQUEST;
  readonly chatId: string;
}

export interface CampaignAttachRequest {
  readonly type: typeof CAMPAIGN_ATTACH_REQUEST;
  readonly chatId: string;
  readonly candidate: CampaignCandidate;
}

export interface CampaignDeleteRequest {
  readonly type: typeof CAMPAIGN_DELETE_REQUEST;
  readonly campaignId: string;
  readonly mode: "detach-chats" | "delete-chats";
}

export interface CampaignDeletePreviewRequest {
  readonly type: typeof CAMPAIGN_DELETE_PREVIEW_REQUEST;
  readonly campaignId: string;
}

export type CampaignDeletePreviewResponse =
  | {
      readonly ok: true;
      readonly preview: {
        readonly chatCount: number;
        readonly activeChatCount: number;
        readonly pendingApprovalChatCount: number;
        readonly memoryCount: number;
      };
    }
  | { readonly ok: false; readonly error: string };

export type CampaignDeleteResponse =
  | {
      readonly ok: true;
      readonly result: {
        readonly campaignId: string;
        readonly chatIds: readonly string[];
        readonly mode: "detach-chats" | "delete-chats";
      };
    }
  | { readonly ok: false; readonly error: string };

export interface CampaignStatusChangedMessage {
  readonly type: typeof CAMPAIGN_STATUS_CHANGED;
  readonly status: CampaignStatus;
}

export type CampaignStatusResponse =
  | { readonly ok: true; readonly status: CampaignStatus }
  | { readonly ok: false; readonly error: string };

export type CampaignCandidatesResponse =
  | { readonly ok: true; readonly candidates: readonly CampaignCandidate[] }
  | { readonly ok: false; readonly error: string };

export type ChatPortRequest =
  | {
      readonly type: typeof CHAT_START;
      readonly requestId: string;
      readonly chatId: string;
      readonly messages: UIMessage[];
      readonly profileId: string;
    }
  | {
      readonly type: typeof CHAT_RESUME;
      readonly requestId: string;
      readonly chatId: string;
    }
  | {
      readonly type: typeof CHAT_CONTINUE;
      readonly requestId: string;
      readonly chatId: string;
      readonly profileId: string;
    }
  | {
      readonly type: typeof CHAT_ABORT;
      readonly requestId: string;
      readonly chatId: string;
    };

export type ChatControlRequest =
  | { readonly type: typeof CHAT_RESUME_QUERY; readonly chatId: string }
  | { readonly type: typeof CHAT_COMMIT; readonly chatId: string }
  | { readonly type: typeof CHAT_CLEAR; readonly chatId: string };

export interface ChatControlResponse {
  readonly ok: true;
  readonly available?: boolean;
}

export type ChatActivityState =
  | "idle"
  | "thinking"
  | "working"
  | "approval"
  | "unread"
  | "error";

export interface ChatActivityStatus {
  readonly chatId: string;
  readonly state: ChatActivityState;
  readonly summary?: string;
  readonly modelInactive?: boolean;
}

export interface ChatActivityChangedMessage {
  readonly type: typeof CHAT_ACTIVITY_CHANGED;
  readonly activity: ChatActivityStatus;
}

export interface ChatContinuationChangedMessage {
  readonly type: typeof CHAT_CONTINUATION_CHANGED;
  readonly chatId: string;
  readonly continuation: ChatContinuation | null;
}

export interface ChatApprovalsChangedMessage {
  readonly type: typeof CHAT_APPROVALS_CHANGED;
  readonly chatId: string;
  readonly count: number;
}

export interface ChatMessagesChangedMessage {
  readonly type: typeof CHAT_MESSAGES_CHANGED;
  readonly chatId: string;
}

export type ChatActivitiesResponse =
  | { readonly ok: true; readonly activities: readonly ChatActivityStatus[] }
  | { readonly ok: false; readonly error: string };

export type ChatPortResponse =
  | {
      readonly type: typeof CHAT_CHUNK;
      readonly requestId: string;
      readonly chunk: UIMessageChunk;
    }
  | {
      readonly type: typeof CHAT_COMPLETE;
      readonly requestId: string;
    }
  | {
      readonly type: typeof CHAT_ERROR;
      readonly requestId: string;
      readonly error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatActivityStatus(value: unknown): value is ChatActivityStatus {
  return (
    isRecord(value) &&
    typeof value.chatId === "string" &&
    (value.state === "idle" ||
      value.state === "thinking" ||
      value.state === "working" ||
      value.state === "approval" ||
      value.state === "unread" ||
      value.state === "error") &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.modelInactive === undefined || typeof value.modelInactive === "boolean")
  );
}

export function isChatActivitiesRequest(value: unknown): boolean {
  return isRecord(value) && value.type === CHAT_ACTIVITIES_REQUEST;
}

export function isChatActivitiesResponse(
  value: unknown,
): value is ChatActivitiesResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok
      ? Array.isArray(value.activities) &&
        value.activities.every(isChatActivityStatus)
      : typeof value.error === "string")
  );
}

export function isChatActivityChangedMessage(
  value: unknown,
): value is ChatActivityChangedMessage {
  return (
    isRecord(value) &&
    value.type === CHAT_ACTIVITY_CHANGED &&
    isChatActivityStatus(value.activity)
  );
}

export function isChatContinuationChangedMessage(
  value: unknown,
): value is ChatContinuationChangedMessage {
  if (
    !isRecord(value) ||
    value.type !== CHAT_CONTINUATION_CHANGED ||
    typeof value.chatId !== "string"
  ) {
    return false;
  }
  if (value.continuation === null) return true;
  if (
    !isRecord(value.continuation) ||
    (value.continuation.reason !== "step-limit" &&
      value.continuation.reason !== "stream-error") ||
    typeof value.continuation.afterMessageId !== "string" ||
    value.continuation.afterMessageId.length === 0 ||
    typeof value.continuation.createdAt !== "number" ||
    !Number.isFinite(value.continuation.createdAt) ||
    value.continuation.createdAt < 0
  ) {
    return false;
  }
  return (
    value.continuation.reason === "stream-error" ||
    (typeof value.continuation.stepLimit === "number" &&
      Number.isInteger(value.continuation.stepLimit) &&
      value.continuation.stepLimit > 0)
  );
}

export function isChatApprovalsChangedMessage(
  value: unknown,
): value is ChatApprovalsChangedMessage {
  return (
    isRecord(value) &&
    value.type === CHAT_APPROVALS_CHANGED &&
    typeof value.chatId === "string" &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 0
  );
}

export function isChatMessagesChangedMessage(
  value: unknown,
): value is ChatMessagesChangedMessage {
  return (
    isRecord(value) &&
    value.type === CHAT_MESSAGES_CHANGED &&
    typeof value.chatId === "string" &&
    value.chatId.length > 0
  );
}

function isCampaignStatus(value: unknown): value is CampaignStatus {
  if (!isRecord(value) || typeof value.chatId !== "string") return false;
  return (
    (value.state === "unbound" ||
      value.state === "connecting" ||
      value.state === "connected" ||
      value.state === "unavailable" ||
      value.state === "not-gm" ||
      value.state === "disconnected" ||
      value.state === "incompatible") &&
    (value.campaignId === undefined || typeof value.campaignId === "string") &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.detail === undefined || typeof value.detail === "string")
  );
}

function isCampaignCandidate(value: unknown): value is CampaignCandidate {
  return (
    isRecord(value) &&
    typeof value.campaignId === "string" &&
    value.campaignId.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.modVersion === "string" &&
    (value.tabId === undefined || typeof value.tabId === "number") &&
    typeof value.activeTab === "boolean"
  );
}

export function isCampaignStatusRequest(
  value: unknown,
): value is CampaignStatusRequest {
  return (
    isRecord(value) &&
    (value.type === CAMPAIGN_STATUS_REQUEST ||
      value.type === CAMPAIGN_DETACH_REQUEST) &&
    typeof value.chatId === "string"
  );
}

export function isCampaignCandidatesRequest(
  value: unknown,
): value is CampaignCandidatesRequest {
  return (
    isRecord(value) &&
    value.type === CAMPAIGN_CANDIDATES_REQUEST &&
    typeof value.chatId === "string"
  );
}

export function isCampaignAttachRequest(
  value: unknown,
): value is CampaignAttachRequest {
  return (
    isRecord(value) &&
    value.type === CAMPAIGN_ATTACH_REQUEST &&
    typeof value.chatId === "string" &&
    isCampaignCandidate(value.candidate)
  );
}

export function isCampaignDeleteRequest(
  value: unknown,
): value is CampaignDeleteRequest {
  return (
    isRecord(value) &&
    value.type === CAMPAIGN_DELETE_REQUEST &&
    typeof value.campaignId === "string" &&
    value.campaignId.length > 0 &&
    (value.mode === "detach-chats" || value.mode === "delete-chats")
  );
}

export function isCampaignDeletePreviewRequest(
  value: unknown,
): value is CampaignDeletePreviewRequest {
  return (
    isRecord(value) &&
    value.type === CAMPAIGN_DELETE_PREVIEW_REQUEST &&
    typeof value.campaignId === "string" &&
    value.campaignId.length > 0
  );
}

export function isCampaignDeletePreviewResponse(
  value: unknown,
): value is CampaignDeletePreviewResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.error === "string";
  if (!isRecord(value.preview)) return false;
  return [
    value.preview.chatCount,
    value.preview.activeChatCount,
    value.preview.pendingApprovalChatCount,
    value.preview.memoryCount,
  ].every(
    (count) =>
      typeof count === "number" && Number.isInteger(count) && count >= 0,
  );
}

export function isCampaignDeleteResponse(
  value: unknown,
): value is CampaignDeleteResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.error === "string";
  return (
    isRecord(value.result) &&
    typeof value.result.campaignId === "string" &&
    Array.isArray(value.result.chatIds) &&
    value.result.chatIds.every((chatId) => typeof chatId === "string") &&
    (value.result.mode === "detach-chats" ||
      value.result.mode === "delete-chats")
  );
}

export function isCampaignStatusResponse(
  value: unknown,
): value is CampaignStatusResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === true
      ? isCampaignStatus(value.status)
      : typeof value.error === "string")
  );
}

export function isCampaignCandidatesResponse(
  value: unknown,
): value is CampaignCandidatesResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === true
      ? Array.isArray(value.candidates) &&
        value.candidates.every(isCampaignCandidate)
      : typeof value.error === "string")
  );
}

export function isCampaignStatusChangedMessage(
  value: unknown,
): value is CampaignStatusChangedMessage {
  return (
    isRecord(value) &&
    value.type === CAMPAIGN_STATUS_CHANGED &&
    isCampaignStatus(value.status)
  );
}

export function isAuthRequest(value: unknown): value is AuthRequest {
  if (!isRecord(value)) return false;
  return (
    value.type === AUTH_STATUS_REQUEST ||
    (value.type === AUTH_CONNECT_REQUEST &&
      typeof value.persistent === "boolean") ||
    value.type === AUTH_DISCONNECT_REQUEST ||
    (value.type === AUTH_PERSISTENCE_REQUEST &&
      typeof value.enabled === "boolean")
  );
}

export function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.error === "string";
  return (
    isRecord(value.status) &&
    typeof value.status.connected === "boolean" &&
    typeof value.status.persistent === "boolean"
  );
}

export function isAuthStateChangedMessage(
  value: unknown,
): value is AuthStateChangedMessage {
  return (
    isRecord(value) &&
    value.type === AUTH_STATE_CHANGED &&
    isRecord(value.status) &&
    typeof value.status.connected === "boolean" &&
    typeof value.status.persistent === "boolean"
  );
}

export function isChatPortRequest(value: unknown): value is ChatPortRequest {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    typeof value.chatId !== "string"
  ) {
    return false;
  }
  if (value.type === CHAT_ABORT || value.type === CHAT_RESUME) return true;
  if (value.type === CHAT_CONTINUE) {
    return typeof value.profileId === "string" && value.profileId.length > 0;
  }
  return (
    value.type === CHAT_START &&
    Array.isArray(value.messages) &&
    typeof value.profileId === "string" &&
    value.profileId.length > 0
  );
}

export function isChatControlRequest(
  value: unknown,
): value is ChatControlRequest {
  return (
    isRecord(value) &&
    typeof value.chatId === "string" &&
    (value.type === CHAT_RESUME_QUERY ||
      value.type === CHAT_COMMIT ||
      value.type === CHAT_CLEAR)
  );
}

export function isChatControlResponse(
  value: unknown,
): value is ChatControlResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    (value.available === undefined || typeof value.available === "boolean")
  );
}

export function isChatPortResponse(value: unknown): value is ChatPortResponse {
  if (!isRecord(value) || typeof value.requestId !== "string") return false;
  if (value.type === CHAT_COMPLETE) return true;
  if (value.type === CHAT_ERROR) return typeof value.error === "string";
  return value.type === CHAT_CHUNK && isRecord(value.chunk);
}
