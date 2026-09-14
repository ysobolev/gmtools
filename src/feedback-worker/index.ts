import { MAX_UPLOADED_IMAGE_BYTES } from "../extension/chat-images";
import { feedbackReportSchema, type FeedbackImage } from "../feedback-schema";
import { MAX_FEEDBACK_REPORT_BYTES, MAX_FEEDBACK_IMAGES } from "../feedback-limits";

export const MAX_REPORT_BYTES = MAX_FEEDBACK_REPORT_BYTES;
const MAX_IMAGES = MAX_FEEDBACK_IMAGES;
const MAX_MISSING_REFERENCES = 20;
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
  constructor(readonly status: number, message: string, readonly category: string) {
    super(message);
  }
}

interface ReportMetrics {
  clientIp?: string;
  rayId?: string;
  durationMs?: number;
  payloadBytes?: number;
  imageCount?: number;
  hasEmail?: boolean;
  reportId?: string;
  failureCategory?: string;
}

function jsonResponse(status: number, body: unknown, extra: Record<string, string>, metrics: ReportMetrics): Response {
  // Only selected request metadata and server-defined outcomes: never log bodies,
  // email, arbitrary headers/URLs, validation details, or provider exceptions.
  const event = [400, 413, 415].includes(status) ? "feedback_validation_failed" : "feedback_response";
  console.info({ event, status, ...metrics });
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

async function readBody(request: Request, metrics: ReportMetrics): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REPORT_BYTES)) {
    throw new RequestError(413, "Reports must be 50 MiB or smaller, including encoded images.", "payload_size_limit");
  }
  if (!request.body) throw new RequestError(400, "A JSON report is required.", "missing_body");
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
      if (timedOut) throw new RequestError(408, "Report upload timed out.", "body_timeout");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REPORT_BYTES) {
        throw new RequestError(413, "Reports must be 50 MiB or smaller, including encoded images.", "payload_size_limit");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    metrics.payloadBytes = bytes;
    return chunks.join("");
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Could not read a UTF-8 JSON report.", "body_read_failure");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function invalid(message: string, category = "invalid_image"): never {
  throw new RequestError(400, message, category);
}

function validateImage(image: FeedbackImage): void {
  const data = image.data;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedSize = data.length / 4 * 3 - padding;
  if (image.size > MAX_UPLOADED_IMAGE_BYTES || decodedSize > MAX_UPLOADED_IMAGE_BYTES) {
    throw new RequestError(413, "Each image must be 10 MiB or smaller.", "image_size_limit");
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
function validateReport(value: unknown, metrics: ReportMetrics): void {
  // Reject oversized arrays before Zod allocates an issue for each bad entry.
  // Keep these upload limits out of the shared local-export schema.
  if (value !== null && typeof value === "object" && "conversation" in value) {
    const chat = value.conversation;
    if (chat !== null && typeof chat === "object") {
      if ("images" in chat && Array.isArray(chat.images) && chat.images.length > MAX_IMAGES) {
        metrics.imageCount = chat.images.length;
        throw new RequestError(413, "Reports may contain at most five images.", "image_count_limit");
      }
      for (const field of ["missingImageIds", "missingSnapshotHashes"] as const) {
        const entries = (chat as Record<string, unknown>)[field];
        if (Array.isArray(entries) && entries.length > MAX_MISSING_REFERENCES) {
          throw new RequestError(413, `Reports may contain at most 20 ${field} entries.`, "missing_reference_count_limit");
        }
      }
    }
  }
  const parsed = feedbackReportSchema.safeParse(value);
  if (!parsed.success) {
    invalid("Expected a version 1 GM Tools feedback export with nonempty feedback (at most 100,000 characters).", "invalid_schema");
  }
  const chat = parsed.data.conversation;
  metrics.imageCount = chat?.images.length ?? 0;
  metrics.hasEmail = parsed.data.email !== undefined;
  if (!chat) return;
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
    const startedAt = performance.now();
    // Cloudflare supplies these headers; do not use client-provided forwarded IPs.
    const metrics: ReportMetrics = {};
    const clientIp = request.headers.get("cf-connecting-ip");
    const rayId = request.headers.get("cf-ray");
    if (clientIp) metrics.clientIp = clientIp.slice(0, 45);
    if (rayId) metrics.rayId = rayId.slice(0, 100);
    const response = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      metrics.durationMs = Math.round(performance.now() - startedAt);
      return jsonResponse(status, body, extra, metrics);
    };
    const path = new URL(request.url).pathname;
    if (path === "/" && request.method === "GET") {
      return response(200, { service: "gmtools-feedback", uploadsEnabled: env.FEEDBACK_UPLOADS_ENABLED === "true" });
    }
    if (path !== "/feedback") {
      metrics.failureCategory = "not_found";
      return response(404, { error: "Not found." });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
      } });
    }
    if (request.method !== "POST") {
      metrics.failureCategory = "unsupported_method";
      return response(405, { error: "Use POST." }, { Allow: "POST, OPTIONS" });
    }
    if (env.FEEDBACK_UPLOADS_ENABLED !== "true") {
      metrics.failureCategory = "uploads_disabled";
      return response(503, { error: "Feedback uploads are disabled. Export a report instead." });
    }
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
        (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
      metrics.failureCategory = "unsupported_content_type";
      return response(415, { error: "Send uncompressed application/json." });
    }
    let failureCategory = "limiter_unavailable";
    try {
      // CF supplies this header. Do not trust X-Forwarded-For or a client report ID.
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const perIp = await env.FEEDBACK_RATE_LIMITER.limit({ key: ip });
      const global = perIp.success && (await env.FEEDBACK_GLOBAL_RATE_LIMITER.limit({ key: "reports" })).success;
      if (!global) {
        metrics.failureCategory = perIp.success ? "shared_rate_limit" : "ip_rate_limit";
        return response(429, { error: "Too many reports. Try again later." }, { "Retry-After": "60" });
      }
      failureCategory = "processing_failure";
      const body = await readBody(request, metrics);
      let report: unknown;
      try { report = JSON.parse(body); } catch { invalid("Invalid JSON report.", "invalid_json"); }
      validateReport(report, metrics);
      const id = crypto.randomUUID();
      const receivedAt = new Date().toISOString();
      const key = `${receivedAt.replaceAll(":", "-")}_${id}.json`;
      failureCategory = "storage_failure";
      const saved = await env.FEEDBACK_BUCKET.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        onlyIf: { etagDoesNotMatch: "*" },
      });
      if (!saved) throw new Error("Storage write did not succeed.");
      metrics.reportId = id;
      return response(201, { reportId: id, receivedAt });
    } catch (error) {
      metrics.failureCategory = error instanceof RequestError ? error.category : failureCategory;
      if (error instanceof RequestError) return response(error.status, { error: error.message });
      // Never return or log provider errors: they may contain report data or identifiers.
      return response(503, { error: "Could not store feedback. Please export it and try again later." });
    }
  },
};
