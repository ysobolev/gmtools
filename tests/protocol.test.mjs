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
const protocolSource = outputFiles[0].text;
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(protocolSource).toString("base64")}`
);

test("formats and parses the random-number protocol", () => {
  const requestId = "12345678-abcd-4abc-8def-123456789abc";
  assert.equal(
    protocol.formatRandomCommand(requestId),
    `!gmtools-poc ${requestId}`,
  );
  assert.equal(
    protocol.parseRandomCommand(`!gmtools-poc ${requestId}`),
    requestId,
  );

  const wireResponse = protocol.formatRandomResponse(requestId, 42);
  assert.deepEqual(protocol.parseRandomResponseText(wireResponse), {
    type: "GMTOOLS_RANDOM_RESPONSE",
    requestId,
    value: 42,
  });
});

test("rejects malformed and out-of-range protocol values", () => {
  assert.equal(protocol.parseRandomCommand("!gmtools-poc nope"), null);
  assert.equal(
    protocol.parseRandomResponseText("GMTOOLS_RESPONSE:12345678-abcd:101"),
    null,
  );
  assert.throws(() => protocol.formatRandomResponse("12345678-abcd", 0));
});
