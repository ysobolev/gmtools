export const DEFAULT_MAX_STEPS = 24;
export const MIN_MAX_STEPS = 1;
export const MAX_MAX_STEPS = 64;

export function isDebugLoggingEnabled(value: unknown): boolean {
  return value === true;
}

export function isUnrestrictedWebFetchEnabled(value: unknown): boolean {
  return value === true;
}

export function isWebSearchEnabled(value: unknown): boolean {
  return value === true;
}

export function isRoll20ApprovalRequired(value: unknown): boolean {
  return value === true;
}

export function normalizeMaxSteps(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_MAX_STEPS &&
    value <= MAX_MAX_STEPS
    ? value
    : DEFAULT_MAX_STEPS;
}
