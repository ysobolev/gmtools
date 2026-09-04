import {
  openDatabase,
  requestResult,
  transactionComplete,
} from "./database";
import { notifyDurableDataChanged } from "./durable-data-protocol";
import {
  CAMPAIGN_MEMORIES_STORE,
  CAMPAIGNS_STORE,
} from "./indexed-db-migrations";
import { isCampaignRecord } from "./campaign-config";

export const MAX_CAMPAIGN_MEMORY_CONTENT_LENGTH = 4_000;
export const MAX_CAMPAIGN_MEMORY_QUERY_LENGTH = 500;
export const DEFAULT_CAMPAIGN_MEMORY_SEARCH_LIMIT = 5;
export const MAX_CAMPAIGN_MEMORY_SEARCH_LIMIT = 20;

export interface CampaignMemoryRecord {
  readonly id: string;
  readonly campaignId: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCampaignMemoryRecord(
  value: unknown,
): value is CampaignMemoryRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.campaignId === "string" &&
    value.campaignId.length > 0 &&
    typeof value.content === "string" &&
    value.content.trim().length > 0 &&
    value.content.length <= MAX_CAMPAIGN_MEMORY_CONTENT_LENGTH &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

function normalizeContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error("Memory content cannot be blank.");
  if (normalized.length > MAX_CAMPAIGN_MEMORY_CONTENT_LENGTH) {
    throw new Error(
      `Memory content cannot exceed ${MAX_CAMPAIGN_MEMORY_CONTENT_LENGTH} characters.`,
    );
  }
  return normalized;
}

function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

async function campaignRecords(
  transaction: IDBTransaction,
  campaignId: string,
): Promise<CampaignMemoryRecord[]> {
  const values: unknown[] = await requestResult(
    transaction
      .objectStore(CAMPAIGN_MEMORIES_STORE)
      .index("campaignId")
      .getAll(campaignId),
  );
  return values.filter(isCampaignMemoryRecord);
}

async function requireMemoryEnabled(
  transaction: IDBTransaction,
  campaignId: string,
): Promise<void> {
  const campaign: unknown = await requestResult(
    transaction.objectStore(CAMPAIGNS_STORE).get(campaignId),
  );
  if (!isCampaignRecord(campaign)) {
    throw new Error("The campaign no longer exists.");
  }
  if (!campaign.memoryEnabled) {
    throw new Error("Memory is disabled for this campaign.");
  }
}

export async function isCampaignMemoryEnabled(
  campaignId: string,
): Promise<boolean> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGNS_STORE, "readonly");
  const campaign: unknown = await requestResult(
    transaction.objectStore(CAMPAIGNS_STORE).get(campaignId),
  );
  await transactionComplete(transaction);
  return isCampaignRecord(campaign) && campaign.memoryEnabled;
}

export async function listCampaignMemories(
  campaignId: string,
): Promise<CampaignMemoryRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGN_MEMORIES_STORE, "readonly");
  const records = await campaignRecords(transaction, campaignId);
  await transactionComplete(transaction);
  return records.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function countCampaignMemories(
  campaignId: string,
): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGN_MEMORIES_STORE, "readonly");
  const count = await requestResult(
    transaction
      .objectStore(CAMPAIGN_MEMORIES_STORE)
      .index("campaignId")
      .count(campaignId),
  );
  await transactionComplete(transaction);
  return count;
}

export async function createCampaignMemory(
  campaignId: string,
  content: string,
): Promise<{ readonly memory: CampaignMemoryRecord; readonly created: boolean }> {
  const normalized = normalizeContent(content);
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGN_MEMORIES_STORE, CAMPAIGNS_STORE],
    "readwrite",
  );
  await requireMemoryEnabled(transaction, campaignId);
  const existing = (await campaignRecords(transaction, campaignId)).find(
    (record) =>
      normalizeForComparison(record.content) === normalizeForComparison(normalized),
  );
  if (existing) {
    await transactionComplete(transaction);
    return { memory: existing, created: false };
  }
  const now = Date.now();
  const memory: CampaignMemoryRecord = {
    id: crypto.randomUUID(),
    campaignId,
    content: normalized,
    createdAt: now,
    updatedAt: now,
  };
  transaction.objectStore(CAMPAIGN_MEMORIES_STORE).add(memory);
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaignMemories"]);
  return { memory, created: true };
}

