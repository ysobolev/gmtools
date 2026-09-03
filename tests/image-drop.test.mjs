import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/image-drop.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const imageDrop = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function transfer(values) {
  return { getData: (format) => values[format] ?? "" };
}

test("extracts Firefox and standard webpage image drag URLs", () => {
  assert.deepEqual(imageDrop.getDroppedImageUrls(transfer({
    "text/x-moz-url-data": "https://images.example/map.png",
    "text/uri-list": "https://images.example/map.png\r\n# map",
    "text/x-moz-url": "https://images.example/map.png\nCampaign map",
    "text/html": '<img alt="Map" src="https://images.example/map.png">',
  })), ["https://images.example/map.png"]);
});

test("falls back to HTML and plain URL payloads", () => {
  assert.deepEqual(imageDrop.getDroppedImageUrls(transfer({
    "text/html": "<div><img src='https://cdn.example/chapel.webp'></div>",
  })), ["https://cdn.example/chapel.webp"]);
  assert.deepEqual(imageDrop.getDroppedImageUrls(transfer({
    "text/plain": "https://cdn.example/chapel.webp",
  })), ["https://cdn.example/chapel.webp"]);
});

test("accepts image data URLs and rejects unsupported URL schemes", () => {
  assert.deepEqual(imageDrop.getDroppedImageUrls(transfer({
    "text/uri-list": "data:image/png;base64,AQID",
  })), ["data:image/png;base64,AQID"]);
  assert.deepEqual(imageDrop.getDroppedImageUrls(transfer({
    "text/uri-list": "file:///tmp/private.png\njavascript:alert(1)",
  })), []);
});

test("creates a permission pattern scoped to the image origin", () => {
  assert.equal(
    imageDrop.imageOriginPermission("https://images.example/path/map.png"),
    "https://images.example/*",
  );
  assert.equal(
    imageDrop.imageOriginPermission("http://localhost:8080/map.png"),
    "http://localhost/*",
  );
  assert.equal(
    imageDrop.imageOriginPermission("data:image/png;base64,AQID"),
    undefined,
  );
});

test("describes file and string drag payloads without copying image bytes", () => {
  const file = {
    name: "map.png",
    type: "image/png",
    size: 1234,
    lastModified: 42,
  };
  const description = imageDrop.describeImageDrop({
    dropEffect: "copy",
    effectAllowed: "copyLink",
    types: ["Files", "text/uri-list"],
    files: [file],
    items: [
      { kind: "file", type: "image/png", getAsFile: () => file },
      { kind: "string", type: "text/uri-list", getAsFile: () => null },
    ],
    getData: (format) => format === "text/uri-list"
      ? "https://images.example/map.png"
      : "",
  });

  assert.deepEqual(description, {
    dropEffect: "copy",
    effectAllowed: "copyLink",
    types: ["Files", "text/uri-list"],
    files: [{
      name: "map.png",
      type: "image/png",
      size: 1234,
      lastModified: 42,
    }],
    items: [
      {
        kind: "file",
        type: "image/png",
        file: {
          name: "map.png",
          type: "image/png",
          size: 1234,
          lastModified: 42,
        },
      },
      { kind: "string", type: "text/uri-list", file: null },
    ],
    strings: {
      "text/uri-list": {
        length: 30,
        preview: "https://images.example/map.png",
      },
    },
  });
});

test("truncates long string drag flavors in debug descriptions", () => {
  const value = `data:image/png;base64,${"A".repeat(2_000)}`;
  const description = imageDrop.describeImageDrop({
    dropEffect: "none",
    effectAllowed: "all",
    types: ["text/plain"],
    files: [],
    items: [],
    getData: () => value,
  });
  const strings = description.strings;
  assert.equal(strings["text/plain"].length, value.length);
  assert.equal(strings["text/plain"].preview.length, 1_001);
  assert.ok(strings["text/plain"].preview.endsWith("…"));
});
