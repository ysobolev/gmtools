import "./configure-csp";
import { useChat } from "@ai-sdk/react";
import { safeValidateUIMessages, type UIMessage } from "ai";
import {
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  combineAssistantImages,
  countMarkdownImageReferences,
  type AssistantImage,
  type DisplayableAssistantImage,
  getGeneratedImageDragPayload,
  getDisplayableAssistantImages,
  isOpenRouterImageUrl,
} from "./assistant-images";
import {
  getAssistantContentBlocks,
  getChatActivity,
  hasActiveRoll20Status,
  type Roll20Receipt,
} from "./chat-activity";
import {
  isStoppedAssistantMessage,
  sanitizeStoppedConversation,
} from "./chat-persistence";
import {
  ACTIVE_CHAT_STORAGE_KEY,
  MAX_CHAT_TITLE_LENGTH,
  createChat,
  deleteChat,
  deleteChatImage,
  getChatImage,
  getStoredChat,
  listChats,
  renameChat,
  saveChatImage,
  saveChatImageBlob,
  updateChatProfile,
  type ChatContinuation,
  type ChatNotice,
  type ChatRecord,
} from "./chat-store";
import {
  MAX_PENDING_IMAGES,
  MAX_UPLOADED_IMAGE_BYTES,
  createUploadedImagePart,
  isGeneratedImagePart,
  isSupportedUploadedImageType,
  isUploadedImagePart,
  type UploadedImageReference,
} from "./chat-images";
import {
  describeImageDrop,
  getDroppedImageUrls,
  imageOriginPermission,
} from "./image-drop";
import { downloadImage, RemoteImageNetworkError } from "./remote-image";
import {
  DEBUG_LOGGING_STORAGE_KEY,
  isDebugLoggingEnabled,
} from "./behavior-settings";
import { createDebugLogger } from "./debug-logger";
import {
  applyDisplayTheme,
  DEFAULT_DISPLAY_THEME,
  DISPLAY_THEME_STORAGE_KEY,
  isDisplayTheme,
  type DisplayTheme,
} from "./display-settings";
import { ExtensionChatTransport } from "./extension-chat-transport";
import {
  createChatDraftStore,
  groupChatsByCampaign,
  nextChatIdAfterDeletion,
  type ChatScrollPosition,
} from "./chat-ui";
import {
  DEFAULT_PROFILE,
  getModelSelectionLabel,
  normalizeProfiles,
  PROFILES_STORAGE_KEY,
  type AssistantProfile,
} from "./profile-config";
import {
  AUTH_CONNECT_REQUEST,
  AUTH_STATE_CHANGED,
  AUTH_STATUS_REQUEST,
  CAMPAIGN_ATTACH_REQUEST,
  CAMPAIGN_CANDIDATES_REQUEST,
  CAMPAIGN_DETACH_REQUEST,
  CHAT_ACTIVITIES_REQUEST,
  CHAT_CLEAR,
  CHAT_COMMIT,
  isAuthResponse,
  isAuthStateChangedMessage,
  isCampaignStatusChangedMessage,
  isCampaignCandidatesResponse,
  isCampaignStatusResponse,
  isChatActivitiesResponse,
  isChatActivityChangedMessage,
  isChatContinuationChangedMessage,
  type AuthRequest,
  type AuthStatus,
  type CampaignStatus,
  type CampaignCandidate,
  type ChatActivityStatus,
} from "./openrouter-protocol";

function sendChatControl(
  type: typeof CHAT_CLEAR | typeof CHAT_COMMIT,
  chatId: string,
): void {
  void chrome.runtime.sendMessage({ type, chatId }).catch(() => undefined);
}

async function acknowledgeCompletedChat(chatId: string): Promise<void> {
  await chrome.runtime
    .sendMessage({ type: CHAT_COMMIT, chatId })
    .catch(() => undefined);
}

function withChatContinuation(
  chat: ChatRecord,
  continuation: ChatContinuation | null,
): ChatRecord {
  if (continuation) return { ...chat, continuation };
  const { continuation: _continuation, ...remaining } = chat;
  return remaining;
}

function GeneratedImage({
  alt,
  image,
}: {
  readonly alt?: string | undefined;
  readonly image: DisplayableAssistantImage;
}): React.JSX.Element {
  const draggable = image.url.startsWith(
    `data:${image.mediaType};base64,`,
  );
  const handleDragStart = (event: DragEvent<HTMLImageElement>): void => {
    const payload = getGeneratedImageDragPayload(image);
    if (!payload) {
      event.preventDefault();
      return;
    }
    const buffer = new ArrayBuffer(payload.bytes.byteLength);
    new Uint8Array(buffer).set(payload.bytes);
    const file = new File([buffer], payload.filename, {
      type: payload.mediaType,
    });
    event.dataTransfer.clearData();
    event.dataTransfer.items.add(file);
    event.dataTransfer.setData("DownloadURL", payload.downloadUrl);
    event.dataTransfer.effectAllowed = "copy";
  };
  return (
    <img
      alt={alt ?? image.filename ?? "Generated image"}
      className="generated-image"
      draggable={draggable}
      loading="lazy"
      onDragStart={handleDragStart}
      referrerPolicy="no-referrer"
      src={image.url}
      title={draggable ? "Drag into Roll20 to upload" : undefined}
    />
  );
}

