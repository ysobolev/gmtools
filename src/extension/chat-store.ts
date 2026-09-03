export const CHAT_DATABASE_NAME = "gmToolsChats";
export const CHAT_DATABASE_VERSION = 2;
export const ACTIVE_CHAT_STORAGE_KEY = "gmToolsActiveChatId";
export const DEFAULT_CHAT_TITLE = "New Chat";
export const MAX_CHAT_TITLE_LENGTH = 120;

const CHATS_STORE = "chats";
const MESSAGES_STORE = "messages";
const IMAGES_STORE = "images";

export interface StoredChatImage {
  readonly id: string;
  readonly chatId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
  readonly blob: Blob;
  readonly createdAt: number;
}

export interface ChatNotice {
  readonly id: string;
  readonly kind: "profile-fallback";
  readonly text: string;
  readonly createdAt: number;
}

export interface ChatContinuation {
  readonly reason: "step-limit";
  readonly afterMessageId: string;
  readonly stepLimit: number;
  readonly createdAt: number;
}

export interface ChatRecord {
  readonly id: string;
  readonly title: string;
  readonly profileId: string;
  readonly campaignId?: string;
  readonly campaignName?: string;
  readonly campaignModVersion?: string;
  readonly continuation?: ChatContinuation;
  readonly notices: readonly ChatNotice[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface ChatMessagesRecord {
  readonly chatId: string;
  readonly messages: readonly unknown[];
  readonly updatedAt: number;
}

export interface StoredChat {
  readonly chat: ChatRecord;
  readonly messages: readonly unknown[];
}

let databasePromise: Promise<IDBDatabase> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isChatNotice(value: unknown): value is ChatNotice {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.kind === "profile-fallback" &&
    typeof value.text === "string" &&
    isFiniteTimestamp(value.createdAt)
  );
}

function isChatContinuation(value: unknown): value is ChatContinuation {
  return (
    isRecord(value) &&
    value.reason === "step-limit" &&
    typeof value.afterMessageId === "string" &&
    value.afterMessageId.length > 0 &&
    typeof value.stepLimit === "number" &&
    Number.isInteger(value.stepLimit) &&
    value.stepLimit > 0 &&
    isFiniteTimestamp(value.createdAt)
  );
}

export function isChatRecord(value: unknown): value is ChatRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.profileId === "string" &&
    value.profileId.length > 0 &&
    (value.campaignId === undefined || typeof value.campaignId === "string") &&
    (value.campaignName === undefined ||
      typeof value.campaignName === "string") &&
    (value.campaignModVersion === undefined ||
      typeof value.campaignModVersion === "string") &&
    (value.continuation === undefined ||
      isChatContinuation(value.continuation)) &&
    Array.isArray(value.notices) &&
    value.notices.every(isChatNotice) &&
    isFiniteTimestamp(value.createdAt) &&
    isFiniteTimestamp(value.updatedAt)
  );
}

function isChatMessagesRecord(value: unknown): value is ChatMessagesRecord {
  return (
    isRecord(value) &&
    typeof value.chatId === "string" &&
    Array.isArray(value.messages) &&
    isFiniteTimestamp(value.updatedAt)
  );
}

export function createChatRecord(
  profileId: string,
  options: {
    readonly id?: string;
    readonly now?: number;
    readonly title?: string;
  } = {},
): ChatRecord {
  const now = options.now ?? Date.now();
  return {
    id: options.id ?? crypto.randomUUID(),
    title:
      options.title?.trim().slice(0, MAX_CHAT_TITLE_LENGTH) ||
      DEFAULT_CHAT_TITLE,
    profileId,
    notices: [],
    createdAt: now,
    updatedAt: now,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHATS_STORE)) {
        const chats = database.createObjectStore(CHATS_STORE, { keyPath: "id" });
        chats.createIndex("updatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
        database.createObjectStore(MESSAGES_STORE, { keyPath: "chatId" });
      }
      if (!database.objectStoreNames.contains(IMAGES_STORE)) {
        const images = database.createObjectStore(IMAGES_STORE, {
          keyPath: "id",
        });
        images.createIndex("chatId", "chatId");
      }
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

export async function putChat(chat: ChatRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(CHATS_STORE, "readwrite");
  transaction.objectStore(CHATS_STORE).put(chat);
  await transactionComplete(transaction);
}

export async function getChat(chatId: string): Promise<ChatRecord | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(CHATS_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(CHATS_STORE).get(chatId),
  );
  await transactionComplete(transaction);
  return isChatRecord(value) ? value : undefined;
}

export async function listChats(): Promise<ChatRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CHATS_STORE, "readonly");
  const values: unknown[] = await requestResult(
    transaction.objectStore(CHATS_STORE).getAll(),
  );
  await transactionComplete(transaction);
  return values
    .filter(isChatRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function createChat(profileId: string): Promise<StoredChat> {
  const database = await openDatabase();
  const chat = createChatRecord(profileId);
  const messages: ChatMessagesRecord = {
    chatId: chat.id,
    messages: [],
    updatedAt: chat.updatedAt,
  };
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE],
    "readwrite",
  );
  transaction.objectStore(CHATS_STORE).add(chat);
  transaction.objectStore(MESSAGES_STORE).add(messages);
  await transactionComplete(transaction);
  return { chat, messages: [] };
}

export async function getStoredChat(
  chatId: string,
): Promise<StoredChat | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE],
    "readonly",
  );
  const chatValue: unknown = await requestResult(
    transaction.objectStore(CHATS_STORE).get(chatId),
  );
  const messagesValue: unknown = await requestResult(
    transaction.objectStore(MESSAGES_STORE).get(chatId),
  );
  await transactionComplete(transaction);
  if (!isChatRecord(chatValue)) return undefined;
  return {
    chat: chatValue,
    messages: isChatMessagesRecord(messagesValue)
      ? messagesValue.messages
      : [],
  };
}

