import { jsonSchema, tool, type UIMessageChunk } from "ai";
import { isGeneratedImagePart } from "./chat-images";
import {
  MAX_GENERATED_IMAGE_BYTES,
  MAX_GENERATED_IMAGES_PER_TURN,
  MAX_GENERATED_IMAGE_BYTES_PER_TURN,
  normalizeGeneratedImageChunk,
  type GeneratedImageBudget,
  type GeneratedImageToStore,
} from "./chat-image-normalization";
import type { UploadedImageReference } from "./chat-images";
import { KeyedExecutionQueue } from "./keyed-execution-queue";

export const IMAGE_GENERATION_MODEL = "openai/gpt-5-image";
const generationQueue = new KeyedExecutionQueue();
// One base64 image plus JSON framing. Bound the response before JSON parsing.
const MAX_RESPONSE_BYTES = Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 64 * 1024;

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("Image generation returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Image generation response exceeded the image size limit.");
      }
      chunks.push(new Uint8Array(value));
    }
    return JSON.parse(await new Blob(chunks).text());
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function createGenerateImageTool(options: {
  apiKey: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  budget: GeneratedImageBudget;
  persist: (image: GeneratedImageToStore) => Promise<UploadedImageReference>;
  log: (details: Record<string, unknown>) => void;
  fetch?: typeof fetch;
  onResponse?: (value: unknown, ok: boolean) => Promise<void>;
}) {
  const imageParts = new Map<string, UIMessageChunk>();
  return {
    takeImagePart(toolCallId: string): UIMessageChunk | undefined {
      const part = imageParts.get(toolCallId);
      imageParts.delete(toolCallId);
      return part;
    },
    tool: tool({
      description: "Generate one image from a self-contained visual prompt, save it in this chat, and display it in the sidebar. Returns an imageId for view_image or drop_image, not pixels. Include subject, composition, style, and requested layout in the prompt. Generate once per requested item; reuse its returned ID. Do not automatically retry failures because the generation may already have incurred a charge.",
      inputSchema: jsonSchema<{ prompt: string; aspectRatio?: string | null }>({
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 16000 },
          aspectRatio: { type: ["string", "null"], enum: ["1:1", "3:2", "2:3", null], description: "Width:height ratio. Omit or pass null for automatic sizing. Choose the supported ratio closest to the requested composition." },
        },
        required: ["prompt"],
        additionalProperties: false,
      }),
      execute: async ({ prompt, aspectRatio }, { toolCallId, abortSignal }) => {
        const signal = abortSignal ? AbortSignal.any([options.signal, abortSignal]) : options.signal;
        signal.throwIfAborted();
        const operation = generationQueue.run("images", async () => {
          signal.throwIfAborted();
          if (options.budget.imageCount >= MAX_GENERATED_IMAGES_PER_TURN || options.budget.totalBytes >= MAX_GENERATED_IMAGE_BYTES_PER_TURN) {
            throw new Error("This turn has reached its generated image limit.");
          }
          // No automatic retries: a failed response can still represent paid work.
          let response: Response;
          try {
            response = await (options.fetch ?? fetch)("https://openrouter.ai/api/v1/images", {
              method: "POST",
              headers: { ...options.headers, Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: IMAGE_GENERATION_MODEL, prompt, n: 1, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) }),
              signal,
            });
          } catch (error) {
            signal.throwIfAborted();
            throw new Error("Could not reach OpenRouter for image generation. Do not automatically retry; the request may have been processed.", { cause: error });
          }
          const payload = await readResponse(response, signal) as {
            data?: { b64_json?: string; media_type?: string }[];
            error?: { message?: string };
            usage?: unknown;
          } | null;
          await options.onResponse?.(payload, response.ok && !payload?.error);
          if (!response.ok || payload?.error) {
            const detail = typeof payload?.error?.message === "string" ? `: ${payload.error.message.slice(0, 500)}` : "";
            throw new Error(`OpenRouter image generation failed (${response.status})${detail}`);
          }
          if (!Array.isArray(payload?.data) || payload.data.length !== 1 || typeof payload.data[0]?.b64_json !== "string") {
            throw new Error("OpenRouter did not return exactly one image. Do not automatically retry.");
          }
          signal.throwIfAborted();
          const image = payload.data[0];
          const part = await normalizeGeneratedImageChunk({
            type: "file", mediaType: image.media_type ?? "image/png",
            url: `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`,
          }, options.budget, async generated => {
            signal.throwIfAborted();
            return options.persist(generated);
          });
          if (!isGeneratedImagePart(part)) throw new Error("OpenRouter returned an unsupported image format.");
          imageParts.set(toolCallId, part);
          options.log({ Model: IMAGE_GENERATION_MODEL, "Image ID": part.data.imageId, "Size (bytes)": part.data.size, Usage: payload.usage });
          return part.data;
        });
        // Stop a queued call promptly; its queued operation checks the signal
        // again before dispatch, so it cannot generate an image after Stop.
        let abort: () => void = () => undefined;
        try {
          return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason ?? new Error("Image generation aborted."));
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          })]);
        } finally {
          signal.removeEventListener("abort", abort);
        }
      },
    }),
  };
}
