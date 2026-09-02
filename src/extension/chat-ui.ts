import type { ChatRecord } from "./chat-store";
import type { CampaignCandidate } from "./openrouter-protocol";

export interface CampaignChatGroup {
  readonly key: string;
  readonly name: string;
  readonly chats: ChatRecord[];
}

export interface ChatDraftStore {
  readonly get: (chatId: string) => string;
  readonly set: (chatId: string, draft: string) => void;
  readonly getScrollPosition: (
    chatId: string,
  ) => ChatScrollPosition | undefined;
  readonly setScrollPosition: (
    chatId: string,
    position: ChatScrollPosition,
  ) => void;
  readonly delete: (chatId: string) => void;
}

export interface ChatScrollPosition {
  readonly scrollTop: number;
  readonly atBottom: boolean;
  readonly anchorMessageId?: string;
  readonly anchorOffset?: number;
}

export function createChatDraftStore(): ChatDraftStore {
  const drafts = new Map<string, string>();
  const scrollPositions = new Map<string, ChatScrollPosition>();
  return {
    get: (chatId) => drafts.get(chatId) ?? "",
    set: (chatId, draft) => {
      if (draft) drafts.set(chatId, draft);
      else drafts.delete(chatId);
    },
    getScrollPosition: (chatId) => scrollPositions.get(chatId),
    setScrollPosition: (chatId, position) => {
      scrollPositions.set(chatId, position);
    },
    delete: (chatId) => {
      drafts.delete(chatId);
      scrollPositions.delete(chatId);
    },
  };
}

export function groupChatsByCampaign(
  chats: readonly ChatRecord[],
): CampaignChatGroup[] {
  const groups = new Map<string, CampaignChatGroup>();
  for (const chat of chats) {
    const key = chat.campaignId ? `campaign:${chat.campaignId}` : "unbound";
    const existing = groups.get(key);
    if (existing) {
      existing.chats.push(chat);
      continue;
    }
    groups.set(key, {
      key,
      name: chat.campaignId
        ? chat.campaignName ?? "Unknown campaign"
        : "No campaign",
      chats: [chat],
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.key === "unbound") return -1;
    if (right.key === "unbound") return 1;
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
  });
}

export function nextChatIdAfterDeletion(
  chats: readonly ChatRecord[],
  deletedChatId: string,
): string | undefined {
  const ordered = groupChatsByCampaign(chats).flatMap((group) => group.chats);
  const deletedIndex = ordered.findIndex((chat) => chat.id === deletedChatId);
  const remaining = ordered.filter((chat) => chat.id !== deletedChatId);
  if (remaining.length === 0) return undefined;
  if (deletedIndex < 0) return remaining[0]?.id;
  return remaining[Math.min(deletedIndex, remaining.length - 1)]?.id;
}

export function mergeCampaignCandidates(
  liveCandidates: readonly CampaignCandidate[],
  chats: readonly ChatRecord[],
): CampaignCandidate[] {
  const candidates = new Map<string, CampaignCandidate>();
  for (const candidate of liveCandidates) {
    if (!candidates.has(candidate.campaignId)) {
      candidates.set(candidate.campaignId, candidate);
    }
  }
  for (const chat of chats) {
    if (
      !chat.campaignId ||
      !chat.campaignName ||
      !chat.campaignModVersion ||
      candidates.has(chat.campaignId)
    ) {
      continue;
    }
    candidates.set(chat.campaignId, {
      campaignId: chat.campaignId,
      name: chat.campaignName,
      modVersion: chat.campaignModVersion,
      activeTab: false,
    });
  }
  return [...candidates.values()];
}
