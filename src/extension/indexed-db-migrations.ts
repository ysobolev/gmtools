import { DEFAULT_PROFILE } from "./profile-config";
import { DEFAULT_GLOBAL_PREFERENCES } from "./global-preferences";

export const CHAT_DATABASE_NAME = "gmToolsChats";
export const CHAT_DATABASE_VERSION = 6;

export const CHATS_STORE = "chats";
export const MESSAGES_STORE = "messages";
export const IMAGES_STORE = "images";
export const PROFILES_STORE = "profiles";
export const SETTINGS_STORE = "settings";
export const ROLL20_APPROVALS_STORE = "roll20Approvals";
export const CAMPAIGNS_STORE = "campaigns";
export const CAMPAIGN_MEMORIES_STORE = "campaignMemories";

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
      database.createObjectStore(MESSAGES_STORE, { keyPath: "chatId" });
    },
  },
  {
    version: 2,
    migrate(database) {
      const images = database.createObjectStore(IMAGES_STORE, {
        keyPath: "id",
      });
      images.createIndex("chatId", "chatId");
    },
  },
  {
    version: 3,
    migrate(database, transaction) {
      transaction.objectStore(CHATS_STORE).createIndex("profileId", "profileId");
      const profiles = database.createObjectStore(PROFILES_STORE, {
        keyPath: "id",
      });
      profiles.add(DEFAULT_PROFILE);
      const settings = database.createObjectStore(SETTINGS_STORE, {
        keyPath: "id",
      });
      settings.add(DEFAULT_GLOBAL_PREFERENCES);
    },
  },
  {
    version: 4,
    migrate(database) {
      const approvals = database.createObjectStore(ROLL20_APPROVALS_STORE, {
        keyPath: ["chatId", "approvalId"],
      });
      approvals.createIndex("chatId", "chatId");
      approvals.createIndex("chatToolCall", ["chatId", "toolCallId"], {
        unique: true,
      });
    },
  },
  {
    version: 5,
    migrate(database, transaction) {
      transaction.objectStore(CHATS_STORE).createIndex(
        "campaignId",
        "campaignId",
      );
      const campaigns = database.createObjectStore(CAMPAIGNS_STORE, {
        keyPath: "campaignId",
      });
      campaigns.createIndex("name", "name");
      campaigns.createIndex("defaultProfileId", "defaultProfileId");
    },
  },
  {
    version: 6,
    migrate(database, transaction) {
      const memories = database.createObjectStore(CAMPAIGN_MEMORIES_STORE, {
        keyPath: "id",
      });
      memories.createIndex("campaignId", "campaignId");
      memories.createIndex("campaignUpdatedAt", ["campaignId", "updatedAt"]);

      const request = transaction.objectStore(CAMPAIGNS_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value as Record<string, unknown>;
        cursor.update({ ...value, memoryEnabled: false });
        cursor.continue();
      };
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
