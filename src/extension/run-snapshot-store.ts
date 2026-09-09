import { asSchema, type ToolSet } from "@ai-sdk/provider-utils";
import type { UIMessage } from "ai";
import { isCampaignAttachmentNotice } from "./campaign-attachment-notice";
import { openDatabase, requestResult, transactionComplete } from "./database";
import {
  CHATS_STORE,
  MESSAGES_STORE,
  RUN_SNAPSHOTS_STORE,
} from "./indexed-db-migrations";
import {
  preserveSubmissionMetadata,
  submissionMarkers,
  SUBMISSIONS_METADATA_KEY,
  type SubmissionMarker,
} from "./submission-metadata";

export interface RunSnapshot {
  readonly formatVersion: 1;
  readonly system: string;
  readonly modelId: string;
  readonly modelOptions: unknown;
  readonly provider: {
    readonly name: "openrouter";
    readonly compatibility: "strict";
    readonly appName: string;
    readonly appUrl: string;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly tools: readonly unknown[];
  readonly behavior: {
    readonly maximumSteps: number;
    readonly unrestrictedWebFetchEnabled: boolean;
    readonly webSearchEnabled: boolean;
    readonly requireRoll20Approval: boolean;
    readonly memoryEnabled: boolean;
  };
  readonly extension: {
    readonly version: string;
    readonly buildId: string;
    readonly browser: string;
  };
  readonly profile: { readonly id: string; readonly name: string };
  readonly campaign: {
    readonly id: string;
    readonly name: string;
    readonly modVersion?: string | undefined;
  } | null;
}

interface StoredRunSnapshot {
  readonly hash: string;
  readonly snapshot: RunSnapshot;
  /** Ownership for garbage collection; excluded from the content hash. */
  readonly chatIds: string[];
}

export async function snapshotTools(
  tools: ToolSet,
  activeTools: readonly string[],
): Promise<unknown[]> {
  return Promise.all(activeTools.map(async (name) => {
    const tool = tools[name];
    if (!tool) throw new Error(`Missing active tool: ${name}`);
    return {
      name,
      type: tool.type ?? "function",
      description: tool.description,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
      ...(tool.type === "provider" ? { id: tool.id, args: tool.args } : {}),
      providerOptions: tool.providerOptions,
    };
  }));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashRunSnapshot(snapshot: RunSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(JSON.parse(JSON.stringify(snapshot))));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Persist the exact run configuration and its submission marker atomically,
 * before contacting the provider. Resume/Retry append markers to the original
 * user submission; they do not invent user prose or split assistant responses. */
export async function recordRunSubmission(
  chatId: string,
  input: readonly UIMessage[],
  snapshot: RunSnapshot,
  continuation?: {
    readonly reason: "step-limit" | "stream-error";
    readonly afterMessageId: string;
  },
): Promise<UIMessage[]> {
  // Freeze the JSON representation before any asynchronous work so the hash
  // and stored content cannot diverge if a caller mutates its options object.
  const normalized: RunSnapshot = JSON.parse(JSON.stringify(snapshot));
  const hash = await hashRunSnapshot(normalized);
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHATS_STORE, MESSAGES_STORE, RUN_SNAPSHOTS_STORE],
    "readwrite",
  );
  const done = transactionComplete(transaction);
  // Observe aborts even when a validation failure throws before awaiting done.
  void done.catch(() => undefined);
  const chat = await requestResult(transaction.objectStore(CHATS_STORE).get(chatId));
  if (!chat) {
    transaction.abort();
    throw new Error("The chat no longer exists.");
  }
  const messagesStore = transaction.objectStore(MESSAGES_STORE);
  const stored = await requestResult(messagesStore.get(chatId));
  const messages = preserveSubmissionMetadata(input, stored?.messages ?? []);
  let index = messages.length - 1;
  while (
    index >= 0 &&
    (messages[index]?.role !== "user" || isCampaignAttachmentNotice(messages[index]))
  ) index--;
  if (index < 0) {
    transaction.abort();
    throw new Error("A model run needs a user submission.");
  }
  const message = messages[index]!;
  const previous = submissionMarkers(message);
  const final = messages.at(-1);
  const approval = final?.role === "assistant" && final.parts.some((p) =>
    "state" in p && p.state === "approval-responded");
  const marker: SubmissionMarker = {
    runId: crypto.randomUUID(),
    snapshotHash: hash,
    createdAt: Date.now(),
    kind: continuation ? (continuation.reason === "stream-error" ? "retry" : "resume")
      : approval ? "approval" : previous.length ? "retry" : "message",
    ...(continuation ? { afterMessageId: continuation.afterMessageId } : {}),
  };
  messages[index] = {
    ...message,
    metadata: {
      ...(message.metadata as object | undefined),
      [SUBMISSIONS_METADATA_KEY]: [...previous, marker],
    },
  };
  const snapshots = transaction.objectStore(RUN_SNAPSHOTS_STORE);
  const existing: StoredRunSnapshot | undefined = await requestResult(snapshots.get(hash));
  snapshots.put({
    hash,
    snapshot: existing?.snapshot ?? normalized,
    chatIds: [...new Set([...(existing?.chatIds ?? []), chatId])],
  } satisfies StoredRunSnapshot);
  messagesStore.put({ chatId, messages, updatedAt: marker.createdAt });
  await done;
  return messages;
}

/** Used in the same transaction as chat deletion, including bulk campaign deletion. */
export async function releaseChatSnapshots(
  transaction: IDBTransaction,
  chatId: string,
): Promise<void> {
  const store = transaction.objectStore(RUN_SNAPSHOTS_STORE);
  const snapshots: StoredRunSnapshot[] = await requestResult(store.index("chatIds").getAll(chatId));
  for (const snapshot of snapshots) {
    const chatIds = snapshot.chatIds.filter((id) => id !== chatId);
    if (chatIds.length) store.put({ ...snapshot, chatIds });
    else store.delete(snapshot.hash);
  }
}

export async function getRunSnapshot(hash: string): Promise<RunSnapshot | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(RUN_SNAPSHOTS_STORE, "readonly");
  const value: StoredRunSnapshot | undefined = await requestResult(tx.objectStore(RUN_SNAPSHOTS_STORE).get(hash));
  await transactionComplete(tx);
  return value?.snapshot;
}
