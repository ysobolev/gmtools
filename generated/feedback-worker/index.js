// Generated from TypeScript by `pnpm feedback:build`. Do not edit directly.

// src/extension/chat-images.ts
var MAX_UPLOADED_IMAGE_BYTES = 10 * 1024 * 1024;
var SUPPORTED_IMAGE_MEDIA_TYPES = /* @__PURE__ */ new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
function isSupportedUploadedImageType(mediaType) {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType);
}

// src/feedback-worker/index.ts
var MAX_REPORT_BYTES = 50 * 1024 * 1024;
var MAX_IMAGES = 5;
var MAX_FEEDBACK_LENGTH = 1e5;
var BODY_TIMEOUT_MS = 3e4;
var RequestError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function response(status, body, extra = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      // This is an anonymous write-only service. CORS is not authentication.
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ...extra
    }
  });
}
async function readBody(request) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REPORT_BYTES)) {
    throw new RequestError(413, "Reports must be 50 MiB or smaller, including encoded images.");
  }
  if (!request.body) throw new RequestError(400, "A JSON report is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => void 0);
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
    void reader.cancel().catch(() => void 0);
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Could not read a UTF-8 JSON report.");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value) {
  return typeof value === "string" && value.length > 0;
}
function invalid(message) {
  throw new RequestError(400, message);
}
function validateImage(image) {
  if (!record(image) || !string(image.imageId) || !string(image.filename) || !string(image.mediaType) || !isSupportedUploadedImageType(image.mediaType) || image.encoding !== "base64" || !string(image.data) || !Number.isInteger(image.size) || typeof image.size !== "number" || image.size <= 0) {
    invalid("Images must have an ID, filename, supported MIME type, size, and base64 data.");
  }
  const data = image.data;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedSize = data.length / 4 * 3 - padding;
  if (image.size > MAX_UPLOADED_IMAGE_BYTES || decodedSize > MAX_UPLOADED_IMAGE_BYTES) {
    throw new RequestError(413, "Each image must be 10 MiB or smaller.");
  }
  if (data.length % 4 !== 0 || decodedSize !== image.size) invalid("Invalid image base64 or size.");
  for (let i = 0; i < data.length - padding; i++) {
    const c = data.charCodeAt(i);
    if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) invalid("Invalid image base64.");
  }
  const head = atob(data.slice(0, Math.min(16, data.length)));
  const matches = image.mediaType === "image/png" ? head.startsWith("\x89PNG\r\n\n") : image.mediaType === "image/jpeg" ? head.startsWith("\xFF\xD8\xFF") : image.mediaType === "image/gif" ? /^(GIF87a|GIF89a)/.test(head) : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  if (!matches) invalid("Image contents do not match the declared MIME type.");
}
function validateReport(value) {
  if (!record(value) || value.format !== "gmtools-feedback" || value.formatVersion !== 1 || !string(value.reportId) || !string(value.exportedAt) || !Number.isFinite(Date.parse(value.exportedAt)) || !string(value.feedback) || !value.feedback.trim() || value.feedback.length > MAX_FEEDBACK_LENGTH || !record(value.extension) || !string(value.extension.version) || !string(value.extension.buildId) || !string(value.extension.browser) || !record(value.includes) || typeof value.includes.chat !== "boolean" || typeof value.includes.images !== "boolean") {
    invalid("Expected a version 1 GM Tools feedback export with nonempty feedback (at most 100,000 characters).");
  }
  if (!value.includes.chat) {
    if (value.includes.images || value.conversation !== void 0) invalid("Chat data was not opted in.");
    return;
  }
  const chat = value.conversation;
  if (!record(chat) || !record(chat.chat) || !Array.isArray(chat.messages) || !Array.isArray(chat.snapshots) || !Array.isArray(chat.images)) {
    invalid("The conversation must contain a chat, messages, snapshots, and images array.");
  }
  if (!value.includes.images && chat.images.length > 0) invalid("Images were not opted in.");
  if (chat.images.length > MAX_IMAGES) throw new RequestError(413, "Reports may contain at most five images.");
  const ids = /* @__PURE__ */ new Set();
  for (const image of chat.images) {
    validateImage(image);
    const id = image.imageId;
    if (ids.has(id)) invalid("Duplicate image ID.");
    ids.add(id);
  }
}
var index_default = {
  async fetch(request, env) {
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
        "Cache-Control": "no-store"
      } });
    }
    if (request.method !== "POST") return response(405, { error: "Use POST." }, { Allow: "POST, OPTIONS" });
    if (env.FEEDBACK_UPLOADS_ENABLED !== "true") {
      return response(503, { error: "Feedback uploads are disabled. Export a report instead." });
    }
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") {
      return response(415, { error: "Send uncompressed application/json." });
    }
    try {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const perIp = await env.FEEDBACK_RATE_LIMITER.limit({ key: ip });
      const global = perIp.success && (await env.FEEDBACK_GLOBAL_RATE_LIMITER.limit({ key: "reports" })).success;
      if (!global) return response(429, { error: "Too many reports. Try again later." }, { "Retry-After": "60" });
      const body = await readBody(request);
      let report;
      try {
        report = JSON.parse(body);
      } catch {
        invalid("Invalid JSON report.");
      }
      validateReport(report);
      const id = crypto.randomUUID();
      const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
      const key = `${receivedAt.replaceAll(":", "-")}_${id}.json`;
      const saved = await env.FEEDBACK_BUCKET.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        onlyIf: { etagDoesNotMatch: "*" }
      });
      if (!saved) throw new Error("Storage write did not succeed.");
      return response(201, { reportId: id, receivedAt });
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { error: error.message });
      return response(503, { error: "Could not store feedback. Please export it and try again later." });
    }
  }
};
export {
  MAX_REPORT_BYTES,
  index_default as default
};
