import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-image-normalization.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const normalization = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("replaces generated image bytes with a deterministic pointer", async () => {
  const stored = [];
  const messages = await normalization.normalizeGeneratedImages(
    [{
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          filename: "portrait.png",
          url: "data:image/png;base64,AQID",
        },
        { type: "text", text: "Here is the portrait." },
      ],
    }],
    async (image) => {
      stored.push(image);
      return {
        imageId: image.imageId,
        filename: image.filename,
        mediaType: image.mediaType,
        size: image.bytes.byteLength,
      };
    },
  );

  assert.equal(stored.length, 1);
  assert.equal(stored[0].imageId, "generated:assistant-1:0");
  assert.deepEqual([...stored[0].bytes], [1, 2, 3]);
  assert.deepEqual(messages[0].parts, [
    { type: "text", text: "Here is the portrait." },
    {
      type: "data-generated-image",
      id: "generated:assistant-1:0",
      data: {
        imageId: "generated:assistant-1:0",
        filename: "portrait.png",
        mediaType: "image/png",
        size: 3,
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /AQID/);
});

test("preserves the original file part when image storage fails", async () => {
  const original = {
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,AQID",
    }],
  };
  const errors = [];
  const messages = await normalization.normalizeGeneratedImages(
    [original],
    async () => {
      throw new Error("quota exceeded");
    },
    (...details) => errors.push(details),
  );
  assert.deepEqual(messages, [original]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], "assistant-1");
  assert.equal(errors[0][2], 0);
});
