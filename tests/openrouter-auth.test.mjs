import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/openrouter-auth.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const authSource = outputFiles[0].text;
const auth = await import(
  `data:text/javascript;base64,${Buffer.from(authSource).toString("base64")}`
);

test("creates the documented S256 OpenRouter authorization URL", () => {
  const callback = "https://extension-id.chromiumapp.org/openrouter";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const url = new URL(auth.createAuthorizationUrl(callback, challenge));

  assert.equal(url.origin + url.pathname, "https://openrouter.ai/auth");
  assert.equal(url.searchParams.get("callback_url"), callback);
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("derives the RFC 7636 S256 challenge", async () => {
  assert.equal(
    await auth.createS256Challenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    ),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("parses only the expected OAuth callback", () => {
  const callback = "https://extension-id.chromiumapp.org/openrouter";
  assert.equal(
    auth.parseAuthorizationCallback(`${callback}?code=one-time-code`, callback),
    "one-time-code",
  );
  assert.throws(() =>
    auth.parseAuthorizationCallback(
      "https://attacker.example/openrouter?code=stolen",
      callback,
    ),
  );
  assert.throws(() =>
    auth.parseAuthorizationCallback(`${callback}?error=access_denied`, callback),
  );
});

test("validates token and key metadata responses", () => {
  assert.deepEqual(
    auth.parseTokenResponse({ key: "sk-or-v1-a-valid-test-key", user_id: "user-1" }),
    { key: "sk-or-v1-a-valid-test-key", userId: "user-1" },
  );
  assert.throws(() => auth.parseTokenResponse({ key: "short" }));
  assert.deepEqual(
    auth.parseKeyInfoResponse({
      data: { label: "GM Tools", limit_remaining: 12.5 },
    }),
    { label: "GM Tools", limitRemaining: 12.5 },
  );
});
