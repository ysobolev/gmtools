export const DURABLE_DATA_CHANGED = "GMTOOLS_DURABLE_DATA_CHANGED";

export const DURABLE_DATA_STORES = [
  "profiles",
  "chats",
  "settings",
  "campaigns",
  "campaignMemories",
] as const;
export type DurableDataStore = (typeof DURABLE_DATA_STORES)[number];

export interface DurableDataChangedMessage {
  readonly type: typeof DURABLE_DATA_CHANGED;
  readonly stores: readonly DurableDataStore[];
}

export function isDurableDataChangedMessage(
  value: unknown,
): value is DurableDataChangedMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === DURABLE_DATA_CHANGED &&
    Array.isArray(record.stores) &&
    record.stores.length > 0 &&
    record.stores.every((store) =>
      DURABLE_DATA_STORES.includes(store as DurableDataStore)
    )
  );
}

export function notifyDurableDataChanged(
  stores: readonly DurableDataStore[],
): void {
  void chrome.runtime.sendMessage({
    type: DURABLE_DATA_CHANGED,
    stores: [...new Set(stores)],
  } satisfies DurableDataChangedMessage).catch(() => undefined);
}
