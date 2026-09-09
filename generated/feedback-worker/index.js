// Generated from TypeScript by `pnpm feedback:build`. Do not edit directly.

// src/feedback-worker/index.ts
var index_default = {
  async fetch() {
    return Response.json(
      { error: "Feedback uploads are not enabled. Export a report instead." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
};
export {
  index_default as default
};