function StoredImagePreview({
  chatId,
  fullSize = false,
  image,
  onRemove,
}: {
  readonly chatId: string;
  readonly fullSize?: boolean;
  readonly image: UploadedImageReference;
  readonly onRemove?: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void getChatImage(chatId, image.imageId).then((stored) => {
      if (!active || !stored) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setBlob(stored.blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatId, image.imageId]);

  if (fullSize) {
    const handleDragStart = (event: DragEvent<HTMLImageElement>): void => {
      if (!blob || !url) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.clearData();
      event.dataTransfer.items.add(new File([blob], image.filename, {
        type: image.mediaType,
      }));
      event.dataTransfer.setData(
        "DownloadURL",
        `${image.mediaType}:${image.filename}:${url}`,
      );
      event.dataTransfer.effectAllowed = "copy";
    };
    return url ? (
      <img
        alt={image.filename}
        className="generated-image"
        draggable={Boolean(blob)}
        loading="lazy"
        onDragStart={handleDragStart}
        src={url}
        title="Drag into Roll20 to upload"
      />
    ) : (
      <span className="image-placeholder">[Loading image…]</span>
    );
  }

  return (
    <figure className="uploaded-image-preview">
      {url ? (
        <img alt={image.filename} src={url} />
      ) : (
        <span aria-hidden="true">…</span>
      )}
      <figcaption title={image.filename}>{image.filename}</figcaption>
      {onRemove ? (
        <button
          aria-label={`Remove ${image.filename}`}
          onClick={onRemove}
          type="button"
        >
          ×
        </button>
      ) : null}
    </figure>
  );
}

function AssistantImageView({
  alt,
  chatId,
  image,
}: {
  readonly alt?: string | undefined;
  readonly chatId: string;
  readonly image: AssistantImage;
}): React.JSX.Element {
  return image.kind === "displayable" ? (
    <GeneratedImage alt={alt} image={image.image} />
  ) : (
    <StoredImagePreview chatId={chatId} fullSize image={image.image} />
  );
}

function Roll20Status({
  receipt,
}: {
  readonly receipt: Roll20Receipt;
}): React.JSX.Element {
  const label =
    receipt.status === "working"
      ? "Working"
      : receipt.status === "completed"
        ? "Completed"
        : receipt.status === "timed-out"
          ? "Timed out; outcome unknown"
          : "Failed";
  return (
    <ul className="tool-receipts inline">
      <li
        aria-label={`${label}: ${receipt.summary}`}
        className={`tool-receipt ${receipt.status}`}
        title={receipt.status === "timed-out" ? label : undefined}
      >
        <span aria-hidden="true" className="tool-receipt-icon">
          {receipt.status === "working"
            ? "…"
            : receipt.status === "completed"
              ? "✓"
              : receipt.status === "timed-out"
                ? "?"
                : "✕"}
        </span>
        <span>{receipt.summary}</span>
      </li>
    </ul>
  );
}

function createMarkdownComponents(
  chatId: string,
  generatedImages: readonly AssistantImage[] = [],
): Components {
  let generatedImageIndex = 0;
  return {
    a: ({ node: _node, ...properties }) => (
      <a {...properties} rel="noopener noreferrer" target="_blank" />
    ),
    img: ({ alt, src }) => {
      if (isOpenRouterImageUrl(src)) {
        return (
          <img
            alt={alt ?? "Generated image"}
            className="generated-image"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={src as string}
          />
        );
      }
      const generatedImage = generatedImages[generatedImageIndex];
      generatedImageIndex += 1;
      return generatedImage ? (
        <AssistantImageView
          alt={alt ?? undefined}
          chatId={chatId}
          image={generatedImage}
        />
      ) : (
        <span className="image-placeholder">[Image: {alt ?? "image"}]</span>
      );
    },
  };
}

async function sendAuthRequest(message: AuthRequest): Promise<AuthStatus> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!isAuthResponse(response)) throw new Error("The extension returned an invalid response.");
  if (!response.ok) throw new Error(response.error);
  return response.status;
}

function textFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function useDisplayTheme(): void {
  const [theme, setTheme] = useState<DisplayTheme>(DEFAULT_DISPLAY_THEME);

  useEffect(() => {
    void chrome.storage.local.get(DISPLAY_THEME_STORAGE_KEY).then((stored) => {
      const value = stored[DISPLAY_THEME_STORAGE_KEY];
      if (isDisplayTheme(value)) setTheme(value);
    });
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (
        areaName !== "local" ||
        !(DISPLAY_THEME_STORAGE_KEY in changes)
      ) {
        return;
      }
      const value = changes[DISPLAY_THEME_STORAGE_KEY]?.newValue;
      setTheme(isDisplayTheme(value) ? value : DEFAULT_DISPLAY_THEME);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => applyDisplayTheme(theme), [theme]);
}

function LoginScreen({
  connecting,
  error,
  onConnect,
}: {
  readonly connecting: boolean;
  readonly error: string | null;
  readonly onConnect: () => void;
}): React.JSX.Element {
  return (
    <main className="login-shell">
      <section className="brand-block">
        <p className="eyebrow">VIRTUAL TABLETOP ASSISTANT</p>
        <h1>GM Tools for VTT</h1>
        <p className="intro">
          A quiet co-pilot for preparation, improvisation, and everything that
          happens behind the screen.
        </p>
      </section>

      <section className="login-card" aria-labelledby="connect-heading">
        <div className="provider-mark" aria-hidden="true">OR</div>
        <div>
          <h2 id="connect-heading">Connect OpenRouter</h2>
          <p>
            Sign in with your OpenRouter account to choose and fund the models
            used by GM Tools.
          </p>
        </div>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        <button
          className="primary-button"
          disabled={connecting}
          onClick={onConnect}
          type="button"
        >
          {connecting ? "Connecting…" : "Connect OpenRouter"}
        </button>
        <p className="privacy-note">
          Credentials stay in browser memory unless you enable persistent login
          in Settings.
        </p>
      </section>
    </main>
  );
}

function LoadingScreen(): React.JSX.Element {
  return (
    <main className="loading-shell" aria-live="polite">
      <div className="loading-mark" aria-hidden="true" />
      <p>Preparing your workspace…</p>
    </main>
  );
}

function ChatNameEditor({
  onRename,
  title,
}: {
  readonly onRename: (title: string) => void;
  readonly title: string;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

  const submit = (): void => {
    const normalized = draft.trim();
    if (!normalized) return;
    if (normalized !== title) onRename(normalized);
    setEditing(false);
  };

  const cancel = (): void => {
    setDraft(title);
    setEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      cancel();
    }
  };

  return editing ? (
    <span className="chat-name chat-name-editor">
      <input
        aria-label="Chat title"
        autoFocus
        maxLength={MAX_CHAT_TITLE_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        value={draft}
      />
      <button
        aria-label="Save chat title"
        className="chat-name-edit"
        disabled={!draft.trim()}
        onClick={submit}
        type="button"
      >
        <span aria-hidden="true">✓</span>
      </button>
      <button
        aria-label="Cancel editing chat title"
        className="chat-name-edit"
        onClick={cancel}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  ) : (
    <span className="chat-name">
      <span className="chat-name-text">{title}</span>
      <button
        aria-label="Edit chat title"
        className="chat-name-edit"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        title="Edit chat title"
        type="button"
      >
        <span aria-hidden="true">✎</span>
      </button>
    </span>
  );
}

const ConversationPane = memo(function ConversationPane({
  chatId,
  initialScrollPosition,
  messages,
  notices,
  continuation,
  onContinue,
  onScrollPositionChange,
  status,
}: {
  readonly chatId: string;
  readonly initialScrollPosition: ChatScrollPosition | undefined;
  readonly messages: readonly UIMessage[];
  readonly notices: ChatRecord["notices"];
  readonly continuation: ChatContinuation | undefined;
  readonly onContinue: () => void;
  readonly onScrollPositionChange: (
    chatId: string,
    position: ChatScrollPosition,
  ) => void;
  readonly status: "submitted" | "streaming" | "ready" | "error";
}): React.JSX.Element {
  const conversationRef = useRef<HTMLElement>(null);
  const pinnedToBottomRef = useRef(initialScrollPosition?.atBottom ?? true);
  const anchorRef = useRef<{
    readonly messageId: string;
    readonly offset: number;
  } | null>(
    initialScrollPosition?.anchorMessageId !== undefined &&
      initialScrollPosition.anchorOffset !== undefined
      ? {
          messageId: initialScrollPosition.anchorMessageId,
          offset: initialScrollPosition.anchorOffset,
        }
      : null,
  );
  const restoredRef = useRef(false);
  const busy = status === "submitted" || status === "streaming";
  const activity = getChatActivity(status, messages);
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const inlineRoll20Working = latestAssistantMessage
    ? hasActiveRoll20Status(latestAssistantMessage)
    : false;

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (!initialScrollPosition) {
      conversation.scrollTop = conversation.scrollHeight;
      pinnedToBottomRef.current = true;
      anchorRef.current = null;
      restoredRef.current = true;
      return;
    }
    if (initialScrollPosition.atBottom) {
      conversation.scrollTop = conversation.scrollHeight;
      pinnedToBottomRef.current = true;
      anchorRef.current = null;
      restoredRef.current = true;
      return;
    }
    conversation.scrollTop = initialScrollPosition.scrollTop;
    const initialAnchorMessageId = initialScrollPosition.anchorMessageId;
    const anchor = initialAnchorMessageId
      ? [...conversation.querySelectorAll<HTMLElement>("[data-message-id]")]
          .find(
            (candidate) =>
              candidate.dataset.messageId === initialAnchorMessageId,
          )
      : undefined;
    if (
      anchor &&
      initialAnchorMessageId &&
      initialScrollPosition.anchorOffset !== undefined
    ) {
      anchorRef.current = {
        messageId: initialAnchorMessageId,
        offset: initialScrollPosition.anchorOffset,
      };
      conversation.scrollTop +=
        anchor.getBoundingClientRect().top -
        conversation.getBoundingClientRect().top -
        initialScrollPosition.anchorOffset;
    }
    pinnedToBottomRef.current = false;
    restoredRef.current = true;
  }, [chatId, initialScrollPosition]);

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (
      !conversation ||
      !restoredRef.current ||
      !pinnedToBottomRef.current
    ) {
      return;
    }
    conversation.scrollTop = conversation.scrollHeight;
  }, [busy, messages]);

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !restoredRef.current) return;
    const maintainViewport = (): void => {
      if (pinnedToBottomRef.current) {
        conversation.scrollTop = conversation.scrollHeight;
        return;
      }
      const savedAnchor = anchorRef.current;
      if (!savedAnchor) return;
      const anchor = [
        ...conversation.querySelectorAll<HTMLElement>("[data-message-id]"),
      ].find(
        (candidate) => candidate.dataset.messageId === savedAnchor.messageId,
      );
      if (!anchor) return;
      const offset =
        anchor.getBoundingClientRect().top -
        conversation.getBoundingClientRect().top;
      conversation.scrollTop += offset - savedAnchor.offset;
    };
    const observer = new ResizeObserver(maintainViewport);
    for (const element of conversation.children) observer.observe(element);
    maintainViewport();
    return () => observer.disconnect();
  }, [chatId, messages.length, notices.length]);

  const rememberScrollPosition = (): void => {
    const conversation = conversationRef.current;
    if (!conversation || !restoredRef.current) return;
    const atBottom =
      conversation.scrollHeight - conversation.scrollTop -
        conversation.clientHeight < 24;
    pinnedToBottomRef.current = atBottom;
    const conversationTop = conversation.getBoundingClientRect().top;
    const anchor = [
      ...conversation.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].find(
      (candidate) => candidate.getBoundingClientRect().bottom > conversationTop,
    );
    const anchorMessageId = anchor?.dataset.messageId;
    anchorRef.current =
      anchor && anchorMessageId
        ? {
            messageId: anchorMessageId,
            offset: anchor.getBoundingClientRect().top - conversationTop,
          }
        : null;
    onScrollPositionChange(chatId, {
      scrollTop: conversation.scrollTop,
      atBottom,
      ...(anchor && anchorMessageId
        ? {
            anchorMessageId,
            anchorOffset: anchorRef.current!.offset,
          }
        : {}),
    });
  };

  return (
    <section
      aria-live="polite"
      className="conversation"
      onScroll={rememberScrollPosition}
      ref={conversationRef}
    >
      {notices.map((notice) => (
        <div className="chat-notice" key={notice.id} role="status">
          {notice.text}
        </div>
      ))}
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-glyph" aria-hidden="true">✦</div>
          <h2>What does tonight need?</h2>
          <p>
            Sketch a scene, improvise an NPC, untangle a plot, or ask for a
            second opinion.
          </p>
        </div>
      ) : (
        <div className="message-list">
          {messages.map((message, messageIndex) => {
            const continuesAssistantResponse =
              message.role === "assistant" &&
              messages[messageIndex - 1]?.role === "assistant";
            const stopped = isStoppedAssistantMessage(message);
            const text = textFromMessage(message);
            const assistantBlocks =
              message.role === "assistant"
                ? getAssistantContentBlocks(message)
                : [];
            const images =
              message.role === "assistant"
                ? getDisplayableAssistantImages(message.parts)
                : [];
            const uploadedImages =
              message.role === "user"
                ? message.parts
                    .filter(isUploadedImagePart)
                    .map((part) => part.data)
                : [];
            const generatedImageReferences =
              message.role === "assistant"
                ? message.parts
                    .filter(isGeneratedImagePart)
                    .map((part) => part.data)
                : [];
            const assistantImages = combineAssistantImages(
              images,
              generatedImageReferences,
            );
            const embeddedImageCount = Math.min(
              assistantImages.length,
              countMarkdownImageReferences(text),
            );
            const embeddedImages = assistantImages.slice(0, embeddedImageCount);
            const trailingImages = assistantImages.slice(embeddedImageCount);
            const visibleTrailingImages =
              status === "streaming" &&
              message.role === "assistant" &&
              messageIndex === messages.length - 1
                ? []
                : trailingImages;
            let embeddedImageCursor = 0;
            if (
              !text &&
              assistantBlocks.length === 0 &&
              images.length === 0 &&
              uploadedImages.length === 0 &&
              generatedImageReferences.length === 0 &&
              !stopped
            ) {
              return null;
            }
            return (
              <article
                className={
                  `message ${message.role}` +
                  (continuesAssistantResponse ? " continued" : "")
                }
                data-message-id={message.id}
                key={message.id}
              >
                {!continuesAssistantResponse ? (
                  <p className="message-author">
                    {message.role === "user" ? "You" : "GM Tools"}
                  </p>
                ) : null}
                {message.role === "assistant" ? (
                  assistantBlocks.map((block, blockIndex) => {
                    if (block.type === "roll20-status") {
                      return (
                        <Roll20Status
                          key={block.receipt.toolCallId}
                          receipt={block.receipt}
                        />
                      );
                    }
                    const imageCount = Math.min(
                      countMarkdownImageReferences(block.text),
                      embeddedImages.length - embeddedImageCursor,
                    );
                    const blockImages = embeddedImages.slice(
                      embeddedImageCursor,
                      embeddedImageCursor + imageCount,
                    );
                    embeddedImageCursor += imageCount;
                    return (
                      <div
                        className="message-text message-markdown"
                        key={`text:${blockIndex}`}
                      >
                        <ReactMarkdown
                          components={createMarkdownComponents(
                            chatId,
                            blockImages,
                          )}
                          remarkPlugins={[remarkGfm]}
                        >
                          {block.text}
                        </ReactMarkdown>
                      </div>
                    );
                  })
                ) : (
                  <>
                    {uploadedImages.length > 0 ? (
                      <div className="uploaded-image-grid message-images">
                        {uploadedImages.map((image) => (
                          <StoredImagePreview
                            chatId={chatId}
                            image={image}
                            key={image.imageId}
                          />
                        ))}
                      </div>
                    ) : null}
                    {text ? <div className="message-text">{text}</div> : null}
                  </>
                )}
                {visibleTrailingImages.map((image, index) => (
                  <AssistantImageView
                    chatId={chatId}
                    image={image}
                    key={
                      image.kind === "displayable"
                        ? `${image.image.url.slice(0, 80)}:${index}`
                        : image.image.imageId
                    }
                  />
                ))}
                {stopped ? (
                  <p className="message-stopped" role="status">Stopped</p>
                ) : null}
              </article>
            );
          })}
          {activity && !inlineRoll20Working ? (
            <div
              className={`activity-indicator ${activity.kind.toLowerCase()}`}
              role="status"
            >
              <span>
                {activity.kind}
                {activity.summary ? `: ${activity.summary}` : ""}
              </span>
              <span className="activity-dots" aria-hidden="true">
                <span /><span /><span />
              </span>
            </div>
          ) : null}
          {continuation && !busy ? (
            <div className="continuation-card" role="status">
              <div>
                <strong>Step limit reached</strong>
                <p>
                  The model completed its last tool call but requested another
                  step.
                </p>
              </div>
              <button onClick={onContinue} type="button">
                Continue task
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
});

function ChatComposer({
  busy,
  chatId,
  error,
  initialDraft,
  modelLabel,
  onClearError,
  onDraftChange,
  onRegenerate,
  onSend,
  onStop,
}: {
  readonly busy: boolean;
  readonly chatId: string;
  readonly error: Error | undefined;
  readonly initialDraft: string;
  readonly modelLabel: string;
  readonly onClearError: () => void;
  readonly onDraftChange: (chatId: string, draft: string) => void;
  readonly onRegenerate: () => void;
  readonly onSend: (parts: UIMessage["parts"]) => void;
  readonly onStop: () => void;
}): React.JSX.Element {
  const [input, setInput] = useState(initialDraft);
  const [pendingImages, setPendingImages] = useState<UploadedImageReference[]>(
    [],
  );
  const pendingImagesRef = useRef<UploadedImageReference[]>([]);
  const [pendingRemoteDrop, setPendingRemoteDrop] = useState<{
    readonly urls: readonly string[];
    readonly origins: readonly string[];
  } | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingImages, setDraggingImages] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const conversation = textarea
      .closest(".chat-shell")
      ?.querySelector<HTMLElement>(".conversation");
    const wasPinned = conversation
      ? conversation.scrollHeight - conversation.scrollTop -
          conversation.clientHeight < 24
      : false;
    const previousScrollTop = conversation?.scrollTop;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    if (conversation) {
      conversation.scrollTop = wasPinned
        ? conversation.scrollHeight
        : previousScrollTop ?? conversation.scrollTop;
    }
  }, [input]);

  const updateInput = (value: string): void => {
    setInput(value);
    onDraftChange(chatId, value);
  };

  const addImageFiles = useCallback(async (files: readonly File[]) => {
    if (busy || files.length === 0) return;
    setAttachmentError(null);
    const available = MAX_PENDING_IMAGES - pendingImages.length;
    if (available <= 0) {
      setAttachmentError(
        `You can attach up to ${MAX_PENDING_IMAGES} images per message.`,
      );
      return;
    }
    const accepted: File[] = [];
    for (const file of files) {
      if (!isSupportedUploadedImageType(file.type)) {
        setAttachmentError("Only PNG, JPEG, GIF, and WebP images are supported.");
        continue;
      }
      if (file.size > MAX_UPLOADED_IMAGE_BYTES) {
        setAttachmentError(
          `Images must be ${MAX_UPLOADED_IMAGE_BYTES / 1024 / 1024} MB or smaller.`,
        );
        continue;
      }
      if (accepted.length < available) accepted.push(file);
    }
    if (files.length > available) {
      setAttachmentError(
        `You can attach up to ${MAX_PENDING_IMAGES} images per message.`,
      );
    }
    try {
      const stored = await Promise.all(
        accepted.map((file) => saveChatImage(chatId, file)),
      );
      const references = stored.map((image) => ({
        imageId: image.id,
        filename: image.filename,
        mediaType: image.mediaType,
        size: image.size,
      }));
      setPendingImages((existing) => {
        const next = [...existing, ...references];
        pendingImagesRef.current = next;
        return next;
      });
    } catch (uploadError) {
      setAttachmentError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not store the image.",
      );
    }
  }, [busy, chatId, pendingImages.length]);

  const addImageUrls = useCallback(async (
    urls: readonly string[],
    deferNetworkError = false,
  ): Promise<"attached" | "error" | "ignored" | "network-error"> => {
    if (busy || urls.length === 0) return "ignored";
    setAttachmentError(null);
    try {
      const available = MAX_PENDING_IMAGES - pendingImages.length;
      if (available <= 0) {
        throw new Error(
          `You can attach up to ${MAX_PENDING_IMAGES} images per message.`,
        );
      }
      const downloaded = await Promise.all(
        urls.slice(0, available).map((url) => downloadImage(url)),
      );
      const stored = await Promise.all(
        downloaded.map((image) => saveChatImageBlob(chatId, {
          id: crypto.randomUUID(),
          filename: image.filename,
          mediaType: image.mediaType,
          blob: image.blob,
        })),
      );
      const references = stored.map((image) => ({
        imageId: image.id,
        filename: image.filename,
        mediaType: image.mediaType,
        size: image.size,
      }));
      setPendingImages((existing) => {
        const next = [...existing, ...references];
        pendingImagesRef.current = next;
        return next;
      });
      if (urls.length > available) {
        setAttachmentError(
          `You can attach up to ${MAX_PENDING_IMAGES} images per message.`,
        );
      }
      return "attached";
    } catch (uploadError) {
      if (
        deferNetworkError &&
        uploadError instanceof RemoteImageNetworkError
      ) return "network-error";
      setAttachmentError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not download the image.",
      );
      return "error";
    }
  }, [busy, chatId, pendingImages.length]);

  const attachDroppedImageUrls = (
    transfer: Pick<DataTransfer, "getData">,
  ): boolean => {
    const urls = getDroppedImageUrls(transfer);
    if (urls.length === 0) return false;
    setPendingRemoteDrop(null);
    const origins = [...new Set(
      urls.map(imageOriginPermission).filter((value): value is string =>
        value !== undefined
      ),
    )];
    if (origins.length === 0) {
      void addImageUrls(urls);
      return true;
    }
    void chrome.permissions.contains({ origins })
      .then((granted) => {
        if (granted) {
          void addImageUrls(urls);
          return;
        }
        void addImageUrls(urls, true).then((outcome) => {
          if (outcome === "network-error") {
            setPendingRemoteDrop({ urls, origins });
          }
        });
      })
      .catch((permissionError: unknown) => {
        setAttachmentError(
          permissionError instanceof Error
            ? permissionError.message
            : "Could not check image-site access.",
        );
      });
    return true;
  };

  const approveRemoteDrop = (): void => {
    if (!pendingRemoteDrop) return;
    // Firefox requires this call to occur directly inside a click handler.
    const permission = chrome.permissions.request({
      origins: [...pendingRemoteDrop.origins],
    });
    const urls = pendingRemoteDrop.urls;
    setPendingRemoteDrop(null);
    void permission.then((granted) => {
      if (!granted) {
        setAttachmentError(
          "Allow access to the image’s website to attach it without saving first.",
        );
        return;
      }
      void addImageUrls(urls);
    }).catch((permissionError: unknown) => {
      setAttachmentError(
        permissionError instanceof Error
          ? permissionError.message
          : "Could not request image-site access.",
      );
    });
  };

  const removePendingImage = useCallback((imageId: string): void => {
    setPendingImages((existing) => {
      const next = existing.filter((image) => image.imageId !== imageId);
      pendingImagesRef.current = next;
      return next;
    });
    void deleteChatImage(chatId, imageId);
  }, [chatId]);

  const submit = (): void => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || busy) return;
    onClearError();
    updateInput("");
    setAttachmentError(null);
    setPendingRemoteDrop(null);
    const images = pendingImages;
    pendingImagesRef.current = [];
    setPendingImages([]);
    onSend([
      ...images.map(createUploadedImagePart),
      ...(text ? [{ type: "text" as const, text }] : []),
    ]);
  };

  useEffect(() => () => {
    for (const image of pendingImagesRef.current) {
      void deleteChatImage(chatId, image.imageId);
    }
    pendingImagesRef.current = [];
  }, [chatId]);

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const images = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    void addImageFiles(images);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setDraggingImages(false);
    // DataTransfer string data is protected outside the synchronous drop job.
    const dropDetails = describeImageDrop(event.dataTransfer);
    void chrome.storage.local.get(DEBUG_LOGGING_STORAGE_KEY).then((stored) => {
      createDebugLogger(
        isDebugLoggingEnabled(stored[DEBUG_LOGGING_STORAGE_KEY]),
        chatId,
      ).group("Image drop payload", dropDetails);
    });
    const images = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length > 0) {
      setPendingRemoteDrop(null);
      void addImageFiles(images);
      return;
    }
    attachDroppedImageUrls(event.dataTransfer);
  };

  return (
    <footer className="composer-area">
      {error ? (
        <div className="chat-error" role="alert">
          <span>{error.message}</span>
          <button type="button" onClick={onRegenerate}>Retry</button>
        </div>
      ) : null}
      {attachmentError ? (
        <div className="attachment-error" role="alert">{attachmentError}</div>
      ) : null}
      {pendingRemoteDrop ? (
        <div className="remote-image-permission" role="status">
          <span>
            Allow access to {pendingRemoteDrop.origins.length === 1
              ? new URL(pendingRemoteDrop.origins[0] ?? "").hostname
              : `${pendingRemoteDrop.origins.length} image sites`}?
          </span>
          <div>
            <button
              disabled={busy}
              onClick={approveRemoteDrop}
              type="button"
            >
              Allow &amp; attach
            </button>
            <button
              onClick={() => setPendingRemoteDrop(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {pendingImages.length > 0 ? (
        <div className="uploaded-image-grid pending-images">
          {pendingImages.map((image) => (
            <StoredImagePreview
              chatId={chatId}
              image={image}
              key={image.imageId}
              onRemove={() => removePendingImage(image.imageId)}
            />
          ))}
        </div>
      ) : null}
      <form
        className={draggingImages ? "composer image-dragging" : "composer"}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDraggingImages(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDraggingImages(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Message GM Tools"
          onChange={(event) => updateInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={handlePaste}
          placeholder="Ask, paste, or drop an image…"
          ref={textareaRef}
          rows={1}
          value={input}
        />
        {busy ? (
          <button
            aria-label="Stop generating"
            className="send-button stop-button"
            onClick={onStop}
            type="button"
          >
            ■
          </button>
        ) : (
          <button
            aria-label="Send message"
            className="send-button"
            disabled={!input.trim() && pendingImages.length === 0}
            type="submit"
          >
            ↑
          </button>
        )}
      </form>
      <div className="composer-meta">
        <span>{modelLabel} via OpenRouter</span>
      </div>
    </footer>
  );
}

function ChatDrawer({
  activities,
  activeChatId,
  chats,
  onClose,
  onCreateChat,
  onDeleteChat,
  onSwitchChat,
}: {
  readonly activities: Readonly<Record<string, ChatActivityStatus>>;
  readonly activeChatId: string;
  readonly chats: readonly ChatRecord[];
  readonly onClose: () => void;
  readonly onCreateChat: () => void;
  readonly onDeleteChat: (chatId: string) => Promise<void>;
  readonly onSwitchChat: (chatId: string) => void;
}): React.JSX.Element {
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteCandidate = chats.find(
    (candidate) => candidate.id === deleteCandidateId,
  );
  const groups = useMemo(() => groupChatsByCampaign(chats), [chats]);

  return (
    <>
      <button
        aria-label="Close chats"
        className="chat-drawer-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside className="chat-drawer" aria-label="Chats">
        <div className="chat-drawer-heading">
          <h2>Chats</h2>
          <button className="new-chat-button" onClick={onCreateChat} type="button">
            <span aria-hidden="true">+</span> New
          </button>
        </div>
        <div className="chat-drawer-list">
          {groups.map((group) => (
            <section className="chat-drawer-group" key={group.key}>
              <h3 title={group.name}>{group.name}</h3>
              {group.chats.map((candidate) => {
                const activity = activities[candidate.id];
                return (
                  <div
                    className={
                      candidate.id === activeChatId
                        ? "chat-drawer-item selected"
                        : "chat-drawer-item"
                    }
                    key={candidate.id}
                  >
                    <button
                      className="chat-drawer-select"
                      onClick={() => onSwitchChat(candidate.id)}
                      type="button"
                    >
                      <strong>{candidate.title}</strong>
                      {activity &&
                      (activity.state !== "unread" ||
                        candidate.id !== activeChatId) ? (
                        <span
                          className={`chat-drawer-activity ${activity.state}`}
                          title={activity.summary}
                        >
                          <span aria-hidden="true" />
                          {activity.state === "working"
                            ? "Working"
                            : activity.state === "unread"
                              ? "New response"
                              : "Thinking"}
                        </span>
                      ) : null}
                    </button>
                    <button
                      aria-label={`Delete ${candidate.title}`}
                      className="chat-drawer-delete"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteCandidateId(candidate.id);
                      }}
                      title="Delete chat"
                      type="button"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </aside>
      {deleteCandidate ? (
        <>
          <button
            aria-label="Cancel chat deletion"
            className="chat-delete-modal-backdrop"
            disabled={deleting}
            onClick={() => setDeleteCandidateId(null)}
            type="button"
          />
          <div
            aria-label="Confirm chat deletion"
            className="chat-delete-confirm"
            role="alertdialog"
          >
            <p
              title={`Delete “${deleteCandidate.title}” from “${deleteCandidate.campaignName ?? "No campaign"}”?`}
            >
              Delete “{deleteCandidate.title}” from “
              {deleteCandidate.campaignName ?? "No campaign"}”?
            </p>
            {deleteError ? (
              <p className="chat-delete-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div>
              <button
                disabled={deleting}
                onClick={() => setDeleteCandidateId(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  setDeleteError(null);
                  void onDeleteChat(deleteCandidate.id)
                    .then(() => setDeleteCandidateId(null))
                    .catch((error: unknown) => {
                      setDeleteError(
                        error instanceof Error
                          ? error.message
                          : "The chat could not be deleted.",
                      );
                    })
                    .finally(() => setDeleting(false));
                }}
                type="button"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function ChatScreen({
  activeProfile,
  chat,
  initialDraft,
  initialMessages,
  initialScrollPosition,
  onCampaignBindingChanged,
  onDraftChange,
  onManageProfiles,
  onOpenChatDrawer,
  onRenameChat,
  onScrollPositionChange,
  onSelectProfile,
  profiles,
}: {
  readonly activeProfile: AssistantProfile;
  readonly chat: ChatRecord;
  readonly initialDraft: string;
  readonly initialMessages: UIMessage[];
  readonly initialScrollPosition: ChatScrollPosition | undefined;
  readonly onCampaignBindingChanged: () => Promise<void>;
  readonly onDraftChange: (chatId: string, draft: string) => void;
  readonly onManageProfiles: () => void;
  readonly onOpenChatDrawer: () => void;
  readonly onRenameChat: (title: string) => void;
  readonly onScrollPositionChange: (
    chatId: string,
    position: ChatScrollPosition,
  ) => void;
  readonly onSelectProfile: (profileId: string) => void;
  readonly profiles: readonly AssistantProfile[];
}): React.JSX.Element {
  const chatId = chat.id;
  const transport = useMemo(
    () => new ExtensionChatTransport(activeProfile.id),
    [activeProfile.id],
  );
  const {
    messages,
    sendMessage,
    regenerate,
    resumeStream,
    stop,
    status,
    error,
    clearError,
    setMessages,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    throttle: 40,
    resume: true,
  });
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>(() =>
    chat.campaignId && chat.campaignName
      ? {
          chatId,
          state: "disconnected",
          campaignId: chat.campaignId,
          name: chat.campaignName,
        }
      : { chatId, state: "unbound" },
  );
  const [campaignActionPending, setCampaignActionPending] = useState<
    "attach" | "detach" | null
  >(null);
  const [campaignActionFeedback, setCampaignActionFeedback] = useState<
    string | null
  >(null);
  const [campaignCandidates, setCampaignCandidates] = useState<
    readonly CampaignCandidate[]
  >([]);
  const activeTurnRef = useRef(false);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const handleCampaignStatus = (message: unknown): void => {
      if (
        isCampaignStatusChangedMessage(message) &&
        message.status.chatId === chatId
      ) {
        setCampaignStatus(message.status);
      }
    };
    chrome.runtime.onMessage.addListener(handleCampaignStatus);
    return () => {
      chrome.runtime.onMessage.removeListener(handleCampaignStatus);
    };
  }, [chatId]);

  const campaignLabel =
    campaignStatus.campaignId && campaignStatus.name
      ? campaignStatus.name
      : "No campaign attached";
  const campaignBound = Boolean(
    campaignStatus.campaignId && campaignStatus.name,
  );

  useEffect(() => {
    if (campaignCandidates.length <= 1) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setCampaignCandidates([]);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [campaignCandidates.length]);

  const attachCandidate = async (
    candidate: CampaignCandidate,
  ): Promise<void> => {
    setCampaignCandidates([]);
    setCampaignActionPending("attach");
    setCampaignActionFeedback(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CAMPAIGN_ATTACH_REQUEST,
        chatId,
        candidate,
      });
      if (!isCampaignStatusResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      setCampaignStatus(response.status);
      if (response.status.campaignId && response.status.name) {
        await onCampaignBindingChanged();
      } else {
        setCampaignActionFeedback(
          response.status.detail ?? "The campaign could not be attached.",
        );
      }
    } catch (actionError) {
      setCampaignActionFeedback(
        actionError instanceof Error
          ? actionError.message
          : "The campaign binding could not be changed.",
      );
    } finally {
      setCampaignActionPending(null);
    }
  };

  const beginAttach = async (): Promise<void> => {
    setCampaignActionPending("attach");
    setCampaignActionFeedback(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CAMPAIGN_CANDIDATES_REQUEST,
        chatId,
      });
      if (!isCampaignCandidatesResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      if (response.candidates.length === 0) {
        setCampaignActionFeedback(
          "No campaign is available. Open a Roll20 campaign as its GM, or keep another chat attached to it.",
        );
        return;
      }
      if (response.candidates.length === 1) {
        await attachCandidate(response.candidates[0]!);
        return;
      }
      setCampaignCandidates(response.candidates);
    } catch (actionError) {
      setCampaignActionFeedback(
        actionError instanceof Error
          ? actionError.message
          : "Campaign candidates could not be loaded.",
      );
    } finally {
      setCampaignActionPending(null);
    }
  };

  const detach = async (): Promise<void> => {
    setCampaignActionPending("detach");
    setCampaignActionFeedback(null);
    setCampaignCandidates([]);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CAMPAIGN_DETACH_REQUEST,
        chatId,
      });
      if (!isCampaignStatusResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      setCampaignStatus(response.status);
      if (response.status.state === "unbound") {
        await onCampaignBindingChanged();
      } else {
        setCampaignActionFeedback(
          response.status.detail ?? "The campaign could not be detached.",
        );
      }
    } catch (actionError) {
      setCampaignActionFeedback(
        actionError instanceof Error
          ? actionError.message
          : "The campaign could not be detached.",
      );
    } finally {
      setCampaignActionPending(null);
    }
  };

  useEffect(() => {
    if (status === "submitted") {
      activeTurnRef.current = true;
      return;
    }
    if (status === "streaming") {
      activeTurnRef.current = true;
      return;
    }
    if (status === "ready" && activeTurnRef.current) {
      activeTurnRef.current = false;
      sendChatControl(CHAT_COMMIT, chatId);
    }
  }, [chatId, messages, status]);

  const stopGeneration = (): void => {
    activeTurnRef.current = false;
    stop();
    setMessages((current) => sanitizeStoppedConversation(current));
  };

  const continueTask = (): void => {
    transport.continueConversation();
    void resumeStream();
  };

  const selectProfile = (profileId: string): void => {
    if (profileId === activeProfile.id) return;
    onSelectProfile(profileId);
  };

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div className="chat-title-row">
          <button
            aria-label="Open chats"
            className="chat-menu-button"
            onClick={onOpenChatDrawer}
            title="Open chats"
            type="button"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className="campaign-title-group">
            <h1
              aria-label={`Campaign: ${campaignLabel}`}
              className={campaignBound ? "bound" : "unbound"}
              title={campaignLabel}
            >
              {campaignLabel}
            </h1>
            <button
              className="campaign-action-button"
              disabled={busy || campaignActionPending !== null}
              onClick={() => void (campaignBound ? detach() : beginAttach())}
              title={
                campaignBound
                  ? "Detach this chat from its Roll20 campaign"
                  : "Attach this chat to a Roll20 campaign"
              }
              type="button"
            >
              {campaignActionPending === "attach"
                ? "Attaching…"
                : campaignActionPending === "detach"
                  ? "Detaching…"
                  : campaignBound
                    ? "Detach"
                    : "Attach"}
            </button>
          </div>
          <button
            className="chat-settings-button"
            type="button"
            onClick={onManageProfiles}
          >
            Settings
          </button>
        </div>
        {campaignActionFeedback ? (
          <p className="campaign-action-feedback" role="status">
            {campaignActionFeedback}
          </p>
        ) : null}
        <div className="chat-context-row">
          <ChatNameEditor onRename={onRenameChat} title={chat.title} />
          <select
            aria-label="Assistant profile for this chat"
            onChange={(event) => selectProfile(event.target.value)}
            value={activeProfile.id}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {campaignCandidates.length > 1 ? (
        <>
          <button
            aria-label="Cancel campaign selection"
            className="campaign-candidate-backdrop"
            onClick={() => setCampaignCandidates([])}
            type="button"
          />
          <div
            aria-labelledby="campaign-candidate-heading"
            aria-modal="true"
            className="campaign-candidate-picker"
            role="dialog"
          >
            <h2 id="campaign-candidate-heading">Attach this chat to</h2>
            <div className="campaign-candidate-list">
              {campaignCandidates.map((candidate, index) => (
                <button
                  autoFocus={index === 0}
                  key={candidate.campaignId}
                  onClick={() => void attachCandidate(candidate)}
                  type="button"
                >
                  <span>{candidate.name}</span>
                  <small>
                    {candidate.activeTab
                      ? "Current tab"
                      : candidate.tabId !== undefined
                        ? "Open Roll20 tab"
                        : "Existing chat"}
                  </small>
                </button>
              ))}
            </div>
            <button
              className="campaign-candidate-cancel"
              onClick={() => setCampaignCandidates([])}
              type="button"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      <ConversationPane
        chatId={chatId}
        continuation={chat.continuation}
        initialScrollPosition={initialScrollPosition}
        messages={messages}
        notices={chat.notices}
        onContinue={continueTask}
        onScrollPositionChange={onScrollPositionChange}
        status={status}
      />
      <ChatComposer
        busy={busy}
        chatId={chatId}
        error={error}
        initialDraft={initialDraft}
        modelLabel={getModelSelectionLabel(activeProfile.modelSelection)}
        onClearError={clearError}
        onDraftChange={onDraftChange}
        onRegenerate={() => void regenerate()}
        onSend={(parts) => void sendMessage({ parts })}
        onStop={stopGeneration}
      />
    </main>
  );
}

function ChatWorkspace(): React.JSX.Element {
  const [profiles, setProfiles] = useState<AssistantProfile[] | null>(null);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [chatActivities, setChatActivities] = useState<
    Record<string, ChatActivityStatus>
  >({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [transientNotice, setTransientNotice] = useState<string | null>(null);
  const [storedChat, setStoredChat] = useState<{
    readonly chat: ChatRecord;
    readonly messages: UIMessage[];
  } | null>(null);
  const storedChatRef = useRef<typeof storedChat>(null);
  const draftsRef = useRef(createChatDraftStore());
  const noticeTimeoutRef = useRef<number | undefined>(undefined);

  const setCurrentChat = useCallback((value: typeof storedChat): void => {
    storedChatRef.current = value;
    setStoredChat(value);
  }, []);

  const updateDraft = useCallback((chatId: string, draft: string): void => {
    draftsRef.current.set(chatId, draft);
  }, []);

  const updateScrollPosition = useCallback(
    (chatId: string, position: ChatScrollPosition): void => {
      draftsRef.current.setScrollPosition(chatId, position);
    },
    [],
  );

  const showTransientNotice = useCallback((notice: string): void => {
    setTransientNotice(notice);
    if (noticeTimeoutRef.current !== undefined) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setTransientNotice(null);
      noticeTimeoutRef.current = undefined;
    }, 4_000);
  }, []);

  useEffect(() => () => {
    if (noticeTimeoutRef.current !== undefined) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
  }, []);

  const fallbackMissingProfile = useCallback(async (
    chat: ChatRecord,
    loadedProfiles: readonly AssistantProfile[],
  ): Promise<ChatRecord> => {
    if (loadedProfiles.some((profile) => profile.id === chat.profileId)) {
      return chat;
    }
    const notice: ChatNotice = {
      id: crypto.randomUUID(),
      kind: "profile-fallback",
      text:
        "The previous profile is no longer available. This chat now uses General.",
      createdAt: Date.now(),
    };
    return updateChatProfile(chat.id, DEFAULT_PROFILE.id, notice);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async (): Promise<void> => {
      const stored = await chrome.storage.local.get([
        PROFILES_STORAGE_KEY,
        ACTIVE_CHAT_STORAGE_KEY,
      ]);
      const loadedProfiles = normalizeProfiles(stored[PROFILES_STORAGE_KEY]);
      const activeChatId = stored[ACTIVE_CHAT_STORAGE_KEY];
      const existingChats = await listChats();
      let loaded =
        typeof activeChatId === "string"
          ? await getStoredChat(activeChatId)
          : undefined;
      if (!loaded) {
        const existing = existingChats[0];
        loaded = existing
          ? await getStoredChat(existing.id)
          : await createChat(DEFAULT_PROFILE.id);
      }
      if (!loaded) throw new Error("Could not load the active chat.");
      await acknowledgeCompletedChat(loaded.chat.id);
      loaded = (await getStoredChat(loaded.chat.id)) ?? loaded;
      const chat = await fallbackMissingProfile(loaded.chat, loadedProfiles);
      const validation = await safeValidateUIMessages<UIMessage>({
        messages: loaded.messages,
      });
      const messages = validation.success ? validation.data : [];
      await chrome.storage.local.set({ [ACTIVE_CHAT_STORAGE_KEY]: chat.id });
      if (cancelled) return;
      setProfiles(loadedProfiles);
      setChats(await listChats());
      setCurrentChat({ chat, messages });
    };

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== "local" || !(PROFILES_STORAGE_KEY in changes)) return;
      const loadedProfiles = normalizeProfiles(
        changes[PROFILES_STORAGE_KEY]?.newValue,
      );
      setProfiles(loadedProfiles);
      const current = storedChatRef.current;
      if (!current) return;
      void fallbackMissingProfile(current.chat, loadedProfiles).then((chat) => {
        if (
          !cancelled &&
          storedChatRef.current?.chat.id === current.chat.id
        ) {
          setCurrentChat({ ...storedChatRef.current, chat });
          setChats((existing) =>
            existing.map((candidate) =>
              candidate.id === chat.id ? chat : candidate,
            ),
          );
        }
      });
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    void initialize().catch(() => {
      if (!cancelled) {
        setProfiles([DEFAULT_PROFILE]);
      }
    });
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [fallbackMissingProfile, setCurrentChat]);

  useEffect(() => {
    let cancelled = false;
    const handleActivity = (message: unknown): void => {
      if (!isChatActivityChangedMessage(message)) return;
      setChatActivities((current) => {
        const next = { ...current };
        if (message.activity.state === "idle") {
          delete next[message.activity.chatId];
        } else {
          next[message.activity.chatId] = message.activity;
        }
        return next;
      });
    };
    chrome.runtime.onMessage.addListener(handleActivity);
    void chrome.runtime
      .sendMessage({ type: CHAT_ACTIVITIES_REQUEST })
      .then((response: unknown) => {
        if (cancelled || !isChatActivitiesResponse(response) || !response.ok) {
          return;
        }
        setChatActivities(
          Object.fromEntries(
            response.activities
              .filter((activity) => activity.state !== "idle")
              .map((activity) => [activity.chatId, activity]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleActivity);
    };
  }, []);

  useEffect(() => {
    const handleContinuation = (message: unknown): void => {
      if (!isChatContinuationChangedMessage(message)) return;
      setChats((current) =>
        current.map((chat) =>
          chat.id === message.chatId
            ? withChatContinuation(chat, message.continuation)
            : chat,
        ),
      );
      const current = storedChatRef.current;
      if (!current || current.chat.id !== message.chatId) return;
      setCurrentChat({
        ...current,
        chat: withChatContinuation(current.chat, message.continuation),
      });
    };
    chrome.runtime.onMessage.addListener(handleContinuation);
    return () => chrome.runtime.onMessage.removeListener(handleContinuation);
  }, [setCurrentChat]);

  if (!profiles || !storedChat) return <LoadingScreen />;
  const activeProfile =
    profiles.find((profile) => profile.id === storedChat.chat.profileId) ??
    DEFAULT_PROFILE;

  const selectProfile = (profileId: string): void => {
    if (
      profileId === activeProfile.id ||
      !profiles.some((profile) => profile.id === profileId)
    ) {
      return;
    }
    void updateChatProfile(storedChat.chat.id, profileId).then((chat) => {
      if (storedChatRef.current?.chat.id === chat.id) {
        setCurrentChat({ ...storedChatRef.current, chat });
      }
      setChats((existing) =>
        existing.map((candidate) =>
          candidate.id === chat.id ? chat : candidate,
        ),
      );
    });
  };

  const activateStoredChat = async (
    loaded: NonNullable<Awaited<ReturnType<typeof getStoredChat>>>,
  ): Promise<void> => {
    const chat = await fallbackMissingProfile(loaded.chat, profiles);
    const validation = await safeValidateUIMessages<UIMessage>({
      messages: loaded.messages,
    });
    const messages = validation.success ? validation.data : [];
    await chrome.storage.local.set({ [ACTIVE_CHAT_STORAGE_KEY]: chat.id });
    setCurrentChat({ chat, messages });
    setChats(await listChats());
  };

  const switchChat = (chatId: string): void => {
    if (chatId === storedChat.chat.id) return;
    void (async () => {
      await acknowledgeCompletedChat(chatId);
      const loaded = await getStoredChat(chatId);
      if (loaded) {
        await activateStoredChat(loaded);
        setDrawerOpen(false);
      }
    })();
  };

  const createNewChat = (): void => {
    void createChat(storedChat.chat.profileId).then(async (created) => {
      await activateStoredChat(created);
      setDrawerOpen(false);
    });
  };

  const renameCurrentChat = (title: string): void => {
    void renameChat(storedChat.chat.id, title).then((chat) => {
      if (storedChatRef.current?.chat.id === chat.id) {
        setCurrentChat({ ...storedChatRef.current, chat });
      }
      setChats((existing) =>
        [chat, ...existing.filter((candidate) => candidate.id !== chat.id)],
      );
    });
  };

  const refreshCurrentChatBinding = async (): Promise<void> => {
    const current = storedChatRef.current;
    if (!current) return;
    const refreshed = await getStoredChat(current.chat.id);
    if (!refreshed || storedChatRef.current?.chat.id !== current.chat.id) return;
    setCurrentChat({ ...current, chat: refreshed.chat });
    setChats(await listChats());
  };

  const removeChat = async (chatId: string): Promise<void> => {
    const deleted = chats.find((chat) => chat.id === chatId);
    const nextChatId = nextChatIdAfterDeletion(chats, chatId);
    sendChatControl(CHAT_CLEAR, chatId);
    draftsRef.current.delete(chatId);
    await deleteChat(chatId);
    const remaining = await listChats();
    if (chatId !== storedChat.chat.id) {
      setChats(remaining);
      return;
    }
    const nextId =
      nextChatId && remaining.some((chat) => chat.id === nextChatId)
        ? nextChatId
        : remaining[0]?.id;
    const next = nextId ? await getStoredChat(nextId) : undefined;
    if (next) {
      await activateStoredChat(next);
      return;
    }
    const replacement = await createChat(storedChat.chat.profileId);
    await activateStoredChat(replacement);
    setDrawerOpen(false);
    showTransientNotice(
      `Deleted “${deleted?.title ?? "chat"}” and started a new chat.`,
    );
  };

  const openDrawer = (): void => {
    setDrawerOpen(true);
    void listChats().then(setChats);
  };

  return (
    <div className="chat-workspace">
      <ChatScreen
        activeProfile={activeProfile}
        chat={storedChat.chat}
        initialDraft={draftsRef.current.get(storedChat.chat.id)}
        initialMessages={storedChat.messages}
        initialScrollPosition={draftsRef.current.getScrollPosition(
          storedChat.chat.id,
        )}
        key={storedChat.chat.id}
        onCampaignBindingChanged={refreshCurrentChatBinding}
        onDraftChange={updateDraft}
        onManageProfiles={() => void chrome.runtime.openOptionsPage()}
        onOpenChatDrawer={openDrawer}
        onRenameChat={renameCurrentChat}
        onScrollPositionChange={updateScrollPosition}
        onSelectProfile={selectProfile}
        profiles={profiles}
      />
      {drawerOpen ? (
        <ChatDrawer
          activities={chatActivities}
          activeChatId={storedChat.chat.id}
          chats={chats}
          onClose={() => setDrawerOpen(false)}
          onCreateChat={createNewChat}
          onDeleteChat={removeChat}
          onSwitchChat={switchChat}
        />
      ) : null}
      {transientNotice ? (
        <div className="workspace-toast" role="status">
          {transientNotice}
        </div>
      ) : null}
    </div>
  );
}

function App(): React.JSX.Element {
  useDisplayTheme();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sendAuthRequest({ type: AUTH_STATUS_REQUEST })
      .then((status) => {
        if (!cancelled) setAuthStatus(status);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAuthStatus({ connected: false, persistent: false });
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not read the login state.",
          );
        }
      });

    const handleMessage = (message: unknown): void => {
      if (isAuthStateChangedMessage(message)) setAuthStatus(message.status);
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const connect = (): void => {
    setConnecting(true);
    setError(null);
    void sendAuthRequest({ type: AUTH_CONNECT_REQUEST })
      .then(setAuthStatus)
      .catch((requestError: unknown) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not connect to OpenRouter.",
        ),
      )
      .finally(() => setConnecting(false));
  };

  if (!authStatus) return <LoadingScreen />;
  if (!authStatus.connected) {
    return (
      <LoginScreen connecting={connecting} error={error} onConnect={connect} />
    );
  }
  return <ChatWorkspace />;
}

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("Missing side-panel root element.");
createRoot(rootElement).render(<App />);
