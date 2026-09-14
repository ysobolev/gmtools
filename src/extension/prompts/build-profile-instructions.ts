import { allowsImageGeneration, isAssistantProfile, type AssistantProfile } from "../profile-config";
import {
  BASE_INSTRUCTIONS,
  GENERAL_CAPABILITY_INSTRUCTIONS,
  IMAGE_GENERATION_INSTRUCTIONS,
  MEMORY_INSTRUCTIONS,
  MEMORY_UNAVAILABLE_INSTRUCTIONS,
  ROLL20_INSTRUCTIONS,
  UNBOUND_ROLL20_INSTRUCTIONS,
} from "./core";
import { RULESET_INSTRUCTIONS } from "./rulesets";
import { GUIDE_INSTRUCTIONS } from "./guides";
import roll20UiTools from "./roll20-ui-tools.md";

export function buildProfileInstructions(
  profile: AssistantProfile,
  options: {
    readonly roll20Available?: boolean;
    readonly memoryAvailable?: boolean;
    readonly roll20UiToolsAvailable?: boolean;
  } = {},
): string {
  if (!isAssistantProfile(profile)) {
    throw new Error("The assistant profile is invalid.");
  }
  return [
    BASE_INSTRUCTIONS,
    options.roll20Available === false
      ? UNBOUND_ROLL20_INSTRUCTIONS
      : ROLL20_INSTRUCTIONS,
    GENERAL_CAPABILITY_INSTRUCTIONS,
    allowsImageGeneration(profile.modelSelection)
      ? IMAGE_GENERATION_INSTRUCTIONS
      : "Image generation is unavailable with this free model selection because the image generator uses a paid model. Do not claim to generate images. You can still inspect existing images and use attached or previously generated images with available tools; ask the game master to attach artwork when needed.",
    options.roll20Available !== false && options.roll20UiToolsAvailable
      ? roll20UiTools.trim()
      : "",
    GUIDE_INSTRUCTIONS,
    options.memoryAvailable
      ? MEMORY_INSTRUCTIONS
      : MEMORY_UNAVAILABLE_INSTRUCTIONS,
    RULESET_INSTRUCTIONS[profile.rulesetId],
    profile.additionalInstructions.trim()
      ? `Additional instructions from the game master:\n${profile.additionalInstructions.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
