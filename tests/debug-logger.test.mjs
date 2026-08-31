import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/debug-logger.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const loggerSource = outputFiles[0].text;
const { createDebugLogger } = await import(
  `data:text/javascript;base64,${Buffer.from(loggerSource).toString("base64")}`
);

function recordingConsole() {
  const calls = [];
  return {
    calls,
    groupCollapsed(...values) {
      calls.push(["groupCollapsed", ...values]);
    },
    groupEnd(...values) {
      calls.push(["groupEnd", ...values]);
    },
    log(...values) {
      calls.push(["log", ...values]);
    },
  };
}

test("does not write when debugging is disabled", () => {
  const output = recordingConsole();
  createDebugLogger(false, "chat-1", output).group("Tool call", {
    Arguments: { code: "return 1;" },
  });
  assert.deepEqual(output.calls, []);
});

test("writes a collapsed group with snapshotted details", () => {
  const output = recordingConsole();
  const details = { code: "return 1;" };
  createDebugLogger(true, "chat-1", output).group("Tool call", {
    Arguments: details,
  });
  details.code = "changed";

  assert.deepEqual(output.calls, [
    ["groupCollapsed", "[GM Tools] Tool call · chat chat-1"],
    ["log", "Arguments:", { code: "return 1;" }],
    ["groupEnd"],
  ]);
});
