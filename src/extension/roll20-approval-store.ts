import type { UIMessage } from "ai";
import { sanitizeStoppedConversation } from "./chat-persistence";
import {
  openDatabase,
  requestResult,
  transactionComplete,
} from "./database";
import {
  CHATS_STORE,
  MESSAGES_STORE,
  ROLL20_APPROVALS_STORE,
} from "./indexed-db-migrations";
import { isChatRecord, type ChatRecord } from "./chat-store";

type ApprovalState =
  | "pending"
  | "approved"
  | "denied"
  | "executing"
  | "completed"
  | "failed"
  | "unknown";

interface Roll20ApprovalRecord {
  readonly chatId: string;
  readonly approvalId: string;
  readonly campaignId: string;
  readonly toolCallId: string;
  readonly argumentsHash: string;
  readonly state: ApprovalState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface ChatMessagesRecord {
  readonly chatId: string;
  readonly messages: readonly unknown[];
  readonly updatedAt: number;
}

interface ApprovalPart {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly summary: string;
  readonly code: string;
  readonly decision?: boolean;
}

export class StaleRoll20ApprovalError extends Error {
  constructor() {
    super(
      "This Roll20 action was already resolved. The chat has been refreshed.",
    );
    this.name = "StaleRoll20ApprovalError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function approvalPart(
  part: unknown,
  state: "approval-requested" | "approval-responded",
): ApprovalPart | undefined {
  if (!isRecord(part) || part.type !== "tool-execute_roll20") return undefined;
  if (part.state !== state || typeof part.toolCallId !== "string") {
    return undefined;
  }
  const input = part.input;
  const approval = part.approval;
  if (
    !isRecord(input) ||
    typeof input.summary !== "string" ||
    typeof input.code !== "string" ||
    !isRecord(approval) ||
    typeof approval.id !== "string" ||
    approval.isAutomatic === true
  ) {
    return undefined;
  }
  if (state === "approval-responded" && typeof approval.approved !== "boolean") {
    return undefined;
  }
  return {
    approvalId: approval.id,
    toolCallId: part.toolCallId,
    summary: input.summary,
    code: input.code,
    ...(state === "approval-responded"
      ? { decision: approval.approved as boolean }
      : {}),
  };
}

function collectApprovalParts(
  messages: readonly UIMessage[],
  state: "approval-requested" | "approval-responded",
): ApprovalPart[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const found = approvalPart(part, state);
      return found ? [found] : [];
    })
  );
}

function findApprovalPart(
  messages: readonly unknown[],
  toolCallId: string,
  state: "approval-requested" | "approval-responded",
): ApprovalPart | undefined {
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      const found = approvalPart(part, state);
      if (found?.toolCallId === toolCallId) return found;
    }
  }
  return undefined;
}

