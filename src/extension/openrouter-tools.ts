import {
  createProviderDefinedToolFactory,
  jsonSchema,
} from "@ai-sdk/provider-utils";

export const WEB_FETCH_ALLOWED_DOMAINS = ["help.roll20.net"] as const;

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

interface WebSearchResult {
  readonly results?: readonly unknown[];
}

interface WebSearchToolOptions {
  readonly parameters: {
    readonly engine: "exa";
    readonly max_results: number;
    readonly max_total_results: number;
  };
}

interface ImageGenerationResult {
  readonly status?: "ok" | "error";
  readonly imageUrl?: string;
  readonly error?: string;
}

const imageGenerationToolFactory = createProviderDefinedToolFactory<
  ImageGenerationResult,
  Record<string, never>
>({
  id: "openrouter.image_generation",
  inputSchema: jsonSchema<ImageGenerationResult>({
    type: "object",
    properties: {
      status: { type: "string", enum: ["ok", "error"] },
      imageUrl: { type: "string" },
      error: { type: "string" },
    },
    additionalProperties: true,
  }),
});

const webSearchToolFactory = createProviderDefinedToolFactory<
  WebSearchResult,
  WebSearchToolOptions
>({
  id: "openrouter.web_search",
  inputSchema: jsonSchema<WebSearchResult>({
    type: "object",
    properties: {
      results: { type: "array", items: {} },
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

export function createOpenRouterWebSearchTool() {
  return webSearchToolFactory({
    parameters: {
      engine: "exa",
      max_results: 5,
      max_total_results: 10,
    },
  });
}

export function createOpenRouterImageGenerationTool() {
  return imageGenerationToolFactory({});
}
