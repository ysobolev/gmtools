import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/durable-data-protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const protocol = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("recognizes bounded durable-data invalidation messages", () => {
  assert.equal(
    protocol.isDurableDataChangedMessage({
      type: protocol.DURABLE_DATA_CHANGED,
      stores: ["profiles", "chats"],
    }),
    true,
  );
  assert.equal(
    protocol.isDurableDataChangedMessage({
      type: protocol.DURABLE_DATA_CHANGED,
      stores: ["credentials"],
    }),
    false,
  );
  assert.equal(
    protocol.isDurableDataChangedMessage({
      type: protocol.DURABLE_DATA_CHANGED,
      stores: [],
    }),
    false,
  );
});
