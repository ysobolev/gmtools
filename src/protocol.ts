export const ROLL20_EXECUTE_REQUEST_TYPE = "GMTOOLS_ROLL20_EXECUTE" as const;
export const ROLL20_EXECUTE_RESPONSE_TYPE =
  "GMTOOLS_ROLL20_EXECUTE_RESPONSE" as const;
export const ROLL20_ACKNOWLEDGEMENT_TYPE =
  "GMTOOLS_ROLL20_ACKNOWLEDGEMENT" as const;
export const ROLL20_EXECUTE_COMMAND = "!gmtools-exec" as const;
export const ROLL20_PROTOCOL_VERSION = 2 as const;
export const ROLL20_MOD_VERSION = "0.2.0" as const;

const REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;
const RESPONSE_PREFIX = "GMTOOLS_EXECUTION_RESPONSE:";
const ACKNOWLEDGEMENT_PREFIX = "GMTOOLS_EXECUTION_ACKNOWLEDGED:";
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface Roll20ExecuteRequestMessage {
  readonly type: typeof ROLL20_EXECUTE_REQUEST_TYPE;
  readonly requestId: string;
  readonly kind: "identify" | "execute";
  readonly code: string;
  readonly expectedCampaignId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly extensionVersion: string;
  readonly buildId: string;
  readonly protocolVersion: number;
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
  readonly protocolVersion: number;
  readonly modVersion: string;
  readonly campaignId: string;
  readonly outcome: Roll20ExecutionOutcome;
}

export interface Roll20AcknowledgementMessage {
  readonly type: typeof ROLL20_ACKNOWLEDGEMENT_TYPE;
  readonly requestId: string;
  readonly protocolVersion: number;
  readonly modVersion: string;
  readonly campaignId: string;
  readonly isGM: boolean;
  readonly accepted: boolean;
  readonly error?: Roll20ExecutionError;
  readonly pageTitle?: string;
  readonly sandboxVersion?: Roll20SandboxVersion;
}

export type Roll20SandboxVersion = string;

export function isRoll20SandboxVersion(value: unknown): value is Roll20SandboxVersion {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export interface Roll20ExecuteCommand {
  readonly requestId: string;
  readonly protocolVersion: number;
  readonly kind: "identify" | "execute";
  readonly code: string;
  readonly expectedCampaignId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface SendAcknowledgement {
  readonly ok: boolean;
  readonly error?: string;
  readonly extensionVersion: string;
  readonly buildId: string;
  readonly protocolVersion: number;
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
    (value.kind === "identify" || value.kind === "execute") &&
    typeof value.extensionVersion === "string" &&
    typeof value.buildId === "string" &&
    typeof value.protocolVersion === "number" &&
    typeof value.code === "string" &&
    typeof value.issuedAt === "number" &&
    typeof value.expiresAt === "number" &&
    (value.expectedCampaignId === undefined ||
      typeof value.expectedCampaignId === "string") &&
    (value.kind === "identify" ||
      (value.code.length > 0 &&
        typeof value.expectedCampaignId === "string" &&
        value.expectedCampaignId.length > 0))
  );
}

export function isRoll20ExecuteResponseMessage(
  value: unknown,
): value is Roll20ExecuteResponseMessage {
  return (
    isRecord(value) &&
    value.type === ROLL20_EXECUTE_RESPONSE_TYPE &&
    isValidRequestId(value.requestId) &&
    typeof value.protocolVersion === "number" &&
    typeof value.modVersion === "string" &&
    typeof value.campaignId === "string" &&
    isRoll20ExecutionOutcome(value.outcome)
  );
}

export function isRoll20AcknowledgementMessage(
  value: unknown,
): value is Roll20AcknowledgementMessage {
  return (
    isRecord(value) &&
    value.type === ROLL20_ACKNOWLEDGEMENT_TYPE &&
    isValidRequestId(value.requestId) &&
    typeof value.protocolVersion === "number" &&
    typeof value.modVersion === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.isGM === "boolean" &&
    typeof value.accepted === "boolean" &&
    (value.error === undefined || isExecutionError(value.error)) &&
    (value.pageTitle === undefined || typeof value.pageTitle === "string") &&
    (value.sandboxVersion === undefined || isRoll20SandboxVersion(value.sandboxVersion))
  );
}

export function formatRoll20ExecuteCommand(
  requestId: string,
  code: string,
  options: {
    readonly kind?: "identify" | "execute";
    readonly expectedCampaignId?: string;
    readonly issuedAt?: number;
    readonly expiresAt?: number;
  } = {},
): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  const kind = options.kind ?? "execute";
  if (kind === "execute" && !code) throw new Error("Roll20 code cannot be empty.");
  if (kind === "execute" && !options.expectedCampaignId) {
    throw new Error("Roll20 execution requires a campaign ID.");
  }
  const issuedAt = options.issuedAt ?? Date.now();
  const expiresAt = options.expiresAt ?? issuedAt + 15_000;
  const payload = JSON.stringify({
    kind,
    code,
    issuedAt,
    expiresAt,
    ...(options.expectedCampaignId
      ? { expectedCampaignId: options.expectedCampaignId }
      : {}),
  });
  return `${ROLL20_EXECUTE_COMMAND} ${ROLL20_PROTOCOL_VERSION} ${requestId} ${encodeBase64Url(payload)}`;
}

