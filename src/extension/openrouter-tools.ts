import {
  createProviderDefinedToolFactory,
  jsonSchema,
} from "@ai-sdk/provider-utils";

export const WEB_FETCH_ALLOWED_DOMAINS = [
  "help.roll20.net",
] as const;

interface WebFetchResult {
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
  readonly status?: "completed" | "failed";
  readonly retrieved_at?: string;
  readonly error?: string;
}

interface WebFetchToolOptions {
  readonly parameters: {
    readonly engine: "exa";
    readonly allowed_domains?: readonly string[];
  };
}

const webFetchToolFactory = createProviderDefinedToolFactory<
  WebFetchResult,
  WebFetchToolOptions
>({
  id: "openrouter.web_fetch",
  inputSchema: jsonSchema<WebFetchResult>({
    type: "object",
    properties: {
      url: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      retrieved_at: { type: "string" },
      error: { type: "string" },
    },
    additionalProperties: true,
  }),
});

export function createOpenRouterWebFetchTool(allowAnyDomain = false) {
  return webFetchToolFactory({
    parameters: {
      engine: "exa",
      ...(allowAnyDomain
        ? {}
        : { allowed_domains: [...WEB_FETCH_ALLOWED_DOMAINS] }),
    },
  });
}
