import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/remote-image.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const remoteImage = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("downloads a supported image with a useful filename", async () => {
  const result = await remoteImage.downloadImage(
    "https://images.example/maps/chapel",
    async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
      status: 200,
    }),
  );
  assert.equal(result.filename, "chapel.png");
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.blob.size, 3);
});

test("rejects non-images and oversized responses", async () => {
  await assert.rejects(
    remoteImage.downloadImage("https://example.com/page", async () =>
      new Response("hello", {
        headers: { "content-type": "text/html" },
        status: 200,
      })),
    /supported image/,
  );
  await assert.rejects(
    remoteImage.downloadImage("https://example.com/huge.png", async () =>
      new Response(null, {
        headers: {
          "content-length": String(11 * 1024 * 1024),
          "content-type": "image/png",
        },
        status: 200,
      })),
    /10 MB or smaller/,
  );
});

test("recognizes image bytes when a server omits the MIME type", async () => {
  const result = await remoteImage.downloadImage(
    "https://images.example/map",
    async () => new Response(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      { status: 200 },
    ),
  );
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.filename, "map.png");
  assert.equal(result.blob.type, "image/png");
});

test("distinguishes network failures that may be fixed by host access", async () => {
  await assert.rejects(
    remoteImage.downloadImage("https://images.example/map.png", async () => {
      throw new TypeError("Failed to fetch");
    }),
    (error) => {
      assert.equal(error.name, "RemoteImageNetworkError");
      return true;
    },
  );
});