export async function saveChatMessages(
  chatId: string,
  messages: readonly unknown[],
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE],
    "readwrite",
  );
  const chats = transaction.objectStore(CHATS_STORE);
  const chatValue: unknown = await requestResult(chats.get(chatId));
  if (!isChatRecord(chatValue)) {
    transaction.abort();
    throw new Error("The chat no longer exists.");
  }
  const updatedAt = Date.now();
  chats.put({ ...chatValue, updatedAt } satisfies ChatRecord);
  transaction.objectStore(MESSAGES_STORE).put({
    chatId,
    messages: [...messages],
    updatedAt,
  } satisfies ChatMessagesRecord);
  await transactionComplete(transaction);
}

export async function renameChat(
  chatId: string,
  title: string,
): Promise<ChatRecord> {
  const normalizedTitle = title.trim().slice(0, MAX_CHAT_TITLE_LENGTH);
  if (!normalizedTitle) throw new Error("Chat titles cannot be empty.");
  const chat = await getChat(chatId);
  if (!chat) throw new Error("The chat no longer exists.");
  const updated: ChatRecord = {
    ...chat,
    title: normalizedTitle,
    updatedAt: Date.now(),
  };
  await putChat(updated);
  return updated;
}

export async function deleteChat(chatId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE, IMAGES_STORE],
    "readwrite",
  );
  transaction.objectStore(CHATS_STORE).delete(chatId);
  transaction.objectStore(MESSAGES_STORE).delete(chatId);
  transaction.objectStore(IMAGES_STORE).index("chatId").openKeyCursor(
    IDBKeyRange.only(chatId),
  ).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (!cursor) return;
    transaction.objectStore(IMAGES_STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionComplete(transaction);
}

export async function saveChatImage(
  chatId: string,
  file: File,
): Promise<StoredChatImage> {
  return saveChatImageBlob(chatId, {
    id: crypto.randomUUID(),
    filename: file.name.trim() || "pasted-image",
    mediaType: file.type,
    blob: file,
  });
}

export async function saveChatImageBlob(
  chatId: string,
  value: {
    readonly id: string;
    readonly filename: string;
    readonly mediaType: string;
    readonly blob: Blob;
  },
): Promise<StoredChatImage> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, IMAGES_STORE],
    "readwrite",
  );
  const chatValue: unknown = await requestResult(
    transaction.objectStore(CHATS_STORE).get(chatId),
  );
  if (!isChatRecord(chatValue)) {
    transaction.abort();
    throw new Error("The chat no longer exists.");
  }
  const image: StoredChatImage = {
    id: value.id,
    chatId,
    filename: value.filename,
    mediaType: value.mediaType,
    size: value.blob.size,
    blob: value.blob,
    createdAt: Date.now(),
  };
  transaction.objectStore(IMAGES_STORE).put(image);
  await transactionComplete(transaction);
  return image;
}

export async function getChatImage(
  chatId: string,
  imageId: string,
): Promise<StoredChatImage | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(IMAGES_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(IMAGES_STORE).get(imageId),
  );
  await transactionComplete(transaction);
  if (typeof value !== "object" || value === null) return undefined;
  const image = value as Partial<StoredChatImage>;
  return image.chatId === chatId && image.blob instanceof Blob
    ? (image as StoredChatImage)
    : undefined;
}

export async function deleteChatImage(
  chatId: string,
  imageId: string,
): Promise<void> {
  const image = await getChatImage(chatId, imageId);
  if (!image) return;
  const database = await openDatabase();
  const transaction = database.transaction(IMAGES_STORE, "readwrite");
  transaction.objectStore(IMAGES_STORE).delete(imageId);
  await transactionComplete(transaction);
}

export async function updateChatProfile(
  chatId: string,
  profileId: string,
  notice?: ChatNotice,
): Promise<ChatRecord> {
  const chat = await getChat(chatId);
  if (!chat) throw new Error("The chat no longer exists.");
  const updated: ChatRecord = {
    ...chat,
    profileId,
    notices: notice ? [...chat.notices, notice] : chat.notices,
    updatedAt: Date.now(),
  };
  await putChat(updated);
  return updated;
}

export async function updateChatContinuation(
  chatId: string,
  continuation: ChatContinuation | undefined,
): Promise<ChatRecord> {
  const chat = await getChat(chatId);
  if (!chat) throw new Error("The chat no longer exists.");
  const updated: ChatRecord = continuation
    ? { ...chat, continuation, updatedAt: Date.now() }
    : (() => {
        const { continuation: _continuation, ...remaining } = chat;
        return { ...remaining, updatedAt: Date.now() };
      })();
  await putChat(updated);
  return updated;
}

export async function updateChatCampaign(
  chatId: string,
  campaign:
    | {
        readonly campaignId: string;
        readonly campaignName: string;
        readonly campaignModVersion: string;
      }
    | undefined,
): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const updated: ChatRecord = campaign
    ? {
        ...chat,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        campaignModVersion: campaign.campaignModVersion,
        updatedAt: Date.now(),
      }
    : {
        id: chat.id,
        title: chat.title,
        profileId: chat.profileId,
        notices: chat.notices,
        ...(chat.continuation ? { continuation: chat.continuation } : {}),
        createdAt: chat.createdAt,
        updatedAt: Date.now(),
      };
  await putChat(updated);
}
