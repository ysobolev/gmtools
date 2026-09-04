import {
  ROLL20_ACKNOWLEDGEMENT_TYPE,
  ROLL20_EXECUTE_RESPONSE_TYPE,
  type Roll20AcknowledgementMessage,
  type Roll20ExecuteRequestMessage,
  type Roll20ExecuteResponseMessage,
} from "../protocol";

const RESPONSE_RETENTION_MS = 5 * 60 * 1000;
const MAX_PENDING_REQUESTS = 128;

type PendingRequest = Pick<
  Roll20ExecuteRequestMessage,
  "kind" | "requestId" | "expiresAt"
>;

type Roll20Response =
  | Roll20AcknowledgementMessage
  | Roll20ExecuteResponseMessage;

export class Roll20ResponseTracker {
  private readonly pending = new Map<
    string,
    { readonly kind: PendingRequest["kind"]; readonly expiresAt: number }
  >();

  register(request: PendingRequest, now = Date.now()): void {
    this.prune(now);
    this.pending.delete(request.requestId);
    this.pending.set(request.requestId, {
      kind: request.kind,
      expiresAt: Math.max(request.expiresAt, now) + RESPONSE_RETENTION_MS,
    });
    while (this.pending.size > MAX_PENDING_REQUESTS) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== "string") break;
      this.pending.delete(oldest);
    }
  }

  forget(requestId: string): void {
    this.pending.delete(requestId);
  }

  has(requestId: string, now = Date.now()): boolean {
    this.prune(now);
    return this.pending.has(requestId);
  }

  consume(response: Roll20Response): void {
    const request = this.pending.get(response.requestId);
    if (!request) return;
    if (
      response.type === ROLL20_EXECUTE_RESPONSE_TYPE ||
      request.kind === "identify" ||
      (response.type === ROLL20_ACKNOWLEDGEMENT_TYPE && !response.accepted)
    ) {
      this.pending.delete(response.requestId);
    }
  }

  private prune(now: number): void {
    for (const [requestId, request] of this.pending) {
      if (request.expiresAt <= now) this.pending.delete(requestId);
    }
  }
}
