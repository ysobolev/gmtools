import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/openrouter-protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const protocolSource = outputFiles[0].text;
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(protocolSource).toString("base64")}`
);

test("validates credential persistence requests", () => {
  assert.equal(
    protocol.isAuthRequest({
      type: protocol.AUTH_PERSISTENCE_REQUEST,
      enabled: true,
    }),
    true,
  );
  assert.equal(
    protocol.isAuthRequest({
      type: protocol.AUTH_PERSISTENCE_REQUEST,
      enabled: "yes",
    }),
    false,
  );
});

test("requires persistence state in authentication responses", () => {
  assert.equal(
    protocol.isAuthResponse({
      ok: true,
      status: { connected: true, persistent: false },
    }),
    true,
  );
  assert.equal(
    protocol.isAuthResponse({
      ok: true,
      status: { connected: true },
    }),
    false,
  );
});