export function parseRoll20ExecuteCommand(
  content: string,
): Roll20ExecuteCommand | null {
  const parts = content.trim().split(/\s+/);
  if (
    parts.length !== 4 ||
    parts[0] !== ROLL20_EXECUTE_COMMAND ||
    !/^\d+$/.test(parts[1] ?? "") ||
    !isValidRequestId(parts[2])
  ) {
    return null;
  }

  const decoded = decodeBase64Url(parts[3]!);
  if (!decoded) return null;
  try {
    const payload: unknown = JSON.parse(decoded);
    if (
      !isRecord(payload) ||
      (payload.kind !== "identify" && payload.kind !== "execute") ||
      typeof payload.code !== "string" ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      (payload.expectedCampaignId !== undefined &&
        typeof payload.expectedCampaignId !== "string") ||
      (payload.kind === "execute" &&
        (!payload.code ||
          typeof payload.expectedCampaignId !== "string" ||
          !payload.expectedCampaignId))
    ) {
      return null;
    }
    return {
      requestId: parts[2]!,
      protocolVersion: Number.parseInt(parts[1]!, 10),
      kind: payload.kind,
      code: payload.code,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      ...(payload.expectedCampaignId
        ? { expectedCampaignId: payload.expectedCampaignId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function formatRoll20ExecuteResponse(
  requestId: string,
  campaignId: string,
  outcome: Roll20ExecutionOutcome,
): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  const serialized = JSON.stringify({
    protocolVersion: ROLL20_PROTOCOL_VERSION,
    modVersion: ROLL20_MOD_VERSION,
    campaignId,
    outcome,
  });
  const roundTripped: unknown = JSON.parse(serialized);
  if (
    !isRecord(roundTripped) ||
    roundTripped.protocolVersion !== ROLL20_PROTOCOL_VERSION ||
    roundTripped.modVersion !== ROLL20_MOD_VERSION ||
    roundTripped.campaignId !== campaignId ||
    !isRoll20ExecutionOutcome(roundTripped.outcome)
  ) {
    throw new Error("The Roll20 result is not JSON-serializable.");
  }
  return `${RESPONSE_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
}

export function formatRoll20Acknowledgement(
  requestId: string,
  campaignId: string,
  isGM: boolean,
  accepted: boolean,
  error?: Roll20ExecutionError,
  sandboxVersion?: Roll20SandboxVersion,
): string {
  if (!isValidRequestId(requestId)) {
    throw new Error("Invalid GM Tools request ID.");
  }
  const serialized = JSON.stringify({
    protocolVersion: ROLL20_PROTOCOL_VERSION,
    modVersion: ROLL20_MOD_VERSION,
    campaignId,
    isGM,
    accepted,
    ...(error ? { error } : {}),
    ...(sandboxVersion ? { sandboxVersion } : {}),
  });
  return `${ACKNOWLEDGEMENT_PREFIX}${requestId}:${encodeBase64Url(serialized)}`;
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
    const envelope: unknown = JSON.parse(decoded);
    if (
      !isRecord(envelope) ||
      typeof envelope.protocolVersion !== "number" ||
      typeof envelope.modVersion !== "string" ||
      typeof envelope.campaignId !== "string" ||
      !isRoll20ExecutionOutcome(envelope.outcome)
    ) {
      return null;
    }
    return {
      type: ROLL20_EXECUTE_RESPONSE_TYPE,
      requestId: match[1]!,
      protocolVersion: envelope.protocolVersion,
      modVersion: envelope.modVersion,
      campaignId: envelope.campaignId,
      outcome: envelope.outcome,
    };
  } catch {
    return null;
  }
}

export function parseRoll20AcknowledgementText(
  content: string,
): Roll20AcknowledgementMessage | null {
  const pattern = new RegExp(
    `${ACKNOWLEDGEMENT_PREFIX}([a-f0-9-]{8,64}):([A-Za-z0-9_-]+)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) return null;
  const decoded = decodeBase64Url(match[2]!);
  if (!decoded) return null;
  try {
    const envelope: unknown = JSON.parse(decoded);
    const message: unknown = isRecord(envelope)
      ? {
          type: ROLL20_ACKNOWLEDGEMENT_TYPE,
          requestId: match[1]!,
          ...envelope,
        }
      : null;
    return isRoll20AcknowledgementMessage(message) ? message : null;
  } catch {
    return null;
  }
}
