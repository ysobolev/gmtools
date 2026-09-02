export const UPLOADED_IMAGE_PART_TYPE = "data-uploaded-image" as const;
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

export function uploadedImagePrompt(reference: UploadedImageReference): string {
  return `[Attached image “${reference.filename}” (${reference.mediaType}, ${reference.size} bytes). Use inspect_image with imageId “${reference.imageId}” when visual inspection is useful.]`;
}
