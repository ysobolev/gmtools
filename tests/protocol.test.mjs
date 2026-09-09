import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("acknowledgements retain runtime identity independently of the bridge version", () => {
  for (const sandboxVersion of ["1.0", "1.5", "v1", "v1.0", "default", "experimental", undefined]) {
    const encoded = protocol.formatRoll20Acknowledgement("12345678-abcd", "campaign-test", true, true, undefined, sandboxVersion);
    const message = protocol.parseRoll20AcknowledgementText(encoded);
    assert.equal(message.sandboxVersion, sandboxVersion);
    assert.equal(message.modVersion, protocol.ROLL20_MOD_VERSION);
    for (const invalid of [1.5, null, {}, "", "x".repeat(129)]) {
      assert.equal(protocol.isRoll20AcknowledgementMessage({ ...message, sandboxVersion: invalid }), false);
    }
  }
});

test("round-trips JavaScript through the Roll20 command protocol", () => {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  const code = 'return { message: "Café 🐉", roll: randomInteger(20) };';
  const command = protocol.formatRoll20ExecuteCommand(requestId, code, {
    expectedCampaignId: "campaign-test",
    issuedAt: 1000,
    expiresAt: 11000,
  });

  assert.match(command, /^!gmtools-exec 2 [a-f0-9-]+ [A-Za-z0-9_-]+$/i);
  assert.deepEqual(protocol.parseRoll20ExecuteCommand(command), {
    requestId,
    protocolVersion: 2,
    kind: "execute",
    code,
    expectedCampaignId: "campaign-test",
    issuedAt: 1000,
    expiresAt: 11000,
  });
});

test("round-trips successful results and execution errors", () => {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  const success = { ok: true, result: { name: "Mörk", hp: 7 } };
  const failure = {
    ok: false,
    error: { name: "TypeError", message: "No token selected" },
  };

  assert.deepEqual(
    protocol.parseRoll20ExecuteResponseText(
      protocol.formatRoll20ExecuteResponse(requestId, "campaign-test", success),
    ),
    {
      type: "GMTOOLS_ROLL20_EXECUTE_RESPONSE",
      requestId,
      protocolVersion: 2,
      modVersion: "0.2.0",
      campaignId: "campaign-test",
      outcome: success,
    },
  );
  assert.deepEqual(
    protocol.parseRoll20ExecuteResponseText(
      `whisper ${protocol.formatRoll20ExecuteResponse(requestId, "campaign-test", failure)}`,
    )?.outcome,
    failure,
  );
});

test("round-trips campaign acknowledgements", () => {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  assert.deepEqual(
    protocol.parseRoll20AcknowledgementText(
      protocol.formatRoll20Acknowledgement(
        requestId,
        "campaign-test",
        true,
        true,
      ),
    ),
    {
      type: "GMTOOLS_ROLL20_ACKNOWLEDGEMENT",
      requestId,
      protocolVersion: 2,
      modVersion: "0.2.0",
      campaignId: "campaign-test",
      isGM: true,
      accepted: true,
    },
  );
});

test("rejects malformed execution protocol messages", () => {
  assert.equal(protocol.parseRoll20ExecuteCommand("!gmtools-exec nope bad"), null);
  assert.equal(
    protocol.parseRoll20ExecuteResponseText(
      "GMTOOLS_EXECUTION_RESPONSE:12345678-abcd:not-valid-json",
    ),
    null,
  );
  assert.throws(() =>
    protocol.formatRoll20ExecuteCommand("bad", "return 1;"),
  );
});

test("requires extension and protocol identity on page-bridge requests", () => {
  const request = {
    type: protocol.ROLL20_EXECUTE_REQUEST_TYPE,
    requestId: "12345678-abcd-4abc-8def-123456789abc",
    kind: "execute",
    code: "return 1;",
    expectedCampaignId: "campaign-test",
    issuedAt: 1000,
    expiresAt: 11000,
    extensionVersion: "0.2.0",
    buildId: "abcdef123456",
    protocolVersion: 2,
  };
  assert.equal(protocol.isRoll20ExecuteRequestMessage(request), true);
  assert.equal(
    protocol.isRoll20ExecuteRequestMessage({
      ...request,
      buildId: undefined,
    }),
    false,
  );
});
