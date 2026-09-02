import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/chat-images.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = outputFiles[0].text;
const images = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("creates a lightweight uploaded-image message part", () => {
  const reference = {
    imageId: "image-1",
    filename: "map.png",
    mediaType: "image/png",
    size: 1234,
  };
  const part = images.createUploadedImagePart(reference);
  assert.deepEqual(part, {
    type: "data-uploaded-image",
    id: "image-1",
    data: reference,
  });
  assert.equal(images.isUploadedImagePart(part), true);
  assert.equal(JSON.stringify(part).includes("base64"), false);
});

test("rejects unsupported or mismatched uploaded-image references", () => {
  assert.equal(images.isSupportedUploadedImageType("image/jpeg"), true);
  assert.equal(images.isSupportedUploadedImageType("image/svg+xml"), false);
  assert.equal(
    images.isUploadedImagePart({
      type: "data-uploaded-image",
      id: "different-id",
      data: {
        imageId: "image-1",
        filename: "map.png",
        mediaType: "image/png",
        size: 1234,
      },
    }),
    false,
  );
});

test("describes an attachment without embedding its bytes", () => {
  const prompt = images.uploadedImagePrompt({
    imageId: "image-1",
    filename: "map.png",
    mediaType: "image/png",
    size: 1234,
  });
  assert.match(prompt, /inspect_image/);
  assert.match(prompt, /image-1/);
  assert.doesNotMatch(prompt, /data:image/);
});
