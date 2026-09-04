import { DEFAULT_PROFILE } from "./profile-config";
import { DEFAULT_GLOBAL_PREFERENCES } from "./global-preferences";

export const CHAT_DATABASE_NAME = "gmToolsChats";
export const CHAT_DATABASE_VERSION = 3;

export const CHATS_STORE = "chats";
export const MESSAGES_STORE = "messages";
export const IMAGES_STORE = "images";
export const PROFILES_STORE = "profiles";
export const SETTINGS_STORE = "settings";

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
