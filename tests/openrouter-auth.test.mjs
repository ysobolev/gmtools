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
  const url = new URL(
    auth.createAuthorizationUrl(
      callback,
      challenge,
      auth.createOpenRouterKeyLabel("Chrome"),
    ),
  );

  assert.equal(url.origin + url.pathname, "https://openrouter.ai/auth");
  assert.equal(url.searchParams.get("callback_url"), callback);
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("key_label"),
    "GM Tools for VTT (Chrome)",
  );
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

test("validates a supplied key with OpenRouter and trims surrounding whitespace", async (t) => {
  const key = "sk-or-v1-supplied-test-key";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, auth.OPENROUTER_KEY_INFO_URL);
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return Response.json({ data: { label: "Beta", limit_remaining: 0 } });
  });
  assert.deepEqual(await auth.validateOpenRouterApiKey(`  ${key}\n`), {
    key, keyInfo: { label: "Beta", limitRemaining: 0 },
  });
});

test("key verification fails closed and does not echo secrets or server bodies", async (t) => {
  const key = "sk-or-v1-sensitive-test-key";
  let result;
  const mocked = t.mock.method(globalThis, "fetch", async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  for (const invalid of ["", "short", "sk-or-v1-has whitespace", "x".repeat(513)]) {
    await assert.rejects(auth.validateOpenRouterApiKey(invalid));
  }
  assert.equal(mocked.mock.callCount(), 0);
  for (result of [
    new Response(key, { status: 401 }),
    new Response(key, { status: 403 }),
    new Response(key, { status: 429 }),
    new Response(key, { status: 500 }),
    new Error(`Network failure containing ${key}`),
    Response.json({}),
    Response.json({ data: { is_management_key: true } }),
    new Response("invalid json"),
  ]) {
    await assert.rejects(auth.validateOpenRouterApiKey(key), (error) => {
      assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});
