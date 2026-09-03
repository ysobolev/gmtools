export interface StringDataTransfer {
  getData(format: string): string;
}

const MAX_DEBUG_VALUE_LENGTH = 1_000;

function debugValue(value: string): { length: number; preview: string } {
  if (value.length <= MAX_DEBUG_VALUE_LENGTH) {
    return { length: value.length, preview: value };
  }
  return {
    length: value.length,
    preview: `${value.slice(0, MAX_DEBUG_VALUE_LENGTH)}…`,
  };
}

/**
 * Copies the readable portion of a drag payload while the drop event still has
 * access to its protected data store. Image bytes are represented by metadata;
 * long string flavors (especially data URLs and HTML) are truncated.
 */
export function describeImageDrop(transfer: DataTransfer): Record<string, unknown> {
  const types = [...transfer.types];
  const files = [...transfer.files].map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
  }));
  const items = [...transfer.items].map((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return {
      kind: item.kind,
      type: item.type,
      file: file
        ? {
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
        }
        : null,
    };
  });
  const strings: Record<string, { length: number; preview: string }> = {};
  for (const type of types) {
    if (type.toLowerCase() === "files") continue;
    try {
      strings[type] = debugValue(transfer.getData(type));
    } catch (error) {
      strings[type] = {
        length: 0,
        preview: `[unreadable: ${error instanceof Error ? error.message : String(error)}]`,
      };
    }
  }
  return {
    dropEffect: transfer.dropEffect,
    effectAllowed: transfer.effectAllowed,
    types,
    files,
    items,
    strings,
  };
}

function imageUrl(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) return;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
    if (url.protocol === "data:" && url.href.startsWith("data:image/")) {
      return url.href;
    }
  } catch {
    // Drag payloads frequently contain labels alongside the URL.
  }
}

function uriList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"));
}

function imageSourcesFromHtml(value: string): string[] {
  return [...value.matchAll(
    /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
  )].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

export function getDroppedImageUrls(transfer: StringDataTransfer): string[] {
  const candidateGroups = [
    [transfer.getData("text/x-moz-url-data")],
    imageSourcesFromHtml(transfer.getData("text/html")),
    uriList(transfer.getData("text/uri-list")),
    [transfer.getData("text/x-moz-url").split(/\r?\n/, 1)[0] ?? ""],
    [transfer.getData("text/plain")],
  ];
  for (const candidates of candidateGroups) {
    const urls = new Set<string>();
    for (const candidate of candidates) {
      const url = imageUrl(candidate);
      if (url) urls.add(url);
    }
    if (urls.size > 0) return [...urls];
  }
  return [];
}

export function imageOriginPermission(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
