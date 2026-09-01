import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/assistant-images.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const assistantImages = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("allows HTTPS images served by OpenRouter", () => {
  assert.equal(
    assistantImages.isOpenRouterImageUrl(
      "https://images.openrouter.ai/generated/example.png",
    ),
    true,
  );
});

test("rejects arbitrary, misleading, and non-HTTPS image URLs", () => {
  assert.equal(
    assistantImages.isOpenRouterImageUrl("https://example.com/image.png"),
    false,
  );
  assert.equal(
    assistantImages.isOpenRouterImageUrl(
      "https://images.openrouter.ai.example.com/image.png",
    ),
    false,
  );
  assert.equal(
    assistantImages.isOpenRouterImageUrl(
      "http://images.openrouter.ai/image.png",
    ),
    false,
  );
  assert.equal(assistantImages.isOpenRouterImageUrl("not a URL"), false);
});

test("allows supported base64 image file parts", () => {
  assert.equal(
    assistantImages.isDisplayableAssistantImage(
      "image/png",
      "data:image/png;base64,iVBORw0KGgo=",
    ),
    true,
  );
});

test("rejects mismatched and unsafe file parts", () => {
  assert.equal(
    assistantImages.isDisplayableAssistantImage(
      "image/png",
      "data:image/jpeg;base64,example",
    ),
    false,
  );
  assert.equal(
    assistantImages.isDisplayableAssistantImage(
      "image/svg+xml",
      "data:image/svg+xml;base64,example",
    ),
    false,
  );
  assert.equal(
    assistantImages.isDisplayableAssistantImage(
      "image/png",
      "https://example.com/image.png",
    ),
    false,
  );
});

test("extracts displayable file parts from an assistant message", () => {
  assert.deepEqual(
    assistantImages.getDisplayableAssistantImages([
      { type: "text", text: "Here it is." },
      {
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,iVBORw0KGgo=",
        filename: "barlgura.png",
      },
      {
        type: "file",
        mediaType: "application/pdf",
        url: "data:application/pdf;base64,example",
      },
    ]),
    [
      {
        filename: "barlgura.png",
        mediaType: "image/png",
        url: "data:image/png;base64,iVBORw0KGgo=",
      },
    ],
  );
});

test("builds a correctly typed file payload for dragging into Roll20", () => {
  const payload = assistantImages.getGeneratedImageDragPayload({
    filename: "Barlgura handout",
    mediaType: "image/png",
    url: "data:image/png;base64,aGVsbG8=",
  });

  assert.equal(payload?.filename, "Barlgura handout.png");
  assert.equal(payload?.mediaType, "image/png");
  assert.equal(
    payload?.downloadUrl,
    "image/png:Barlgura handout.png:data:image/png;base64,aGVsbG8=",
  );
  assert.deepEqual(payload?.bytes, new Uint8Array([104, 101, 108, 108, 111]));
});

test("does not turn remote images into synchronous drag files", () => {
  assert.equal(
    assistantImages.getGeneratedImageDragPayload({
      mediaType: "image/png",
      url: "https://images.openrouter.ai/generated/example.png",
    }),
    null,
  );
});

test("counts Markdown image positions", () => {
  assert.equal(
    assistantImages.countMarkdownImageReferences(
      "Before ![first](data:image/png;base64,abc) between ![second](https://example.com/two.png) after",
    ),
    2,
  );
  assert.equal(
    assistantImages.countMarkdownImageReferences("[ordinary link](https://example.com)"),
    0,
  );
});
