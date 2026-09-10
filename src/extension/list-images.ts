import { jsonSchema, tool } from "ai";
import { getChatImage } from "./chat-store";
import { isGeneratedImagePart, isUploadedImagePart } from "./chat-images";

// The model response can finish before its UI file chunks finish saving.
// Count both sides so client tools can wait without changing image IDs or
// persisting the same file a second time.
export class ImageStorageBarrier {
  private expected = 0;
  private processed = 0;
  private failure: unknown;
  private readonly listeners = new Set<() => void>();

  expect(count: number): void { this.expected += count; }
  complete(): void {
    this.processed += 1;
    for (const listener of this.listeners) listener();
  }
  fail(error: unknown): void {
    this.failure = error ?? new Error("Image processing failed.");
    for (const listener of this.listeners) listener();
  }
  wait(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        if (!signal?.aborted && !this.failure && this.processed < this.expected) return;
        this.listeners.delete(finish);
        signal?.removeEventListener("abort", finish);
        if (signal?.aborted) reject(signal.reason ?? new Error("Image lookup aborted."));
        else if (this.failure) reject(this.failure);
        else resolve();
      };
      this.listeners.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      finish();
    });
  }
}

export function createListImagesTool(options: {
  chatId: string;
  historyParts: () => readonly unknown[];
  currentTurnParts: () => readonly unknown[];
  waitForImages: (signal?: AbortSignal) => Promise<void>;
}) {
  return tool({
    description: "List stored images referenced in this chat, newest first, including images just generated in this turn. Call after image generation to obtain the exact local imageId before view_image or drop_image; generation itself does not return our local IDs. Returns metadata, not pixels. Do not generate another image just because its ID was not supplied. Use view_image if you need to distinguish images visually.",
    inputSchema: jsonSchema<{ limit?: number | null; offset?: number | null }>({
      type: "object",
      properties: {
        limit: { type: ["integer", "null"], minimum: 1, maximum: 100, description: "Maximum images to return; omit or pass null for 20." },
        offset: { type: ["integer", "null"], minimum: 0, description: "Pagination offset; omit or pass null for 0." },
      },
      additionalProperties: false,
    }),
    execute: async ({ limit, offset }, { abortSignal }) => {
      await options.waitForImages(abortSignal);
      abortSignal?.throwIfAborted();
      const references = new Map<string, { source: "generated" | "uploaded"; generatedThisTurn: boolean }>();
      const collect = (parts: readonly unknown[], current: boolean): void => {
        for (const part of parts) {
          if (!isGeneratedImagePart(part) && !isUploadedImagePart(part)) continue;
          const generated = isGeneratedImagePart(part);
          references.set(part.data.imageId, { source: generated ? "generated" : "uploaded", generatedThisTurn: current && generated });
        }
      };
      // Only submitted/history images, not unsent composer attachments.
      collect(options.historyParts(), false);
      collect(options.currentTurnParts(), true);
      const images = [];
      for (const [imageId, reference] of references) {
        abortSignal?.throwIfAborted();
        const stored = await getChatImage(options.chatId, imageId);
        if (!stored) continue;
        images.push({ imageId, filename: stored.filename, mediaType: stored.mediaType, size: stored.size, createdAt: stored.createdAt, ...reference });
      }
      // Reverse insertion order breaks timestamp ties in favor of newer chunks.
      images.reverse().sort((a, b) => b.createdAt - a.createdAt);
      const start = offset ?? 0;
      const page = images.slice(start, start + (limit ?? 20));
      return { images: page, total: images.length, nextOffset: start + page.length < images.length ? start + page.length : null };
    },
  });
}
