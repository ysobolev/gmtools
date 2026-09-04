import {
  CHAT_DATABASE_NAME,
  CHAT_DATABASE_VERSION,
  migrateDatabase,
} from "./indexed-db-migrations";

let databasePromise: Promise<IDBDatabase> | undefined;

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export function transactionComplete(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction || event.newVersion === null) {
        throw new Error("IndexedDB did not provide an upgrade transaction.");
      }
      migrateDatabase(
        request.result,
        transaction,
        event.oldVersion,
        event.newVersion,
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error("Could not open chat storage."));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("Chat storage upgrade is blocked by another page."));
    };
  });
  return databasePromise;
}

export async function ensureDatabaseReady(): Promise<void> {
  await openDatabase();
}
