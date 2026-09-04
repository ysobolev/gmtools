import {
  DEFAULT_PROFILE,
  isAssistantProfile,
  normalizeProfiles,
  type AssistantProfile,
} from "./profile-config";
import {
  openDatabase,
  requestResult,
  transactionComplete,
} from "./database";
import {
  CHATS_STORE,
  PROFILES_STORE,
} from "./indexed-db-migrations";
import { isChatRecord, type ChatNotice, type ChatRecord } from "./chat-store";
import { notifyDurableDataChanged } from "./durable-data-protocol";

const MAX_PROFILES = 50;

export async function listProfiles(): Promise<AssistantProfile[]> {
  const database = await openDatabase();
  const transaction = database.transaction(PROFILES_STORE, "readonly");
  const values: unknown[] = await requestResult(
    transaction.objectStore(PROFILES_STORE).getAll(),
  );
  await transactionComplete(transaction);
  return normalizeProfiles(values);
}

export async function getProfile(
  profileId: string,
): Promise<AssistantProfile | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(PROFILES_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(PROFILES_STORE).get(profileId),
  );
  await transactionComplete(transaction);
  return isAssistantProfile(value) ? value : undefined;
}

export async function saveProfile(
  profile: AssistantProfile,
  options: { readonly create?: boolean } = {},
): Promise<void> {
  if (!isAssistantProfile(profile)) throw new Error("The profile is invalid.");
  const database = await openDatabase();
  const transaction = database.transaction(PROFILES_STORE, "readwrite");
  const profiles = transaction.objectStore(PROFILES_STORE);
  if (options.create) {
    const count = await requestResult(profiles.count());
    if (count >= MAX_PROFILES) {
      transaction.abort();
      throw new Error(`You can create up to ${MAX_PROFILES} profiles.`);
    }
    profiles.add(profile);
  } else {
    profiles.put(profile);
  }
  await transactionComplete(transaction);
  notifyDurableDataChanged(["profiles"]);
}

export async function deleteProfile(profileId: string): Promise<void> {
  if (profileId === DEFAULT_PROFILE.id) {
    throw new Error("The General profile cannot be deleted.");
  }
  const database = await openDatabase();
  const transaction = database.transaction(
    [PROFILES_STORE, CHATS_STORE],
    "readwrite",
  );
  const profiles = transaction.objectStore(PROFILES_STORE);
  const existing: unknown = await requestResult(profiles.get(profileId));
  if (!isAssistantProfile(existing)) {
    await transactionComplete(transaction);
    return;
  }
  profiles.delete(profileId);

  const chats = transaction.objectStore(CHATS_STORE);
  const affected: unknown[] = await requestResult(
    chats.index("profileId").getAll(profileId),
  );
  const now = Date.now();
  for (const value of affected) {
    if (!isChatRecord(value)) continue;
    const notice: ChatNotice = {
      id: crypto.randomUUID(),
      kind: "profile-fallback",
      text:
        "The previous profile is no longer available. This chat now uses General.",
      createdAt: now,
    };
    chats.put({
      ...value,
      profileId: DEFAULT_PROFILE.id,
      notices: [...value.notices, notice],
      updatedAt: now,
    } satisfies ChatRecord);
  }
  await transactionComplete(transaction);
  notifyDurableDataChanged(["profiles", "chats"]);
}
