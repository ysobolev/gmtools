import {
  createCampaignRecord,
  isCampaignRecord,
  type CampaignOverrides,
  type CampaignRecord,
} from "./campaign-config";
import { isChatRecord, type ChatRecord } from "./chat-store";
import {
  openDatabase,
  requestResult,
  transactionComplete,
} from "./database";
import { notifyDurableDataChanged } from "./durable-data-protocol";
import {
  CAMPAIGNS_STORE,
  CAMPAIGN_MEMORIES_STORE,
  CHATS_STORE,
  RUN_SNAPSHOTS_STORE,
  IMAGES_STORE,
  MESSAGES_STORE,
  PROFILES_STORE,
  ROLL20_APPROVALS_STORE,
} from "./indexed-db-migrations";
import { releaseChatSnapshots } from "./run-snapshot-store";
import { isAssistantProfile } from "./profile-config";
import { applyCampaignAttachmentNotice, isCampaignAttachmentNotice } from "./campaign-attachment-notice";

export type CampaignDeletionMode = "detach-chats" | "delete-chats";

export interface CampaignDeletionResult {
  readonly campaignId: string;
  readonly chatIds: readonly string[];
  readonly mode: CampaignDeletionMode;
}

export interface CampaignConfigurationPatch {
  readonly defaultProfileId?: string;
  readonly overrides?: Partial<CampaignOverrides>;
  readonly memoryEnabled?: boolean;
}

function withoutCampaign(chat: ChatRecord, now: number): ChatRecord {
  const {
    campaignId: _campaignId,
    campaignName: _campaignName,
    campaignModVersion: _campaignModVersion,
    ...remaining
  } = chat;
  return { ...remaining, updatedAt: now };
}

async function campaignChats(
  transaction: IDBTransaction,
  campaignId: string,
): Promise<ChatRecord[]> {
  const values: unknown[] = await requestResult(
    transaction.objectStore(CHATS_STORE).index("campaignId").getAll(campaignId),
  );
  return values.filter(isChatRecord);
}

export async function listCampaigns(): Promise<CampaignRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGNS_STORE, "readonly");
  const values: unknown[] = await requestResult(
    transaction.objectStore(CAMPAIGNS_STORE).getAll(),
  );
  await transactionComplete(transaction);
  return values
    .filter(isCampaignRecord)
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );
}

export async function getCampaign(
  campaignId: string,
): Promise<CampaignRecord | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGNS_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(CAMPAIGNS_STORE).get(campaignId),
  );
  await transactionComplete(transaction);
  return isCampaignRecord(value) ? value : undefined;
}

export async function attachChatToCampaign(
  chatId: string,
  binding: {
    readonly campaignId: string;
    readonly name: string;
    readonly modVersion: string;
  },
): Promise<ChatRecord> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGNS_STORE, CHATS_STORE, MESSAGES_STORE],
    "readwrite",
  );
  const chats = transaction.objectStore(CHATS_STORE);
  const chatValue: unknown = await requestResult(chats.get(chatId));
  if (!isChatRecord(chatValue)) {
    transaction.abort();
    throw new Error("The chat no longer exists.");
  }
  const campaigns = transaction.objectStore(CAMPAIGNS_STORE);
  const campaignValue: unknown = await requestResult(
    campaigns.get(binding.campaignId),
  );
  const now = Date.now();
  const campaign = isCampaignRecord(campaignValue)
    ? { ...campaignValue, name: binding.name, updatedAt: now }
    : createCampaignRecord(binding.campaignId, binding.name, now);
  campaigns.put(campaign);

  const messagesValue: unknown = await requestResult(
    transaction.objectStore(MESSAGES_STORE).get(chatId),
  );
  const messages: readonly unknown[] =
    typeof messagesValue === "object" && messagesValue !== null &&
    "messages" in messagesValue && Array.isArray(messagesValue.messages)
      ? messagesValue.messages
      : [];
  const empty = messages.every(isCampaignAttachmentNotice);
  transaction.objectStore(MESSAGES_STORE).put({
    chatId,
    messages: applyCampaignAttachmentNotice(messages, binding.campaignId, campaign.name),
    updatedAt: now,
  });
  const updated: ChatRecord = {
    ...chatValue,
    ...(empty ? { profileId: campaign.defaultProfileId } : {}),
    campaignId: binding.campaignId,
    campaignName: campaign.name,
    campaignModVersion: binding.modVersion,
    updatedAt: now,
  };
  chats.put(updated);

  const attached = await campaignChats(transaction, binding.campaignId);
  for (const existing of attached) {
    if (existing.id === chatId || existing.campaignName === campaign.name) {
      continue;
    }
    chats.put({ ...existing, campaignName: campaign.name, updatedAt: now });
  }
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaigns", "chats"]);
  return updated;
}

