import type { UIMessage } from "ai";
import {
  createGeneratedImagePart,
  getGeneratedImageData,
  type UploadedImageReference,
} from "./chat-images";

export interface GeneratedImageToStore {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly imageId: string;
  readonly mediaType: string;
}

export async function normalizeGeneratedImages(
  messages: readonly UIMessage[],
  persist: (
    image: GeneratedImageToStore,
  ) => Promise<UploadedImageReference>,
  onError?: (error: unknown, messageId: string, partIndex: number) => void,
): Promise<UIMessage[]> {
  return Promise.all(messages.map(async (message) => {
    if (message.role !== "assistant") return message;
    const retainedParts: UIMessage["parts"] = [];
    const generatedParts: UIMessage["parts"] = [];
    for (const [partIndex, part] of message.parts.entries()) {
      const generated = getGeneratedImageData(part);
      if (!generated) {
        retainedParts.push(part);
        continue;
      }
      try {
        const reference = await persist({
          bytes: generated.bytes,
          filename: generated.filename,
          imageId: `generated:${message.id}:${partIndex}`,
          mediaType: generated.mediaType,
        });
        generatedParts.push(createGeneratedImagePart(reference));
      } catch (error) {
        retainedParts.push(part);
        onError?.(error, message.id, partIndex);
      }
    }
    return generatedParts.length > 0
      ? { ...message, parts: [...retainedParts, ...generatedParts] }
      : message;
  }));
}
