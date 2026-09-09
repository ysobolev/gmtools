// Deliberately inert infrastructure placeholder. Upload implementation is separate.
// Do not read request bodies, log reports, or expose bucket operations yet.
export default {
  async fetch(): Promise<Response> {
    return Response.json(
      { error: "Feedback uploads are not enabled. Export a report instead." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  },
};
