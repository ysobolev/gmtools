import type { UIMessage, UIMessageChunk } from "ai";
import {
  isAssistantProfile,
  type AssistantProfile,
} from "./profile-config";

export const AUTH_STATUS_REQUEST = "GMTOOLS_AUTH_STATUS" as const;
export const AUTH_CONNECT_REQUEST = "GMTOOLS_AUTH_CONNECT" as const;
export const AUTH_DISCONNECT_REQUEST = "GMTOOLS_AUTH_DISCONNECT" as const;
export const AUTH_STATE_CHANGED = "GMTOOLS_AUTH_STATE_CHANGED" as const;

export const CHAT_PORT_NAME = "GMTOOLS_OPENROUTER_CHAT" as const;
export const CHAT_START = "GMTOOLS_CHAT_START" as const;
export const CHAT_ABORT = "GMTOOLS_CHAT_ABORT" as const;
export const CHAT_CHUNK = "GMTOOLS_CHAT_CHUNK" as const;
export const CHAT_COMPLETE = "GMTOOLS_CHAT_COMPLETE" as const;
export const CHAT_ERROR = "GMTOOLS_CHAT_ERROR" as const;

export interface AuthStatus {
  readonly connected: boolean;
  readonly userId?: string;
  readonly keyLabel?: string;
  readonly limitRemaining?: number | null;
}

export type AuthRequest =
  | { readonly type: typeof AUTH_STATUS_REQUEST }
  | { readonly type: typeof AUTH_CONNECT_REQUEST }
  | { readonly type: typeof AUTH_DISCONNECT_REQUEST };

export type AuthResponse =
  | { readonly ok: true; readonly status: AuthStatus }
  | { readonly ok: false; readonly error: string };

export interface AuthStateChangedMessage {
  readonly type: typeof AUTH_STATE_CHANGED;
  readonly status: AuthStatus;
}

export type ChatPortRequest =
  | {
      readonly type: typeof CHAT_START;
      readonly requestId: string;
      readonly messages: UIMessage[];
      readonly profile: AssistantProfile;
    }
  | {
      readonly type: typeof CHAT_ABORT;
      readonly requestId: string;
    };

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

export function isAuthRequest(value: unknown): value is AuthRequest {
  if (!isRecord(value)) return false;
  return (
    value.type === AUTH_STATUS_REQUEST ||
    value.type === AUTH_CONNECT_REQUEST ||
    value.type === AUTH_DISCONNECT_REQUEST
  );
}

export function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.error === "string";
  return isRecord(value.status) && typeof value.status.connected === "boolean";
}

export function isAuthStateChangedMessage(
  value: unknown,
): value is AuthStateChangedMessage {
  return (
    isRecord(value) &&
    value.type === AUTH_STATE_CHANGED &&
    isRecord(value.status) &&
    typeof value.status.connected === "boolean"
  );
}

export function isChatPortRequest(value: unknown): value is ChatPortRequest {
  if (!isRecord(value) || typeof value.requestId !== "string") return false;
  if (value.type === CHAT_ABORT) return true;
  return (
    value.type === CHAT_START &&
    Array.isArray(value.messages) &&
    isAssistantProfile(value.profile)
  );
}

export function isChatPortResponse(value: unknown): value is ChatPortResponse {
  if (!isRecord(value) || typeof value.requestId !== "string") return false;
  if (value.type === CHAT_COMPLETE) return true;
  if (value.type === CHAT_ERROR) return typeof value.error === "string";
  return value.type === CHAT_CHUNK && isRecord(value.chunk);
}
