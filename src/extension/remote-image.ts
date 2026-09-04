import {
  MAX_UPLOADED_IMAGE_BYTES,
  isSupportedUploadedImageType,
} from "./chat-images";

const IMAGE_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export interface DownloadedImage {
  readonly blob: Blob;
  readonly filename: string;
  readonly mediaType: string;
}

export class RemoteImageNetworkError extends Error {
  constructor() {
    super("Could not download the image from its website.");
    this.name = "RemoteImageNetworkError";
  }
}

function oversizedImageError(): Error {
  return new Error(
    `Images must be ${MAX_UPLOADED_IMAGE_BYTES / 1024 / 1024} MB or smaller.`,
  );
}

async function readBoundedResponseBlob(response: Response): Promise<Blob> {
  if (!response.body) {
    return new Blob([], {
      type: response.headers.get("content-type") ?? "",
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_UPLOADED_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw oversizedImageError();
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, {
    type: response.headers.get("content-type") ?? "",
  });
}

async function detectImageMediaType(blob: Blob): Promise<string> {
  const declared = blob.type.split(";", 1)[0]?.toLowerCase() ?? "";
  if (isSupportedUploadedImageType(declared)) return declared;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const signature = String.fromCharCode(...bytes);
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return "";
}

function filenameFromUrl(url: string, mediaType: string): string {
  let filename = "web-image";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const lastSegment = parsed.pathname.slice(
        parsed.pathname.lastIndexOf("/") + 1,
      );
      if (lastSegment) filename = decodeURIComponent(lastSegment);
    }
  } catch {
    // Data URLs and malformed response URLs use the fallback name.
  }
  filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-")
    .trim()
    .slice(0, 180) || "web-image";
  const extension = IMAGE_FILE_EXTENSIONS[mediaType] ?? "";
  if (extension && !filename.toLowerCase().endsWith(extension)) {
    filename += extension;
  }
  return filename;
}

export async function downloadImage(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<DownloadedImage> {
  let response: Response;
  try {
    response = await fetcher(url, {
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Browsers intentionally do not distinguish CORS rejection from other
    // network failures. The caller may retry after obtaining host access.
    throw new RemoteImageNetworkError();
  }
  if (!response.ok) {
    throw new Error(`The image server returned HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPLOADED_IMAGE_BYTES
  ) {
    throw oversizedImageError();
  }
  const downloadedBlob = await readBoundedResponseBlob(response);
  const mediaType = await detectImageMediaType(downloadedBlob);
  if (!isSupportedUploadedImageType(mediaType)) {
    throw new Error("The dropped URL did not return a supported image.");
  }
  if (downloadedBlob.size > MAX_UPLOADED_IMAGE_BYTES) {
    throw oversizedImageError();
  }
  const blob = downloadedBlob.type === mediaType
    ? downloadedBlob
    : new Blob([downloadedBlob], { type: mediaType });
  return {
    blob,
    filename: filenameFromUrl(response.url || url, mediaType),
    mediaType,
  };
}
