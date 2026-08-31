export interface DebugLogger {
  readonly enabled: boolean;
  group(label: string, details: Record<string, unknown>): void;
}

type DebugConsole = Pick<Console, "groupCollapsed" | "groupEnd" | "log">;

function snapshot(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: snapshot(value.cause),
    };
  }
  try {
    return structuredClone(value);
  } catch {
    return String(value);
  }
}

export function createDebugLogger(
  enabled: boolean,
  chatId: string,
  output: DebugConsole = console,
): DebugLogger {
  return {
    enabled,
    group(label, details) {
      if (!enabled) return;
      output.groupCollapsed(`[GM Tools] ${label} · chat ${chatId}`);
      for (const [name, value] of Object.entries(details)) {
        output.log(`${name}:`, snapshot(value));
      }
      output.groupEnd();
    },
  };
}
