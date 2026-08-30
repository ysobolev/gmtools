export const ROLL20_EXECUTE_REQUEST_TYPE = "GMTOOLS_ROLL20_EXECUTE" as const;
export const ROLL20_EXECUTE_RESPONSE_TYPE =
  "GMTOOLS_ROLL20_EXECUTE_RESPONSE" as const;
export const ROLL20_EXECUTE_COMMAND = "!gmtools-exec" as const;

const REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
const RESPONSE_PREFIX = "GMTOOLS_EXECUTION_RESPONSE:";
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface Roll20ExecuteRequestMessage {
  readonly type: typeof ROLL20_EXECUTE_REQUEST_TYPE;
  readonly requestId: string;
  readonly code: string;
}

export interface Roll20ExecutionError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type Roll20ExecutionOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: Roll20ExecutionError };

export interface Roll20ExecuteResponseMessage {
  readonly type: typeof ROLL20_EXECUTE_RESPONSE_TYPE;
  readonly requestId: string;
  readonly outcome: Roll20ExecutionOutcome;
}

export interface Roll20ExecuteCommand {
  readonly requestId: string;
  readonly code: string;
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

function encodeUtf8(value: string): number[] {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return bytes;
}

function decodeUtf8(bytes: readonly number[]): string {
  const encoded = bytes
    .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
    .join("");
  return decodeURIComponent(encoded);
}

function encodeBase64Url(value: string): string {
  const bytes = encodeUtf8(value);
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    const remaining = bytes.length - index;

    encoded += BASE64URL_ALPHABET[(combined >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(combined >>> 12) & 63];
    if (remaining > 1) encoded += BASE64URL_ALPHABET[(combined >>> 6) & 63];
    if (remaining > 2) encoded += BASE64URL_ALPHABET[combined & 63];
  }
  return encoded;
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64URL_ALPHABET.indexOf(value[index] ?? "");
    const second = BASE64URL_ALPHABET.indexOf(value[index + 1] ?? "");
    const thirdCharacter = value[index + 2];
    const fourthCharacter = value[index + 3];
    const third = thirdCharacter
      ? BASE64URL_ALPHABET.indexOf(thirdCharacter)
      : 0;
    const fourth = fourthCharacter
      ? BASE64URL_ALPHABET.indexOf(fourthCharacter)
      : 0;
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return null;

    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((combined >>> 16) & 255);
    if (index + 2 < value.length) bytes.push((combined >>> 8) & 255);
    if (index + 3 < value.length) bytes.push(combined & 255);
  }

  try {
    return decodeUtf8(bytes);
  } catch {
    return null;
  }
}

function isExecutionError(value: unknown): value is Roll20ExecutionError {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    (value.stack === undefined || typeof value.stack === "string")
  );
}

export function isRoll20ExecutionOutcome(
  value: unknown,
): value is Roll20ExecutionOutcome {
  return (
    isRecord(value) &&
    ((value.ok === true && "result" in value) ||
      (value.ok === false && isExecutionError(value.error)))
  );
}

export function isRoll20ExecuteRequestMessage(
  value: unknown,
): value is Roll20ExecuteRequestMessage {
  return (
    isRecord(value) &&
    value.type === ROLL20_EXECUTE_REQUEST_TYPE &&
    isValidRequestId(value.requestId) &&
    typeof value.code === "string" &&
    value.code.length > 0
  );
}

export function isRoll20ExecuteResponseMessage(
  value: unknown,
): value is Roll20ExecuteResponseMessage {
  return (
    isRecord(value) &&
    value.type === ROLL20_EXECUTE_RESPONSE_TYPE &&
    isValidRequestId(value.requestId) &&
    isRoll20ExecutionOutcome(value.outcome)
  );
}

export function formatRoll20ExecuteCommand(
  requestId: string,
  code: string,
): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  if (!code) throw new Error("Roll20 code cannot be empty.");
  return `${ROLL20_EXECUTE_COMMAND} ${requestId} ${encodeBase64Url(code)}`;
}

export function parseRoll20ExecuteCommand(
  content: string,
): Roll20ExecuteCommand | null {
  const parts = content.trim().split(/\s+/);
  if (
    parts.length !== 3 ||
    parts[0] !== ROLL20_EXECUTE_COMMAND ||
    !isValidRequestId(parts[1])
  ) {
    return null;
  }

  const code = decodeBase64Url(parts[2]!);
  return code ? { requestId: parts[1]!, code } : null;
}

export function formatRoll20ExecuteResponse(
  requestId: string,
  outcome: Roll20ExecutionOutcome,
): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  const serialized = JSON.stringify(outcome);
  const roundTripped: unknown = JSON.parse(serialized);
  if (!isRoll20ExecutionOutcome(roundTripped)) {
    throw new Error("The Roll20 result is not JSON-serializable.");
  }
  return `${RESPONSE_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
}

export function parseRoll20ExecuteResponseText(
  content: string,
): Roll20ExecuteResponseMessage | null {
  const pattern = new RegExp(
    `${RESPONSE_PREFIX}([a-f0-9-]{8,64}):([A-Za-z0-9_-]+)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) return null;

  const decoded = decodeBase64Url(match[2]!);
  if (!decoded) return null;

  try {
    const outcome: unknown = JSON.parse(decoded);
    if (!isRoll20ExecutionOutcome(outcome)) return null;
    return {
      type: ROLL20_EXECUTE_RESPONSE_TYPE,
      requestId: match[1]!,
      outcome,
    };
  } catch {
    return null;
  }
}