function isApprovalRecord(value: unknown): value is Roll20ApprovalRecord {
  return (
    isRecord(value) &&
    typeof value.chatId === "string" &&
    typeof value.approvalId === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.argumentsHash === "string" &&
    (value.state === "pending" ||
      value.state === "approved" ||
      value.state === "denied" ||
      value.state === "executing" ||
      value.state === "completed" ||
      value.state === "failed" ||
      value.state === "unknown") &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

async function hashArguments(input: {
  readonly summary: string;
  readonly code: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([input.summary, input.code]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function sameApproval(
  record: Roll20ApprovalRecord,
  part: ApprovalPart,
  campaignId: string,
  argumentsHash: string,
): boolean {
  return (
    record.approvalId === part.approvalId &&
    record.toolCallId === part.toolCallId &&
    record.campaignId === campaignId &&
    record.argumentsHash === argumentsHash
  );
}

async function requireChat(
  transaction: IDBTransaction,
  chatId: string,
): Promise<ChatRecord> {
  const value: unknown = await requestResult(
    transaction.objectStore(CHATS_STORE).get(chatId),
  );
  if (!isChatRecord(value)) {
    transaction.abort();
    throw new Error("The chat no longer exists.");
  }
  return value;
}

export async function saveMessagesAndRegisterRoll20Approvals(
  chatId: string,
  campaignId: string | undefined,
  messages: readonly UIMessage[],
): Promise<void> {
  const requests = collectApprovalParts(messages, "approval-requested");
  if (requests.length > 0 && !campaignId) {
    throw new Error("A Roll20 approval request is missing its campaign.");
  }
  const hashed = await Promise.all(
    requests.map(async (part) => ({ part, hash: await hashArguments(part) })),
  );
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE, ROLL20_APPROVALS_STORE],
    "readwrite",
  );
  const chat = await requireChat(transaction, chatId);
  const approvals = transaction.objectStore(ROLL20_APPROVALS_STORE);
  const now = Date.now();
  for (const { part, hash } of hashed) {
    const key = [chatId, part.approvalId];
    const existing: unknown = await requestResult(approvals.get(key));
    if (existing !== undefined) {
      if (
        !isApprovalRecord(existing) ||
        existing.state !== "pending" ||
        !sameApproval(existing, part, campaignId!, hash)
      ) {
        transaction.abort();
        throw new StaleRoll20ApprovalError();
      }
      continue;
    }
    approvals.add({
      chatId,
      approvalId: part.approvalId,
      campaignId: campaignId!,
      toolCallId: part.toolCallId,
      argumentsHash: hash,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    } satisfies Roll20ApprovalRecord);
  }
  transaction.objectStore(CHATS_STORE).put({ ...chat, updatedAt: now });
  transaction.objectStore(MESSAGES_STORE).put({
    chatId,
    messages: [...messages],
    updatedAt: now,
  } satisfies ChatMessagesRecord);
  await transactionComplete(transaction);
}

export async function saveConversationInputWithApprovals(
  chatId: string,
  campaignId: string | undefined,
  messages: readonly UIMessage[],
): Promise<boolean> {
  const responses = collectApprovalParts(messages, "approval-responded");
  if (responses.length === 0) return false;
  if (!campaignId) throw new StaleRoll20ApprovalError();
  const hashed = await Promise.all(
    responses.map(async (part) => ({ part, hash: await hashArguments(part) })),
  );
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE, ROLL20_APPROVALS_STORE],
    "readwrite",
  );
  const chat = await requireChat(transaction, chatId);
  if (chat.campaignId !== campaignId) {
    transaction.abort();
    throw new StaleRoll20ApprovalError();
  }
  const storedMessagesValue: unknown = await requestResult(
    transaction.objectStore(MESSAGES_STORE).get(chatId),
  );
  const storedMessages = isRecord(storedMessagesValue) &&
      Array.isArray(storedMessagesValue.messages)
    ? storedMessagesValue.messages
    : [];
  const approvals = transaction.objectStore(ROLL20_APPROVALS_STORE);
  let changed = false;
  const now = Date.now();
  for (const { part, hash } of hashed) {
    const value: unknown = await requestResult(
      approvals.get([chatId, part.approvalId]),
    );
    if (
      !isApprovalRecord(value) ||
      !sameApproval(value, part, campaignId, hash)
    ) {
      transaction.abort();
      throw new StaleRoll20ApprovalError();
    }
    const canonicalRequest = findApprovalPart(
      storedMessages,
      part.toolCallId,
      "approval-requested",
    );
    const canonicalResponse = findApprovalPart(
      storedMessages,
      part.toolCallId,
      "approval-responded",
    );
    if (value.state === "pending") {
      if (
        !canonicalRequest ||
        canonicalRequest.approvalId !== part.approvalId ||
        canonicalRequest.summary !== part.summary ||
        canonicalRequest.code !== part.code
      ) {
        transaction.abort();
        throw new StaleRoll20ApprovalError();
      }
      approvals.put({
        ...value,
        state: part.decision ? "approved" : "denied",
        updatedAt: now,
      } satisfies Roll20ApprovalRecord);
      changed = true;
      continue;
    }
    const expectedState = part.decision ? "approved" : "denied";
    if (
      value.state !== expectedState ||
      !canonicalResponse ||
      canonicalResponse.approvalId !== part.approvalId ||
      canonicalResponse.decision !== part.decision ||
      canonicalResponse.summary !== part.summary ||
      canonicalResponse.code !== part.code
    ) {
      transaction.abort();
      throw new StaleRoll20ApprovalError();
    }
  }
  transaction.objectStore(CHATS_STORE).put({ ...chat, updatedAt: now });
  transaction.objectStore(MESSAGES_STORE).put({
    chatId,
    messages: [...messages],
    updatedAt: now,
  } satisfies ChatMessagesRecord);
  await transactionComplete(transaction);
  return changed;
}

export async function claimRoll20Approval(
  chatId: string,
  campaignId: string,
  toolCallId: string,
  input: { readonly summary: string; readonly code: string },
  required: boolean,
): Promise<boolean> {
  const hash = await hashArguments(input);
  const database = await openDatabase();
  const transaction = database.transaction(ROLL20_APPROVALS_STORE, "readwrite");
  const approvals = transaction.objectStore(ROLL20_APPROVALS_STORE);
  const value: unknown = await requestResult(
    approvals.index("chatToolCall").get([chatId, toolCallId]),
  );
  if (value === undefined && !required) {
    await transactionComplete(transaction);
    return false;
  }
  if (
    !isApprovalRecord(value) ||
    value.state !== "approved" ||
    value.campaignId !== campaignId ||
    value.argumentsHash !== hash
  ) {
    transaction.abort();
    throw new StaleRoll20ApprovalError();
  }
  approvals.put({ ...value, state: "executing", updatedAt: Date.now() });
  await transactionComplete(transaction);
  return true;
}

export async function resolveRoll20ApprovalExecution(
  chatId: string,
  toolCallId: string,
  state: "completed" | "failed" | "unknown",
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(ROLL20_APPROVALS_STORE, "readwrite");
  const approvals = transaction.objectStore(ROLL20_APPROVALS_STORE);
  const value: unknown = await requestResult(
    approvals.index("chatToolCall").get([chatId, toolCallId]),
  );
  if (isApprovalRecord(value) && value.state === "executing") {
    approvals.put({ ...value, state, updatedAt: Date.now() });
  }
  await transactionComplete(transaction);
}

export async function cancelRoll20Approvals(chatId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE, ROLL20_APPROVALS_STORE],
    "readwrite",
  );
  const chat = await requireChat(transaction, chatId);
  const messagesStore = transaction.objectStore(MESSAGES_STORE);
  const storedValue: unknown = await requestResult(messagesStore.get(chatId));
  const storedMessages =
    isRecord(storedValue) && Array.isArray(storedValue.messages)
      ? storedValue.messages as UIMessage[]
      : [];
  const messages = chat.pendingRoll20Approvals
    ? sanitizeStoppedConversation(storedMessages)
    : storedMessages;
  const { pendingRoll20Approvals: _pending, ...updatedChat } = chat;
  const now = Date.now();
  transaction.objectStore(CHATS_STORE).put({ ...updatedChat, updatedAt: now });
  messagesStore.put({ chatId, messages, updatedAt: now } satisfies ChatMessagesRecord);
  transaction.objectStore(ROLL20_APPROVALS_STORE).index("chatId").openKeyCursor(
    IDBKeyRange.only(chatId),
  ).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (!cursor) return;
    transaction.objectStore(ROLL20_APPROVALS_STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionComplete(transaction);
}
