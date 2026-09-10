/** Small allowlisted records: no prompts, response text, keys or reasoning. */
export interface RequestDiagnostic {
  id: string;
  kind: "chat" | "image";
  callId?: string | undefined;
  sessionId: string;
  requestedModel: string;
  startedAt: number;
  finishedAt?: number;
  outcome: "started" | "streaming" | "completed" | "failed" | "aborted";
  generationIds?: string[];
  requestIds?: string[];
  model?: string;
  provider?: string;
  router?: { strategy?: string | undefined; region?: string | undefined; requested?: string | undefined; attempt?: number; endpoints?: Array<{ provider?: string | undefined; model?: string | undefined; selected?: boolean }> };
  httpStatus?: number;
  finishReason?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 300) : undefined;
}

export function routingDiagnosticFields(value: unknown): Partial<RequestDiagnostic> {
  const raw = record(value);
  const result: Partial<RequestDiagnostic> = {};
  const id = text(raw.id ?? raw.generation_id);
  if (id) result.generationIds = [id];
  const requestId = text(raw.request_id);
  if (requestId) result.requestIds = [requestId];
  const model = text(raw.model);
  if (model) result.model = model;
  const provider = text(raw.provider ?? raw.provider_name);
  if (provider) result.provider = provider;
  if (raw.openrouter_metadata && typeof raw.openrouter_metadata === "object") {
    const metadata = record(raw.openrouter_metadata);
    const available = record(metadata.endpoints).available;
    result.router = {
      strategy: text(metadata.strategy), region: text(metadata.region), requested: text(metadata.requested),
      ...(typeof metadata.attempt === "number" ? { attempt: metadata.attempt } : {}),
      ...(Array.isArray(available) ? { endpoints: available.slice(0, 50).map(entry => {
        const endpoint = record(entry);
        return { provider: text(endpoint.provider), model: text(endpoint.model), ...(typeof endpoint.selected === "boolean" ? { selected: endpoint.selected } : {}) };
      }) } : {}),
    };
  }
  return result;
}

export function responseDiagnosticFields(response: Response): Partial<RequestDiagnostic> {
  const requestIds = ["x-request-id", "x-openrouter-request-id"].map(name => response.headers.get(name)).filter((value): value is string => Boolean(value));
  return { httpStatus: response.status, ...(requestIds.length ? { requestIds } : {}) };
}

export function errorDiagnosticFields(error: unknown): Partial<RequestDiagnostic> {
  const raw = record(error);
  let body: unknown = raw.responseBody;
  if (typeof body === "string" && body.length < 65536) {
    try { body = JSON.parse(body); } catch { body = undefined; }
  }
  return { ...routingDiagnosticFields(body), ...routingDiagnosticFields(raw.data), ...routingDiagnosticFields(raw) };
}
