import {
  DEFAULT_GLOBAL_PREFERENCES,
  GLOBAL_PREFERENCES_ID,
  normalizeGlobalPreferences,
  type GlobalPreferences,
} from "./global-preferences";
import {
  openDatabase,
  requestResult,
  transactionComplete,
} from "./database";
import { SETTINGS_STORE } from "./indexed-db-migrations";
import { notifyDurableDataChanged } from "./durable-data-protocol";

type GlobalPreferenceChange = Partial<
  Omit<GlobalPreferences, "id">
>;

export async function getGlobalPreferences(): Promise<GlobalPreferences> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(SETTINGS_STORE).get(GLOBAL_PREFERENCES_ID),
  );
  await transactionComplete(transaction);
  return normalizeGlobalPreferences(value ?? DEFAULT_GLOBAL_PREFERENCES);
}

export async function updateGlobalPreferences(
  change: GlobalPreferenceChange,
): Promise<GlobalPreferences> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS_STORE, "readwrite");
  const settings = transaction.objectStore(SETTINGS_STORE);
  const value: unknown = await requestResult(settings.get(GLOBAL_PREFERENCES_ID));
  const updated = normalizeGlobalPreferences({
    ...normalizeGlobalPreferences(value ?? DEFAULT_GLOBAL_PREFERENCES),
    ...change,
  });
  settings.put(updated);
  await transactionComplete(transaction);
  notifyDurableDataChanged(["settings"]);
  return updated;
}
