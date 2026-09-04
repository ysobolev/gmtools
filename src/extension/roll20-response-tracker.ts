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
    {
      acknowledged: boolean;
      readonly kind: PendingRequest["kind"];
      readonly expiresAt: number;
      responded: boolean;
      settled: boolean;
    }
  >();

  register(request: PendingRequest, now = Date.now()): void {
    this.prune(now);
    this.pending.delete(request.requestId);
    this.pending.set(request.requestId, {
      acknowledged: false,
      kind: request.kind,
      expiresAt: Math.max(request.expiresAt, now) + RESPONSE_RETENTION_MS,
      responded: false,
      settled: false,
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

  consume(response: Roll20Response): boolean {
    const request = this.pending.get(response.requestId);
    if (!request) return false;
    if (response.type === ROLL20_ACKNOWLEDGEMENT_TYPE) {
      if (request.acknowledged || request.settled) return false;
      request.acknowledged = true;
      if (request.kind === "identify" || !response.accepted) {
        request.settled = true;
      } else if (request.responded) {
        request.settled = true;
      }
    } else if (response.type === ROLL20_EXECUTE_RESPONSE_TYPE) {
      if (request.responded || request.settled) return false;
      request.responded = true;
      if (request.acknowledged) request.settled = true;
    }
    return true;
  }

  private prune(now: number): void {
    for (const [requestId, request] of this.pending) {
      if (request.expiresAt <= now) this.pending.delete(requestId);
    }
  }
}
