/** Diagnostic-only metadata: never converted to model content or rendered as prose. */
export const SUBMISSIONS_METADATA_KEY = "gmToolsSubmissions";

export interface SubmissionMarker {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly createdAt: number;
  readonly kind: "message" | "resume" | "retry" | "approval";
  /** The response boundary at which a continuation was requested. */
  readonly afterMessageId?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function submissionMarkers(message: unknown): SubmissionMarker[] {
  if (!record(message) || !record(message.metadata)) return [];
  const value = message.metadata[SUBMISSIONS_METADATA_KEY];
  return Array.isArray(value) ? value as SubmissionMarker[] : [];
}

/** A mounted panel may not have received worker-added metadata yet. Trust only
 * the stored markers, not the incoming panel's copy, when saving history. */
export function preserveSubmissionMetadata<T>(
  incoming: readonly T[],
  stored: readonly unknown[],
): T[] {
  const byId = new Map(stored.filter(record).map((m) => [m.id, m]));
  return incoming.map((message) => {
    if (!record(message)) return message;
    const markers = submissionMarkers(byId.get(message.id));
    if (!markers.length && (!record(message.metadata) || !(SUBMISSIONS_METADATA_KEY in message.metadata))) {
      return message;
    }
    const metadata = record(message.metadata) ? { ...message.metadata } : {};
    delete metadata[SUBMISSIONS_METADATA_KEY];
    if (markers.length) metadata[SUBMISSIONS_METADATA_KEY] = markers;
    if (Object.keys(metadata).length) return { ...message, metadata };
    const { metadata: _metadata, ...rest } = message;
    return rest as T;
  });
}
