import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/keyed-execution-queue.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const { KeyedExecutionQueue } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("serializes operations for the same campaign", async () => {
  const queue = new KeyedExecutionQueue();
  const gate = deferred();
  const events = [];
  const first = queue.run("campaign-a", async () => {
    events.push("first-start");
    await gate.promise;
    events.push("first-end");
  });
  const second = queue.run("campaign-a", async () => {
    events.push("second-start");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  assert.equal(queue.hasPending("campaign-a"), true);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
  await Promise.resolve();
  assert.equal(queue.hasPending("campaign-a"), false);
});

test("allows different campaigns to execute independently", async () => {
  const queue = new KeyedExecutionQueue();
  const gate = deferred();
  const events = [];
  const first = queue.run("campaign-a", async () => {
    events.push("a-start");
    await gate.promise;
  });
  const second = queue.run("campaign-b", async () => {
    events.push("b-start");
  });

  await second;
  assert.deepEqual(events, ["a-start", "b-start"]);
  gate.resolve();
  await first;
});

test("continues a campaign queue after a rejected operation", async () => {
  const queue = new KeyedExecutionQueue();
  const events = [];
  const first = queue.run("campaign-a", async () => {
    events.push("failed");
    throw new Error("failure");
  });
  const second = queue.run("campaign-a", async () => {
    events.push("recovered");
  });

  await assert.rejects(first, /failure/);
  await second;
  assert.deepEqual(events, ["failed", "recovered"]);
});
