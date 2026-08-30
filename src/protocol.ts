export const RANDOM_REQUEST_TYPE = "GMTOOLS_RANDOM_REQUEST" as const;
export const RANDOM_RESPONSE_TYPE = "GMTOOLS_RANDOM_RESPONSE" as const;
export const RANDOM_COMMAND = "!gmtools-poc" as const;

const REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
const RESPONSE_PATTERN =
  /GMTOOLS_RESPONSE\s*:\s*([a-f0-9-]{8,64})\s*:\s*(\d{1,3})/i;

export interface RandomRequestMessage {
  readonly type: typeof RANDOM_REQUEST_TYPE;
  readonly requestId: string;
}

export interface RandomResponseMessage {
  readonly type: typeof RANDOM_RESPONSE_TYPE;
  readonly requestId: string;
  readonly value: number;
}

export interface SendAcknowledgement {
  readonly ok: boolean;
  readonly error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function isRandomRequestMessage(
  value: unknown,
): value is RandomRequestMessage {
  return (
    isRecord(value) &&
    value.type === RANDOM_REQUEST_TYPE &&
    isValidRequestId(value.requestId)
  );
}

export function isRandomResponseMessage(
  value: unknown,
): value is RandomResponseMessage {
  return (
    isRecord(value) &&
    value.type === RANDOM_RESPONSE_TYPE &&
    isValidRequestId(value.requestId) &&
    typeof value.value === "number" &&
    Number.isInteger(value.value) &&
    value.value >= 1 &&
    value.value <= 100
  );
}

export function formatRandomCommand(requestId: string): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  return `${RANDOM_COMMAND} ${requestId}`;
}

export function parseRandomCommand(content: string): string | null {
  const parts = content.trim().split(/\s+/);
  const requestId = parts[1];
  return parts.length === 2 && parts[0] === RANDOM_COMMAND && isValidRequestId(requestId)
    ? requestId
    : null;
}

export function formatRandomResponse(requestId: string, value: number): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Invalid GM Tools random value.");
  }
  return `GMTOOLS_RESPONSE:${requestId}:${value}`;
}

export function parseRandomResponseText(
  content: string,
): RandomResponseMessage | null {
  const match = content.match(RESPONSE_PATTERN);
  if (!match) return null;

  const requestId = match[1];
  const value = Number(match[2]);
  const response: unknown = {
    type: RANDOM_RESPONSE_TYPE,
    requestId,
    value,
  };
  return isRandomResponseMessage(response) ? response : null;
}