export async function updateCampaignMemory(
  campaignId: string,
  memoryId: string,
  content: string,
  requireEnabled = true,
): Promise<CampaignMemoryRecord> {
  const normalized = normalizeContent(content);
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGN_MEMORIES_STORE, CAMPAIGNS_STORE],
    "readwrite",
  );
  if (requireEnabled) await requireMemoryEnabled(transaction, campaignId);
  const store = transaction.objectStore(CAMPAIGN_MEMORIES_STORE);
  const value: unknown = await requestResult(store.get(memoryId));
  if (!isCampaignMemoryRecord(value) || value.campaignId !== campaignId) {
    transaction.abort();
    throw new Error("The memory was not found in this campaign.");
  }
  const updated = { ...value, content: normalized, updatedAt: Date.now() };
  store.put(updated);
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaignMemories"]);
  return updated;
}

export async function deleteCampaignMemory(
  campaignId: string,
  memoryId: string,
  requireEnabled = true,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGN_MEMORIES_STORE, CAMPAIGNS_STORE],
    "readwrite",
  );
  if (requireEnabled) await requireMemoryEnabled(transaction, campaignId);
  const store = transaction.objectStore(CAMPAIGN_MEMORIES_STORE);
  const value: unknown = await requestResult(store.get(memoryId));
  if (!isCampaignMemoryRecord(value) || value.campaignId !== campaignId) {
    transaction.abort();
    throw new Error("The memory was not found in this campaign.");
  }
  store.delete(memoryId);
  await transactionComplete(transaction);
  notifyDurableDataChanged(["campaignMemories"]);
}

function queryTokens(value: string): string[] {
  const stopWords = new Set([
    "a", "an", "and", "are", "at", "be", "for", "from", "has", "have",
    "how", "in", "is", "it", "of", "on", "or", "that", "the", "to",
    "was", "were", "what", "when", "where", "which", "who", "why", "with",
  ]);
  return [...new Set(
    normalizeForComparison(value).match(/[\p{L}\p{N}_'-]+/gu) ?? [],
  )].filter((token) => !stopWords.has(token));
}

function memoryScore(content: string, query: string, tokens: readonly string[]): number {
  const normalized = normalizeForComparison(content);
  let score = normalized.includes(query) ? 100 : 0;
  for (const token of tokens) {
    let index = 0;
    let matches = 0;
    while ((index = normalized.indexOf(token, index)) !== -1) {
      matches += 1;
      index += token.length;
    }
    if (matches) score += 10 + Math.min(matches, 5);
  }
  if (tokens.length > 0 && tokens.every((token) => normalized.includes(token))) {
    score += 25;
  }
  return score;
}

export async function searchCampaignMemories(
  campaignId: string,
  query: string,
  limit = DEFAULT_CAMPAIGN_MEMORY_SEARCH_LIMIT,
): Promise<CampaignMemoryRecord[]> {
  const normalizedQuery = normalizeForComparison(query);
  if (!normalizedQuery) throw new Error("Memory search query cannot be blank.");
  if (query.length > MAX_CAMPAIGN_MEMORY_QUERY_LENGTH) {
    throw new Error(
      `Memory search query cannot exceed ${MAX_CAMPAIGN_MEMORY_QUERY_LENGTH} characters.`,
    );
  }
  const requestedLimit = Number.isFinite(limit)
    ? Math.trunc(limit)
    : DEFAULT_CAMPAIGN_MEMORY_SEARCH_LIMIT;
  const boundedLimit = Math.min(
    MAX_CAMPAIGN_MEMORY_SEARCH_LIMIT,
    Math.max(1, requestedLimit),
  );
  const database = await openDatabase();
  const transaction = database.transaction(
    [CAMPAIGN_MEMORIES_STORE, CAMPAIGNS_STORE],
    "readonly",
  );
  await requireMemoryEnabled(transaction, campaignId);
  const tokens = queryTokens(normalizedQuery);
  const records = await campaignRecords(transaction, campaignId);
  await transactionComplete(transaction);
  return records
    .map((memory) => ({
      memory,
      score: memoryScore(memory.content, normalizedQuery, tokens),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score || right.memory.updatedAt - left.memory.updatedAt
    )
    .slice(0, boundedLimit)
    .map(({ memory }) => memory);
}

export async function deleteAllCampaignMemories(
  campaignId: string,
): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction(CAMPAIGN_MEMORIES_STORE, "readwrite");
  const store = transaction.objectStore(CAMPAIGN_MEMORIES_STORE);
  const keys = await requestResult(store.index("campaignId").getAllKeys(campaignId));
  for (const key of keys) store.delete(key);
  await transactionComplete(transaction);
  if (keys.length > 0) notifyDurableDataChanged(["campaignMemories"]);
  return keys.length;
}
