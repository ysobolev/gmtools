import { openDatabase, requestResult, transactionComplete } from "./database";
import {
  CHATS_STORE,
  IMAGES_STORE,
  MESSAGES_STORE,
  RUN_SNAPSHOTS_STORE,
} from "./indexed-db-migrations";
import { submissionMarkers } from "./submission-metadata";
import type { RunSnapshot } from "./run-snapshot-store";
import type { ChatRecord, StoredChatImage } from "./chat-store";

export interface FeedbackReportOptions {
  readonly feedback: string;
  readonly includeChat: boolean;
  readonly includeImages: boolean;
  readonly chatId: string;
  readonly visibleError?: string | undefined;
  readonly runningWhenOpened: boolean;
  readonly extension: { readonly version: string; readonly buildId: string; readonly browser: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function referencedImageIds(messages: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isRecord(part)) continue;
      const reference = part.type === "data-uploaded-image" || part.type === "data-generated-image"
        ? part.data
        : part.type === "tool-view_image" ? part.output : undefined;
      if (isRecord(reference) && typeof reference.imageId === "string") ids.add(reference.imageId);
    }
  }
  return [...ids];
}

/** Older histories can contain inline file parts instead of IndexedDB pointers.
 * Image URLs/references remain useful diagnostics, but image bytes must respect
 * the checkbox even for those histories. Ordinary user prose is not redacted. */
export function omitInlineImageBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitInlineImageBytes);
  if (!isRecord(value)) return value;
  const image = typeof value.mediaType === "string" && value.mediaType.startsWith("image/");
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((image && ["data", "base64Data", "uint8ArrayData"].includes(key)) ||
      (typeof child === "string" && /^data:image\//i.test(child))) {
      result[key] = "[Image bytes omitted from feedback export]";
    } else {
      result[key] = omitInlineImageBytes(child);
    }
  }
  return result;
}

async function encodeImage(image: StoredChatImage) {
  const bytes = new Uint8Array(await image.blob.arrayBuffer());
  const chunks: string[] = [];
  // A multiple of three permits independently encoded chunks to be joined.
  const chunkSize = 3 * 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return {
    imageId: image.id,
    filename: image.filename,
    mediaType: image.mediaType,
    size: image.size,
    encoding: "base64" as const,
    data: chunks.join(""),
  };
}

/** Read only the selected chat and its referenced diagnostics in one consistent
 * transaction. Never enumerate profiles, preferences, credentials, or memories. */
export async function createFeedbackReport(options: FeedbackReportOptions) {
  const feedback = options.feedback.trim();
  if (!feedback) throw new Error("Please describe your feedback first.");
  const base = {
    format: "gmtools-feedback" as const,
    formatVersion: 1,
    reportId: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    feedback,
    extension: options.extension,
    includes: { chat: options.includeChat, images: options.includeChat && options.includeImages },
  };
  if (!options.includeChat) return base;

  const db = await openDatabase();
  const stores = [CHATS_STORE, MESSAGES_STORE, RUN_SNAPSHOTS_STORE];
  if (options.includeImages) stores.push(IMAGES_STORE);
  const transaction = db.transaction(stores, "readonly");
  const done = transactionComplete(transaction);
  void done.catch(() => undefined);
  const chat: ChatRecord | undefined = await requestResult(
    transaction.objectStore(CHATS_STORE).get(options.chatId),
  );
  if (!chat) {
    await done;
    throw new Error("This chat no longer exists. Uncheck Include this conversation to export feedback only.");
  }
  const stored = await requestResult(transaction.objectStore(MESSAGES_STORE).get(options.chatId));
  const messages: unknown[] = stored?.messages ?? [];
  const hashes = [...new Set(messages.flatMap(submissionMarkers).map((marker) => marker.snapshotHash))];
  const snapshots: Array<{ hash: string; snapshot: RunSnapshot }> = [];
  const missingSnapshotHashes: string[] = [];
  for (const hash of hashes) {
    const record = await requestResult(transaction.objectStore(RUN_SNAPSHOTS_STORE).get(hash));
    if (record?.chatIds.includes(options.chatId)) snapshots.push({ hash, snapshot: record.snapshot });
    else missingSnapshotHashes.push(hash);
  }
  const images: StoredChatImage[] = [];
  const missingImageIds: string[] = [];
  if (options.includeImages) {
    for (const id of referencedImageIds(messages)) {
      const image: StoredChatImage | undefined = await requestResult(transaction.objectStore(IMAGES_STORE).get(id));
      if (image?.chatId === options.chatId) images.push(image);
      else missingImageIds.push(id);
    }
  }
  await done;
  const report = {
    ...base,
    conversation: {
      chat,
      messages,
      snapshots,
      images: await Promise.all(images.map(encodeImage)),
      missingSnapshotHashes,
      missingImageIds,
      savedAt: stored?.updatedAt ?? null,
      historySource: "indexeddb" as const,
      runningWhenOpened: options.runningWhenOpened,
      ...(options.visibleError ? { visibleError: options.visibleError } : {}),
    },
  };
  return options.includeImages ? report : omitInlineImageBytes(report);
}

export function downloadFeedbackReport(report: unknown): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gmtools-feedback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Firefox may consume the object URL after the click handler returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
