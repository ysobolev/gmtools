import { isAssistantProfile, type AssistantProfile } from "../profile-config";
import {
  BASE_INSTRUCTIONS,
  GENERAL_CAPABILITY_INSTRUCTIONS,
  MEMORY_INSTRUCTIONS,
  MEMORY_UNAVAILABLE_INSTRUCTIONS,
  ROLL20_INSTRUCTIONS,
  UNBOUND_ROLL20_INSTRUCTIONS,
} from "./core";
import { RULESET_INSTRUCTIONS } from "./rulesets";
import { GUIDE_INSTRUCTIONS } from "./guides";

export function buildProfileInstructions(
  profile: AssistantProfile,
  options: {
    readonly roll20Available?: boolean;
    readonly memoryAvailable?: boolean;
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
