export const UPLOADED_IMAGE_PART_TYPE = "data-uploaded-image" as const;
export const GENERATED_IMAGE_PART_TYPE = "data-generated-image" as const;
export const MAX_UPLOADED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PENDING_IMAGES = 8;

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface UploadedImageReference {
  readonly imageId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
}

export interface UploadedImagePart {
  readonly type: typeof UPLOADED_IMAGE_PART_TYPE;
  readonly id: string;
  readonly data: UploadedImageReference;
}

export interface GeneratedImagePart {
  readonly type: typeof GENERATED_IMAGE_PART_TYPE;
  readonly id: string;
  readonly data: UploadedImageReference;
}

export interface GeneratedImageData {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
}

const IMAGE_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function isSupportedUploadedImageType(mediaType: string): boolean {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType);
}

export function isUploadedImageReference(
  value: unknown,
): value is UploadedImageReference {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.imageId === "string" &&
    record.imageId.length > 0 &&
    typeof record.filename === "string" &&
    record.filename.length > 0 &&
    typeof record.mediaType === "string" &&
    isSupportedUploadedImageType(record.mediaType) &&
    typeof record.size === "number" &&
    Number.isFinite(record.size) &&
    record.size >= 0
  );
}

export function isUploadedImagePart(value: unknown): value is UploadedImagePart {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === UPLOADED_IMAGE_PART_TYPE &&
    typeof record.id === "string" &&
    isUploadedImageReference(record.data) &&
    record.id === record.data.imageId
  );
}

export function createUploadedImagePart(
  image: UploadedImageReference,
): UploadedImagePart {
  return {
    type: UPLOADED_IMAGE_PART_TYPE,
    id: image.imageId,
    data: image,
  };
}

export function isGeneratedImagePart(
  value: unknown,
): value is GeneratedImagePart {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === GENERATED_IMAGE_PART_TYPE &&
    typeof record.id === "string" &&
    isUploadedImageReference(record.data) &&
    record.id === record.data.imageId
  );
}

export function createGeneratedImagePart(
  image: UploadedImageReference,
): GeneratedImagePart {
  return {
    type: GENERATED_IMAGE_PART_TYPE,
    id: image.imageId,
    data: image,
  };
}

export function getGeneratedImageData(part: unknown): GeneratedImageData | null {
  if (typeof part !== "object" || part === null) return null;
  const record = part as Record<string, unknown>;
  if (
    record.type !== "file" ||
    typeof record.mediaType !== "string" ||
    !isSupportedUploadedImageType(record.mediaType) ||
    typeof record.url !== "string"
  ) {
    return null;
  }
  const prefix = `data:${record.mediaType};base64,`;
  if (!record.url.startsWith(prefix)) return null;
  try {
    const binary = atob(record.url.slice(prefix.length));
    const extension = IMAGE_FILE_EXTENSIONS[record.mediaType];
    const filename =
      typeof record.filename === "string" && record.filename.trim()
        ? record.filename.trim()
        : `generated-image${extension}`;
    return {
      bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      filename,
      mediaType: record.mediaType,
    };
  } catch {
    return null;
  }
}

export function uploadedImagePrompt(reference: UploadedImageReference): string {
  return `[Attached image “${reference.filename}” (${reference.mediaType}, ${reference.size} bytes). Use inspect_image with imageId “${reference.imageId}” when visual inspection is useful.]`;
}

export function imageDataPartForModel(
  part: unknown,
): { readonly type: "text"; readonly text: string } | undefined {
  if (isUploadedImagePart(part)) {
    return { type: "text", text: uploadedImagePrompt(part.data) };
  }
  return undefined;
}

export function generatedImageSystemContext(
  messages: readonly { readonly parts: readonly unknown[] }[],
): string {
  const references = new Map<string, UploadedImageReference>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (isGeneratedImagePart(part)) {
        references.set(part.data.imageId, part.data);
      }
    }
  }
  if (references.size === 0) return "";
  return [
    "The following images generated earlier in this conversation are stored locally and available through inspect_image. This is application metadata, not text previously written by the assistant:",
    ...[...references.values()].map(
      (reference) =>
        `- ${JSON.stringify(reference.filename)}: imageId ${JSON.stringify(reference.imageId)}`,
    ),
  ].join("\n");
}
