import type { UIMessageChunk } from "ai";
import { isOpenRouterImageUrl } from "./assistant-images";
import {
  createGeneratedImagePart,
  getGeneratedImageData,
  isSupportedUploadedImageType,
  MAX_PENDING_IMAGES,
  MAX_UPLOADED_IMAGE_BYTES,
  type UploadedImageReference,
} from "./chat-images";

export const MAX_GENERATED_IMAGE_BYTES = MAX_UPLOADED_IMAGE_BYTES;
export const MAX_GENERATED_IMAGES_PER_TURN = MAX_PENDING_IMAGES;
export const MAX_GENERATED_IMAGE_BYTES_PER_TURN = 40 * 1024 * 1024;

export interface GeneratedImageToStore {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly imageId: string;
  readonly mediaType: string;
}

export interface GeneratedImageBudget {
  imageCount: number;
  totalBytes: number;
}

export function createGeneratedImageBudget(): GeneratedImageBudget {
  return { imageCount: 0, totalBytes: 0 };
}

function generatedImageError(message: string, cause?: unknown): Error {
  return new Error(message, cause === undefined ? undefined : { cause });
}

function isSupportedImageFileChunk(
  chunk: UIMessageChunk,
): chunk is Extract<UIMessageChunk, { type: "file" }> {
  return (
    chunk.type === "file" &&
    isSupportedUploadedImageType(chunk.mediaType)
  );
}

export async function normalizeGeneratedImageChunk(
  chunk: UIMessageChunk,
  budget: GeneratedImageBudget,
  persist: (
    image: GeneratedImageToStore,
  ) => Promise<UploadedImageReference>,
  createImageId: () => string = () => `generated:${crypto.randomUUID()}`,
): Promise<UIMessageChunk> {
  if (!isSupportedImageFileChunk(chunk)) return chunk;
  if (budget.imageCount >= MAX_GENERATED_IMAGES_PER_TURN) {
    throw generatedImageError(
      `The model generated more than ${MAX_GENERATED_IMAGES_PER_TURN} images in one turn. The additional image was discarded.`,
    );
  }

  const generated = getGeneratedImageData(chunk, MAX_GENERATED_IMAGE_BYTES);
  if (!generated) {
    // Remote OpenRouter image URLs are already compact and do not need Blob
    // normalization. Count them toward the per-turn image limit, however.
    if (!isOpenRouterImageUrl(chunk.url)) {
      throw generatedImageError(
        "A generated image was invalid and was discarded.",
      );
    }
    budget.imageCount += 1;
    return chunk;
  }
  if (
    budget.totalBytes + generated.bytes.byteLength >
      MAX_GENERATED_IMAGE_BYTES_PER_TURN
  ) {
    throw generatedImageError(
      `Generated images exceeded the ${MAX_GENERATED_IMAGE_BYTES_PER_TURN / 1024 / 1024} MB limit for one turn. The additional image was discarded.`,
    );
  }

  let reference: UploadedImageReference;
  try {
    reference = await persist({
      bytes: generated.bytes,
      filename: generated.filename,
      imageId: createImageId(),
      mediaType: generated.mediaType,
    });
  } catch (error) {
    throw generatedImageError(
      "A generated image could not be saved and was discarded.",
      error,
    );
  }
  budget.imageCount += 1;
  budget.totalBytes += generated.bytes.byteLength;
  return createGeneratedImagePart(reference) as UIMessageChunk;
}
