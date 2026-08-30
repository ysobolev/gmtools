export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_TOKEN_URL =
  "https://openrouter.ai/api/v1/auth/keys";
export const OPENROUTER_KEY_INFO_URL = "https://openrouter.ai/api/v1/key";

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export interface OpenRouterTokenResponse {
  readonly key: string;
  readonly userId?: string;
}

export interface OpenRouterKeyInfo {
  readonly label?: string;
  readonly limitRemaining?: number | null;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createPkcePair(): Promise<PkcePair> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = encodeBase64Url(randomBytes);
  return { verifier, challenge: await createS256Challenge(verifier) };
}

export async function createS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export function createAuthorizationUrl(
  callbackUrl: string,
  challenge: string,
): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function parseAuthorizationCallback(
  redirectedUrl: string,
  expectedCallbackUrl: string,
): string {
  const redirected = new URL(redirectedUrl);
  const expected = new URL(expectedCallbackUrl);

  if (
    redirected.origin !== expected.origin ||
    redirected.pathname !== expected.pathname
  ) {
    throw new Error("OpenRouter returned an unexpected redirect URL.");
  }

  const providerError = redirected.searchParams.get("error_description") ??
    redirected.searchParams.get("error");
  if (providerError) throw new Error(providerError);

  const code = redirected.searchParams.get("code");
  if (!code) throw new Error("OpenRouter did not return an authorization code.");
  return code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseTokenResponse(value: unknown): OpenRouterTokenResponse {
  if (!isRecord(value) || typeof value.key !== "string" || value.key.length < 16) {
    throw new Error("OpenRouter returned an invalid API key response.");
  }

  return {
    key: value.key,
    ...(typeof value.user_id === "string" ? { userId: value.user_id } : {}),
  };
}

export function parseKeyInfoResponse(value: unknown): OpenRouterKeyInfo {
  if (!isRecord(value) || !isRecord(value.data)) return {};

  const { data } = value;
  const remaining = data.limit_remaining;
  return {
    ...(typeof data.label === "string" ? { label: data.label } : {}),
    ...(typeof remaining === "number" || remaining === null
      ? { limitRemaining: remaining }
      : {}),
  };
}
