import { jsonSchema, tool } from "ai";
import { GUIDE_CATALOG, readGuide } from "./prompts/guides";

export function createReadGuideTool() {
  return tool({
    description: `Read bundled, read-only sheet guidance. Available guides: ${GUIDE_CATALOG.map(({ id, description }) => `${id}: ${description}`).join("; ")}`,
    inputSchema: jsonSchema<{ guideId: string }>({
      type: "object",
      properties: {
        guideId: { type: "string", minLength: 1, description: "Exact guide ID from the catalog." },
      },
      required: ["guideId"],
      additionalProperties: false,
    }),
    execute: async ({ guideId }) => readGuide(guideId),
  });
}
