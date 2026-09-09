import type { UIMessage } from "ai";
import type { Roll20SandboxVersion } from "../protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasCampaignToolHistory(messages: readonly unknown[]): boolean {
  return messages.some((message) =>
    isRecord(message) && message.role === "assistant" &&
    Array.isArray(message.parts) && message.parts.some((part: unknown) => {
      if (!isRecord(part)) return false;
      const name = part.type === "dynamic-tool"
        ? part.toolName
        : typeof part.type === "string" && part.type.startsWith("tool-")
          ? part.type.slice(5)
          : undefined;
      return name === "execute_roll20" ||
        (typeof name === "string" && name.startsWith("memory_"));
    })
  );
}

export function createCampaignAttachmentNotice(
  campaignId: string,
  name: string,
  warnAboutHistory: boolean,
  sandboxVersion?: Roll20SandboxVersion,
): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    metadata: { kind: "campaign-attachment-notice", campaignId, warnAboutHistory },
    parts: [{
      type: "text",
      text: `GM Tools attachment notice: This chat is now attached to ${JSON.stringify(name)} (campaign ID ${JSON.stringify(campaignId)}).` +
        (sandboxVersion ? ` Last-known Roll20 sandbox version: ${JSON.stringify(sandboxVersion)}. This is cached handshake information, not a live guarantee.` : " Roll20 sandbox version is unknown (not yet recorded).") + (warnAboutHistory
        ? " Earlier Roll20 and memory tool results may refer to another campaign. Do not assume prior sheet findings, object IDs, or remembered campaign facts apply here; re-establish relevant campaign-specific facts before acting. Chat history has been preserved."
        : ""),
    }],
  };
}

export function isCampaignAttachmentNotice(message: unknown): boolean {
  return isRecord(message) && message.role === "user" && isRecord(message.metadata) &&
    message.metadata.kind === "campaign-attachment-notice";
}

export function lastAttachedCampaignId(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isCampaignAttachmentNotice(message)) continue;
    // Stop at the latest notice even if its identity is unknown. Never infer
    // identity from prose or fall back to an older, potentially different one.
    if (!isRecord(message) || !isRecord(message.metadata)) return undefined;
    const id = message.metadata.campaignId;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  }
  return undefined;
}

export function isVisibleCampaignAttachmentNotice(message: UIMessage): boolean {
  return isCampaignAttachmentNotice(message) && isRecord(message.metadata) &&
    message.metadata.warnAboutHistory === true;
}

export function applyCampaignAttachmentNotice(
  messages: readonly unknown[],
  campaignId: string,
  name: string,
  sandboxVersion?: Roll20SandboxVersion,
): readonly unknown[] {
  let boundary = messages.length;
  while (boundary > 0 && isCampaignAttachmentNotice(messages[boundary - 1])) {
    boundary--;
  }
  const history = messages.slice(0, boundary);
  const previousCampaignId = lastAttachedCampaignId(history);
  // Only replace the trailing, not-yet-used attachment changes. Any ordinary
  // message (even without tool calls) makes an earlier notice historical.
  if (boundary < messages.length && previousCampaignId === campaignId) {
    return history;
  }
  return [
    ...history,
    createCampaignAttachmentNotice(
      campaignId,
      name,
      hasCampaignToolHistory(history) && previousCampaignId !== campaignId,
      sandboxVersion,
    ),
  ];
}
