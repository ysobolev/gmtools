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

const imageChunk = (bytes, mediaType = "image/png") => ({
  type: "file",
  mediaType,
  url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
});

test("stores generated image bytes before emitting a lightweight pointer", async () => {
  const stored = [];
  const budget = normalization.createGeneratedImageBudget();
  const chunk = await normalization.normalizeGeneratedImageChunk(
    imageChunk([1, 2, 3]),
    budget,
    async (image) => {
      stored.push(image);
      return {
        imageId: image.imageId,
        filename: image.filename,
        mediaType: image.mediaType,
        size: image.bytes.byteLength,
      };
    },
    () => "generated:test-image",
  );

  assert.deepEqual([...stored[0].bytes], [1, 2, 3]);
  assert.deepEqual(chunk, {
    type: "data-generated-image",
    id: "generated:test-image",
    data: {
      imageId: "generated:test-image",
      filename: "generated-image.png",
      mediaType: "image/png",
      size: 3,
    },
  });
  assert.doesNotMatch(JSON.stringify(chunk), /AQID/);
  assert.deepEqual(budget, { imageCount: 1, totalBytes: 3 });
});

test("does not retain the raw file chunk when image storage fails", async () => {
  const budget = normalization.createGeneratedImageBudget();
  await assert.rejects(
    normalization.normalizeGeneratedImageChunk(
      imageChunk([1, 2, 3]),
      budget,
      async () => {
        throw new Error("quota exceeded");
      },
    ),
    /could not be saved and was discarded/,
  );
  assert.deepEqual(budget, { imageCount: 0, totalBytes: 0 });
});

test("does not retain malformed generated image data", async () => {
  await assert.rejects(
    normalization.normalizeGeneratedImageChunk(
      {
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,not-valid-base64!",
      },
      normalization.createGeneratedImageBudget(),
      async () => assert.fail("invalid image must not be persisted"),
    ),
    /was invalid and was discarded/,
  );
});

test("rejects generated images over the per-image byte limit", async () => {
  const oversizedUrl = `data:image/png;base64,${"A".repeat(
    Math.ceil(normalization.MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 1,
  )}`;
  await assert.rejects(
    normalization.normalizeGeneratedImageChunk(
      { type: "file", mediaType: "image/png", url: oversizedUrl },
      normalization.createGeneratedImageBudget(),
      async () => assert.fail("oversized image must not be persisted"),
    ),
    /exceeded the 10 MB size limit/,
  );
});

test("limits generated image count and aggregate bytes per turn", async () => {
  const countBudget = {
    imageCount: normalization.MAX_GENERATED_IMAGES_PER_TURN,
    totalBytes: 0,
  };
  await assert.rejects(
    normalization.normalizeGeneratedImageChunk(
      imageChunk([1]),
      countBudget,
      async () => assert.fail("excess image must not be persisted"),
    ),
    /more than 8 images/,
  );

  const aggregateBudget = {
    imageCount: 1,
    totalBytes: normalization.MAX_GENERATED_IMAGE_BYTES_PER_TURN - 1,
  };
  await assert.rejects(
    normalization.normalizeGeneratedImageChunk(
      imageChunk([1, 2]),
      aggregateBudget,
      async () => assert.fail("excess image must not be persisted"),
    ),
    /exceeded the 40 MB limit/,
  );
});

test("keeps compact remote OpenRouter image chunks without downloading them", async () => {
  const budget = normalization.createGeneratedImageBudget();
  const original = {
    type: "file",
    mediaType: "image/png",
    url: "https://images.openrouter.ai/generated/example.png",
  };
  assert.equal(
    await normalization.normalizeGeneratedImageChunk(
      original,
      budget,
      async () => assert.fail("remote URL must not be persisted"),
    ),
    original,
  );
  assert.deepEqual(budget, { imageCount: 1, totalBytes: 0 });
});