export async function updateObservedCampaignName(
  campaignId: string,
  name: string,
): Promise<boolean> {
  const normalizedName = name.trim();
  if (!normalizedName) return false;
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGNS_STORE, CHATS_STORE],
    "readwrite",
  );
  const campaigns = transaction.objectStore(CAMPAIGNS_STORE);
  const value: unknown = await requestResult(campaigns.get(campaignId));
  if (!isCampaignRecord(value) || value.name === normalizedName) {
    await transactionComplete(transaction);
    return false;
  }
  const now = Date.now();
  campaigns.put({ ...value, name: normalizedName, updatedAt: now });
  const chats = transaction.objectStore(CHATS_STORE);
  for (const chat of await campaignChats(transaction, campaignId)) {
    chats.put({ ...chat, campaignName: normalizedName, updatedAt: now });
  }
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaigns", "chats"]);
  return true;
}

export async function updateCampaignConfiguration(
  campaignId: string,
  patch: CampaignConfigurationPatch,
): Promise<CampaignRecord> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGNS_STORE, PROFILES_STORE],
    "readwrite",
  );
  const campaigns = transaction.objectStore(CAMPAIGNS_STORE);
  const campaignValue: unknown = await requestResult(campaigns.get(campaignId));
  if (!isCampaignRecord(campaignValue)) {
    transaction.abort();
    throw new Error("The campaign no longer exists.");
  }
  if (patch.defaultProfileId !== undefined) {
    const profileValue: unknown = await requestResult(
      transaction.objectStore(PROFILES_STORE).get(patch.defaultProfileId),
    );
    if (!isAssistantProfile(profileValue)) {
      transaction.abort();
      throw new Error("The selected profile no longer exists.");
    }
  }
  const updated: CampaignRecord = {
    ...campaignValue,
    ...(patch.defaultProfileId !== undefined
      ? { defaultProfileId: patch.defaultProfileId }
      : {}),
    ...(patch.overrides
      ? { overrides: { ...campaignValue.overrides, ...patch.overrides } }
      : {}),
    ...(patch.memoryEnabled !== undefined
      ? { memoryEnabled: patch.memoryEnabled }
      : {}),
    updatedAt: Date.now(),
  };
  if (!isCampaignRecord(updated)) {
    transaction.abort();
    throw new Error("The campaign settings are invalid.");
  }
  campaigns.put(updated);
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaigns"]);
  return updated;
}

export async function deleteCampaign(
  campaignId: string,
  mode: CampaignDeletionMode,
): Promise<CampaignDeletionResult> {
  const database = await openDatabase();
  const stores = mode === "delete-chats"
    ? [
        CAMPAIGNS_STORE,
        CAMPAIGN_MEMORIES_STORE,
        CHATS_STORE,
        MESSAGES_STORE,
        IMAGES_STORE,
        ROLL20_APPROVALS_STORE,
        RUN_SNAPSHOTS_STORE,
      ]
    : [CAMPAIGNS_STORE, CAMPAIGN_MEMORIES_STORE, CHATS_STORE];
  const transaction = database.transaction(stores, "readwrite");
  const chats = transaction.objectStore(CHATS_STORE);
  const affected = await campaignChats(transaction, campaignId);
  const chatIds = affected.map((chat) => chat.id);
  transaction.objectStore(CAMPAIGNS_STORE).delete(campaignId);
  const memoryStore = transaction.objectStore(CAMPAIGN_MEMORIES_STORE);
  const memoryKeys = await requestResult(
    memoryStore.index("campaignId").getAllKeys(campaignId),
  );
  for (const key of memoryKeys) memoryStore.delete(key);
  const now = Date.now();

  if (mode === "detach-chats") {
    for (const chat of affected) chats.put(withoutCampaign(chat, now));
  } else {
    for (const chat of affected) {
      chats.delete(chat.id);
      transaction.objectStore(MESSAGES_STORE).delete(chat.id);
      await releaseChatSnapshots(transaction, chat.id);
      const imageKeys = await requestResult(
        transaction.objectStore(IMAGES_STORE).index("chatId").getAllKeys(chat.id),
      );
      for (const key of imageKeys) {
        transaction.objectStore(IMAGES_STORE).delete(key);
      }
      const approvalKeys = await requestResult(
        transaction
          .objectStore(ROLL20_APPROVALS_STORE)
          .index("chatId")
          .getAllKeys(chat.id),
      );
      for (const key of approvalKeys) {
        transaction.objectStore(ROLL20_APPROVALS_STORE).delete(key);
      }
    }
  }
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaigns", "campaignMemories", "chats"]);
  return { campaignId, chatIds, mode };
}
