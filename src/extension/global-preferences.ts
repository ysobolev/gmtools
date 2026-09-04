import {
  DEFAULT_MAX_STEPS,
  isDebugLoggingEnabled,
  isRoll20ApprovalRequired,
  isUnrestrictedWebFetchEnabled,
  isWebSearchEnabled,
  normalizeMaxSteps,
} from "./behavior-settings";
import {
  DEFAULT_DISPLAY_THEME,
  isDisplayTheme,
  type DisplayTheme,
} from "./display-settings";

export const GLOBAL_PREFERENCES_ID = "global";

export interface GlobalPreferences {
  readonly id: typeof GLOBAL_PREFERENCES_ID;
  readonly displayTheme: DisplayTheme;
  readonly debugLoggingEnabled: boolean;
  readonly maximumSteps: number;
  readonly unrestrictedWebFetchEnabled: boolean;
  readonly webSearchEnabled: boolean;
  readonly requireRoll20Approval: boolean;
}

export const DEFAULT_GLOBAL_PREFERENCES: GlobalPreferences = {
  id: GLOBAL_PREFERENCES_ID,
  displayTheme: DEFAULT_DISPLAY_THEME,
  debugLoggingEnabled: false,
  maximumSteps: DEFAULT_MAX_STEPS,
  unrestrictedWebFetchEnabled: false,
  webSearchEnabled: false,
  requireRoll20Approval: false,
};

export function normalizeGlobalPreferences(value: unknown): GlobalPreferences {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  return {
    id: GLOBAL_PREFERENCES_ID,
    displayTheme: isDisplayTheme(record.displayTheme)
      ? record.displayTheme
      : DEFAULT_DISPLAY_THEME,
    debugLoggingEnabled: isDebugLoggingEnabled(record.debugLoggingEnabled),
    maximumSteps: normalizeMaxSteps(record.maximumSteps),
    unrestrictedWebFetchEnabled: isUnrestrictedWebFetchEnabled(
      record.unrestrictedWebFetchEnabled,
    ),
    webSearchEnabled: isWebSearchEnabled(record.webSearchEnabled),
    requireRoll20Approval: isRoll20ApprovalRequired(
      record.requireRoll20Approval,
    ),
  };
}
