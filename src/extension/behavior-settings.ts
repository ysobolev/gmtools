export const DEBUG_LOGGING_STORAGE_KEY = "gmToolsDebugLoggingEnabled";
export const BACKGROUND_EXECUTION_STORAGE_KEY =
  "gmToolsBackgroundExecutionEnabled";

export function isDebugLoggingEnabled(value: unknown): boolean {
  return value === true;
}

export function isBackgroundExecutionEnabled(value: unknown): boolean {
  return value === true;
}
