import { MAX_UPLOADED_IMAGE_BYTES } from "../extension/chat-images";
import { feedbackReportSchema, type FeedbackImage } from "../feedback-schema";

export const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGES = 5;
const BODY_TIMEOUT_MS = 30_000;

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  FEEDBACK_UPLOADS_ENABLED: string;
  FEEDBACK_RATE_LIMITER: RateLimiter;
  FEEDBACK_GLOBAL_RATE_LIMITER: RateLimiter;
  FEEDBACK_BUCKET: {
    put(key: string, body: string, options: {
      httpMetadata: { contentType: string };
      onlyIf: { etagDoesNotMatch: string };
    }): Promise<unknown>;
  };
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function response(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  // Only server-defined outcomes: never log bodies, email, headers, URLs, IPs,
  // validation details, or provider exceptions.
  const event = [400, 413, 415].includes(status) ? "feedback_validation_failed" : "feedback_response";
  console.info({ event, status });
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      // This is an anonymous write-only service. CORS is not authentication.
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

async function readBody(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REPORT_BYTES)) {
    throw new RequestError(413, "Reports must be 50 MiB or smaller, including encoded images.");
  }
  if (!request.body) throw new RequestError(400, "A JSON report is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, BODY_TIMEOUT_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestError(408, "Report upload timed out.");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REPORT_BYTES) {
        throw new RequestError(413, "Reports must be 50 MiB or smaller, including encoded images.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Could not read a UTF-8 JSON report.");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function invalid(message: string): never {
  throw new RequestError(400, message);
}

function validateImage(image: FeedbackImage): void {
  const data = image.data;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedSize = data.length / 4 * 3 - padding;
  if (image.size > MAX_UPLOADED_IMAGE_BYTES || decodedSize > MAX_UPLOADED_IMAGE_BYTES) {
    throw new RequestError(413, "Each image must be 10 MiB or smaller.");
  }
  if (data.length % 4 !== 0 || decodedSize !== image.size) invalid("Invalid image base64 or size.");
  // Scan without decoding the whole image or applying a large, backtracking regex.
  for (let i = 0; i < data.length - padding; i++) {
    const c = data.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
          (c >= 48 && c <= 57) || c === 43 || c === 47)) invalid("Invalid image base64.");
  }
  const head = atob(data.slice(0, Math.min(16, data.length)));
  const matches = image.mediaType === "image/png" ? head.startsWith("\x89PNG\r\n\x1a\n")
    : image.mediaType === "image/jpeg" ? head.startsWith("\xff\xd8\xff")
    : image.mediaType === "image/gif" ? /^(GIF87a|GIF89a)/.test(head)
    : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  if (!matches) invalid("Image contents do not match the declared MIME type.");
}

/** Validate the export envelope and attachments. Chat/tool/snapshot contents are
 * opaque diagnostics: stored, never executed, fetched, or rendered by this Worker. */
function validateReport(value: unknown): void {
  const parsed = feedbackReportSchema.safeParse(value);
  if (!parsed.success) {
    invalid("Expected a version 1 GM Tools feedback export with nonempty feedback (at most 100,000 characters).");
  }
  const chat = parsed.data.conversation;
  if (!chat) return;
  if (chat.images.length > MAX_IMAGES) throw new RequestError(413, "Reports may contain at most five images.");
  const ids = new Set<string>();
  for (const image of chat.images) {
    validateImage(image);
    const id = image.imageId;
    if (ids.has(id)) invalid("Duplicate image ID.");
    ids.add(id);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/" && request.method === "GET") {
      return response(200, { service: "gmtools-feedback", uploadsEnabled: env.FEEDBACK_UPLOADS_ENABLED === "true" });
    }
    if (path !== "/feedback") return response(404, { error: "Not found." });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
      } });
    }
    if (request.method !== "POST") return response(405, { error: "Use POST." }, { Allow: "POST, OPTIONS" });
    if (env.FEEDBACK_UPLOADS_ENABLED !== "true") {
      return response(503, { error: "Feedback uploads are disabled. Export a report instead." });
    }
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
        (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
      return response(415, { error: "Send uncompressed application/json." });
    }
    try {
      // CF supplies this header. Do not trust X-Forwarded-For or a client report ID.
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const perIp = await env.FEEDBACK_RATE_LIMITER.limit({ key: ip });
      const global = perIp.success && (await env.FEEDBACK_GLOBAL_RATE_LIMITER.limit({ key: "reports" })).success;
      if (!global) return response(429, { error: "Too many reports. Try again later." }, { "Retry-After": "60" });
      const body = await readBody(request);
      let report: unknown;
      try { report = JSON.parse(body); } catch { invalid("Invalid JSON report."); }
      validateReport(report);
      const id = crypto.randomUUID();
      const receivedAt = new Date().toISOString();
      const key = `${receivedAt.replaceAll(":", "-")}_${id}.json`;
      const saved = await env.FEEDBACK_BUCKET.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        onlyIf: { etagDoesNotMatch: "*" },
      });
      if (!saved) throw new Error("Storage write did not succeed.");
      return response(201, { reportId: id, receivedAt });
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { error: error.message });
      // Never return or log provider errors: they may contain report data or identifiers.
      return response(503, { error: "Could not store feedback. Please export it and try again later." });
    }
  },
};
