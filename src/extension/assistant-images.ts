export function isOpenRouterImageUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "images.openrouter.ai";
  } catch {
    return false;
  }
}

const DISPLAYABLE_IMAGE_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isDisplayableAssistantImage(
  mediaType: unknown,
  url: unknown,
): url is string {
  if (
    typeof mediaType !== "string" ||
    !DISPLAYABLE_IMAGE_MEDIA_TYPES.has(mediaType) ||
    typeof url !== "string"
  ) {
    return false;
  }
  return (
    isOpenRouterImageUrl(url) ||
    url.startsWith(`data:${mediaType};base64,`)
  );
}

export interface DisplayableAssistantImage {
  readonly filename?: string;
  readonly mediaType: string;
  readonly url: string;
}

export function getDisplayableAssistantImages(
  parts: readonly unknown[],
): DisplayableAssistantImage[] {
  return parts.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];
    const record = part as Record<string, unknown>;
    if (
      record.type !== "file" ||
      !isDisplayableAssistantImage(record.mediaType, record.url)
    ) {
      return [];
    }
    return [{
      url: record.url,
      mediaType: record.mediaType as string,
      ...(typeof record.filename === "string"
        ? { filename: record.filename }
        : {}),
    }];
  });
}

const IMAGE_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export interface GeneratedImageDragPayload {
  readonly bytes: Uint8Array;
  readonly downloadUrl: string;
  readonly filename: string;
  readonly mediaType: string;
}

export function getGeneratedImageDragPayload(
  image: DisplayableAssistantImage,
): GeneratedImageDragPayload | null {
  const prefix = `data:${image.mediaType};base64,`;
  if (!image.url.startsWith(prefix)) return null;
  try {
    const binary = atob(image.url.slice(prefix.length));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const extension = IMAGE_FILE_EXTENSIONS[image.mediaType];
    if (!extension) return null;
    let filename = image.filename?.trim() || `generated-image${extension}`;
    filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
    if (!filename.toLowerCase().endsWith(extension)) filename += extension;
    return {
      bytes,
      downloadUrl: `${image.mediaType}:${filename}:${image.url}`,
      filename,
      mediaType: image.mediaType,
    };
  } catch {
    return null;
  }
}

export function countMarkdownImageReferences(markdown: string): number {
  return [...markdown.matchAll(/!\[[^\]\n]*\]\((?:\\.|[^)\n])*\)/g)].length;
}
