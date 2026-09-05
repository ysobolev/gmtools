import { jsonSchema, tool } from "ai";

const MAX_REMOTE_IMAGE_URL_LENGTH = 4_096;
export const REMOTE_IMAGE_ALLOWED_DOMAINS = ["files.d20.io"] as const;

export interface RemoteImageViewResult {
  readonly url: string;
}

export function normalizeRemoteImageUrl(
  value: string,
  allowAnyDomain = false,
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("view_remote_image received an empty URL.");
  if (trimmed.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
    throw new Error("The remote image URL is too long.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("view_remote_image requires a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("view_remote_image only supports HTTP and HTTPS URLs.");
  }
  if (url.username || url.password) {
    throw new Error("Remote image URLs must not contain credentials.");
  }
  // Match the image extensions passed through by the OpenRouter adapter.
  // Otherwise AI SDK tries downloading during next-request preparation,
  // outside the tool's error boundary, where CORS can terminate the turn.
  if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname)) {
    throw new Error(
      "view_remote_image requires a direct image URL whose path ends in .jpg, .jpeg, .png, .gif, or .webp (query strings are allowed). Webpages and extensionless URLs are not supported. Use web_fetch for a webpage to find a direct image URL, or ask the user to attach the image.",
    );
  }
  if (
    !allowAnyDomain &&
    !REMOTE_IMAGE_ALLOWED_DOMAINS.some((domain) => url.hostname === domain)
  ) {
    throw new Error(
      "Viewing remote images from this domain requires enabling Allow web fetching from any domain under Behavior in Settings.",
    );
  }
  return url.toString();
}

export function createViewRemoteImageTool(allowAnyDomain = false) {
  return tool({
    description:
      "View the pixels of an externally hosted image without downloading it into local chat storage. Use this for direct HTTP or HTTPS image URLs when visual inspection would help.",
    inputSchema: jsonSchema<{ readonly url: string }>({
      type: "object",
      properties: {
        url: {
          type: "string",
          minLength: 1,
          maxLength: MAX_REMOTE_IMAGE_URL_LENGTH,
          description: "A direct HTTP or HTTPS image URL with a path ending in .jpg, .jpeg, .png, .gif, or .webp; query strings are allowed. Not a webpage or extensionless URL.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    }),
    execute: async ({ url }): Promise<RemoteImageViewResult> => ({
      url: normalizeRemoteImageUrl(url, allowAnyDomain),
    }),
    toModelOutput: ({ output }) => ({
      type: "content" as const,
      value: [
        {
          type: "text" as const,
          text: `Remote image: ${output.url}`,
        },
        {
          type: "file" as const,
          data: {
            type: "url" as const,
            url: new URL(output.url),
          },
          // OpenRouter uses this value to classify the URL as image input; the
          // remote server's response determines the image's actual format.
          mediaType: "image/jpeg",
        },
      ],
    }),
  });
}
