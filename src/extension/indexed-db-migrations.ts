import { DEFAULT_PROFILE } from "./profile-config";
import { DEFAULT_GLOBAL_PREFERENCES } from "./global-preferences";

export const CHAT_DATABASE_NAME = "gmToolsChats";
export const CHAT_DATABASE_VERSION = 1;

export const CHATS_STORE = "chats";
export const MESSAGES_STORE = "messages";
export const IMAGES_STORE = "images";
export const PROFILES_STORE = "profiles";
export const SETTINGS_STORE = "settings";
export const ROLL20_APPROVALS_STORE = "roll20Approvals";
export const CAMPAIGNS_STORE = "campaigns";
export const CAMPAIGN_MEMORIES_STORE = "campaignMemories";
export const RUN_SNAPSHOTS_STORE = "runSnapshots";

interface DatabaseMigration {
  readonly version: number;
  readonly migrate: (
    database: IDBDatabase,
    transaction: IDBTransaction,
  ) => void;
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    migrate(database) {
      const chats = database.createObjectStore(CHATS_STORE, { keyPath: "id" });
      chats.createIndex("updatedAt", "updatedAt");
      chats.createIndex("profileId", "profileId");
      chats.createIndex("campaignId", "campaignId");
      database.createObjectStore(MESSAGES_STORE, { keyPath: "chatId" });

      const images = database.createObjectStore(IMAGES_STORE, {
        keyPath: "id",
      });
      images.createIndex("chatId", "chatId");

      const profiles = database.createObjectStore(PROFILES_STORE, {
        keyPath: "id",
      });
      profiles.add(DEFAULT_PROFILE);
      const settings = database.createObjectStore(SETTINGS_STORE, {
        keyPath: "id",
      });
      settings.add(DEFAULT_GLOBAL_PREFERENCES);

      const approvals = database.createObjectStore(ROLL20_APPROVALS_STORE, {
        keyPath: ["chatId", "approvalId"],
      });
      approvals.createIndex("chatId", "chatId");
      approvals.createIndex("chatToolCall", ["chatId", "toolCallId"], {
        unique: true,
      });

      const campaigns = database.createObjectStore(CAMPAIGNS_STORE, {
        keyPath: "campaignId",
      });
      campaigns.createIndex("name", "name");
      campaigns.createIndex("defaultProfileId", "defaultProfileId");

      const memories = database.createObjectStore(CAMPAIGN_MEMORIES_STORE, {
        keyPath: "id",
      });
      memories.createIndex("campaignId", "campaignId");
      memories.createIndex("campaignUpdatedAt", ["campaignId", "updatedAt"]);

      const snapshots = database.createObjectStore(RUN_SNAPSHOTS_STORE, {
        keyPath: "hash",
      });
      snapshots.createIndex("chatIds", "chatIds", { multiEntry: true });
    },
  },
];

export function migrateDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
): void {
  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.version > oldVersion && migration.version <= newVersion) {
      migration.migrate(database, transaction);
    }
  }
}
