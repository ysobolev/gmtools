import { useChat } from "@ai-sdk/react";
import { safeValidateUIMessages, type UIMessage } from "ai";
import {
  FormEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  countMarkdownImageReferences,
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
  ACTIVE_CHAT_STORAGE_KEY,
  MAX_CHAT_TITLE_LENGTH,
  clearChatContent,
  createChat,
  deleteChat,
  deleteChatImage,
  getChatImage,
  getStoredChat,
  listChats,
  renameChat,
  saveChatMessages,
  saveChatImage,
  updateChatProfile,
  type ChatNotice,
  type ChatRecord,
} from "./chat-store";
import {
  MAX_PENDING_IMAGES,
  MAX_UPLOADED_IMAGE_BYTES,
  createUploadedImagePart,
  isSupportedUploadedImageType,
  isUploadedImagePart,
  type UploadedImageReference,
} from "./chat-images";
import {
  applyDisplayTheme,
  DEFAULT_DISPLAY_THEME,
  DISPLAY_THEME_STORAGE_KEY,
  isDisplayTheme,
  type DisplayTheme,
} from "./display-settings";
import { ExtensionChatTransport } from "./extension-chat-transport";
import {
  DEFAULT_PROFILE,
  getModelDefinition,
  normalizeProfiles,
  PROFILES_STORAGE_KEY,
  type AssistantProfile,
} from "./profile-config";
import {
  AUTH_CONNECT_REQUEST,
  AUTH_STATE_CHANGED,
  AUTH_STATUS_REQUEST,
  CAMPAIGN_ATTACH_REQUEST,
  CAMPAIGN_DETACH_REQUEST,
  CAMPAIGN_STATUS_REQUEST,
  CHAT_ACTIVITIES_REQUEST,
  CHAT_CLEAR,
  CHAT_COMMIT,
  isAuthResponse,
  isAuthStateChangedMessage,
  isCampaignStatusChangedMessage,
  isCampaignStatusResponse,
  isChatActivitiesResponse,
  isChatActivityChangedMessage,
  type AuthRequest,
  type AuthStatus,
  type CampaignStatus,
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

interface CampaignChatGroup {
  readonly key: string;
  readonly name: string;
  readonly chats: ChatRecord[];
}

function groupChatsByCampaign(
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

function UploadedImagePreview({
  chatId,
  image,
  onRemove,
}: {
  readonly chatId: string;
  readonly image: UploadedImageReference;
  readonly onRemove?: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void getChatImage(chatId, image.imageId).then((stored) => {
      if (!active || !stored) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatId, image.imageId]);

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
        : "Failed";
  return (
    <ul className="tool-receipts inline">
      <li
        aria-label={`${label}: ${receipt.summary}`}
        className={`tool-receipt ${receipt.status}`}
      >
        <span aria-hidden="true" className="tool-receipt-icon">
          {receipt.status === "working"
            ? "…"
            : receipt.status === "completed"
              ? "✓"
              : "✕"}
        </span>
        <span>{receipt.summary}</span>
      </li>
    </ul>
  );
}

function createMarkdownComponents(
  generatedImages: readonly DisplayableAssistantImage[] = [],
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
        <GeneratedImage alt={alt ?? undefined} image={generatedImage} />
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

function ChatScreen({
  activeProfile,
  chat,
  chatActivities,
  chats,
  initialMessages,
  onClearConversation,
  onCampaignBindingChanged,
  onCreateChat,
  onDeleteChat,
  onManageProfiles,
  onOpenChats,
  onRenameChat,
  onSelectProfile,
  onSwitchChat,
  profiles,
}: {
  readonly activeProfile: AssistantProfile;
  readonly chat: ChatRecord;
  readonly chatActivities: Readonly<Record<string, ChatActivityStatus>>;
  readonly chats: readonly ChatRecord[];
  readonly initialMessages: UIMessage[];
  readonly onClearConversation: () => void;
  readonly onCampaignBindingChanged: () => Promise<void>;
  readonly onCreateChat: () => void;
  readonly onDeleteChat: (chatId: string) => void;
  readonly onManageProfiles: () => void;
  readonly onOpenChats: () => void;
  readonly onRenameChat: (title: string) => void;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onSwitchChat: (chatId: string) => void;
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
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<UploadedImageReference[]>(
    [],
  );
  const pendingImagesRef = useRef<UploadedImageReference[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingImages, setDraggingImages] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(chat.title);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(
    null,
  );
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>({
    chatId,
    state: "connecting",
  });
  const [campaignActionPending, setCampaignActionPending] = useState<
    "attach" | "detach" | null
  >(null);
  const [campaignActionFeedback, setCampaignActionFeedback] = useState<
    string | null
  >(null);
  const activeTurnRef = useRef(false);
  const safeMessagesRef = useRef(initialMessages);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const activity = getChatActivity(status, messages);
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const inlineRoll20Working = latestAssistantMessage
    ? hasActiveRoll20Status(latestAssistantMessage)
    : false;
  const deleteCandidate = chats.find(
    (candidate) => candidate.id === deleteCandidateId,
  );
  const campaignChatGroups = useMemo(
    () => groupChatsByCampaign(chats),
    [chats],
  );

  const persistMessages = useCallback((nextMessages: UIMessage[]) => {
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => saveChatMessages(chatId, nextMessages));
    return persistenceQueueRef.current;
  }, [chatId]);

  useEffect(() => {
    let active = true;
    const handleCampaignStatus = (message: unknown): void => {
      if (
        active &&
        isCampaignStatusChangedMessage(message) &&
        message.status.chatId === chatId
      ) {
        setCampaignStatus(message.status);
      }
    };
    chrome.runtime.onMessage.addListener(handleCampaignStatus);
    void chrome.runtime
      .sendMessage({ type: CAMPAIGN_STATUS_REQUEST, chatId })
      .then((response: unknown) => {
        if (!active) return;
        if (isCampaignStatusResponse(response) && response.ok) {
          setCampaignStatus(response.status);
        }
      })
      .catch(() => {
        if (active) {
          setCampaignStatus({
            chatId,
            state: "unavailable",
            detail: "Could not contact the extension service worker.",
          });
        }
      });
    return () => {
      active = false;
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

  const changeCampaignBinding = async (
    action: "attach" | "detach",
  ): Promise<void> => {
    setCampaignActionPending(action);
    setCampaignActionFeedback(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type:
          action === "attach"
            ? CAMPAIGN_ATTACH_REQUEST
            : CAMPAIGN_DETACH_REQUEST,
        chatId,
      });
      if (!isCampaignStatusResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      setCampaignStatus(response.status);
      const succeeded =
        action === "attach"
          ? response.status.state === "connected"
          : response.status.state === "unbound";
      if (succeeded) {
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

  useEffect(() => {
    if (status === "submitted") {
      activeTurnRef.current = true;
      safeMessagesRef.current = messages;
      void persistMessages(messages);
      return;
    }
    if (status === "streaming") {
      activeTurnRef.current = true;
      return;
    }
    if (status === "ready" && activeTurnRef.current) {
      activeTurnRef.current = false;
      safeMessagesRef.current = messages;
      void persistMessages(messages)
        .then(() => sendChatControl(CHAT_COMMIT, chatId));
    }
  }, [chatId, messages, persistMessages, status]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" });
  }, [busy, messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    setTitleDraft(chat.title);
    setEditingTitle(false);
  }, [chat.id, chat.title]);

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

  const removePendingImage = useCallback((imageId: string): void => {
    setPendingImages((existing) => {
      const next = existing.filter((image) => image.imageId !== imageId);
      pendingImagesRef.current = next;
      return next;
    });
    void deleteChatImage(chatId, imageId);
  }, [chatId]);

  const submit = useCallback(() => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || busy) return;
    clearError();
    setInput("");
    setAttachmentError(null);
    const images = pendingImages;
    pendingImagesRef.current = [];
    setPendingImages([]);
    void sendMessage({
      parts: [
        ...images.map(createUploadedImagePart),
        ...(text ? [{ type: "text" as const, text }] : []),
      ],
    });
  }, [busy, clearError, input, pendingImages, sendMessage]);

  useEffect(() => () => {
    for (const image of pendingImagesRef.current) {
      void deleteChatImage(chatId, image.imageId);
    }
    pendingImagesRef.current = [];
  }, [chatId]);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

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
    const images = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length > 0) void addImageFiles(images);
  };

  const clearConversation = (): void => {
    stop();
    clearError();
    sendChatControl(CHAT_CLEAR, chatId);
    onClearConversation();
  };

  const stopGeneration = (): void => {
    activeTurnRef.current = false;
    stop();
    window.setTimeout(() => setMessages(safeMessagesRef.current), 0);
  };

  const selectProfile = (profileId: string): void => {
    if (profileId === activeProfile.id) return;
    onSelectProfile(profileId);
  };

  const toggleChatMenu = (): void => {
    setMenuOpen((open) => {
      if (!open) onOpenChats();
      return !open;
    });
    setDeleteCandidateId(null);
  };

  const switchChat = (nextChatId: string): void => {
    if (nextChatId !== chatId) onSwitchChat(nextChatId);
    setMenuOpen(false);
    setDeleteCandidateId(null);
  };

  const beginRename = (): void => {
    setTitleDraft(chat.title);
    setEditingTitle(true);
  };

  const submitRename = (): void => {
    const title = titleDraft.trim();
    if (!title) return;
    if (title !== chat.title) onRenameChat(title);
    setEditingTitle(false);
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename();
    } else if (event.key === "Escape") {
      setTitleDraft(chat.title);
      setEditingTitle(false);
    }
  };

  return (
    <main className="chat-shell">
      {menuOpen ? (
        <>
          <button
            aria-label="Close chats"
            className="chat-drawer-backdrop"
            onClick={toggleChatMenu}
            type="button"
          />
          <aside className="chat-drawer" aria-label="Chats">
            <div className="chat-drawer-heading">
              <h2>Chats</h2>
              <button
                className="new-chat-button"
                onClick={() => {
                  onCreateChat();
                  setMenuOpen(false);
                }}
                type="button"
              >
                <span aria-hidden="true">+</span> New
              </button>
            </div>
            <div className="chat-drawer-list">
              {campaignChatGroups.map((group) => (
                <section className="chat-drawer-group" key={group.key}>
                  <h3 title={group.name}>{group.name}</h3>
                  {group.chats.map((candidate) => {
                    const drawerActivity = chatActivities[candidate.id];
                    return (
                      <div
                        className={
                          candidate.id === chatId
                            ? "chat-drawer-item selected"
                            : "chat-drawer-item"
                        }
                        key={candidate.id}
                      >
                        <button
                          className="chat-drawer-select"
                          onClick={() => switchChat(candidate.id)}
                          type="button"
                        >
                          <strong>{candidate.title}</strong>
                          {drawerActivity &&
                          (drawerActivity.state !== "unread" ||
                            candidate.id !== chatId) ? (
                            <span
                              className={`chat-drawer-activity ${drawerActivity.state}`}
                              title={drawerActivity.summary}
                          >
                            <span aria-hidden="true" />
                            {drawerActivity.state === "working"
                              ? "Working"
                              : drawerActivity.state === "unread"
                                ? "New response"
                                : "Thinking"}
                            </span>
                          ) : null}
                        </button>
                        <button
                          aria-label={`Delete ${candidate.title}`}
                          className="chat-drawer-delete"
                          onClick={() => setDeleteCandidateId(candidate.id)}
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
                <div>
                  <button
                    onClick={() => setDeleteCandidateId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      onDeleteChat(deleteCandidate.id);
                      setDeleteCandidateId(null);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <header className="chat-header">
        <div className="chat-title-row">
          <button
            aria-label="Open chats"
            className="chat-menu-button"
            onClick={toggleChatMenu}
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
              onClick={() =>
                void changeCampaignBinding(
                  campaignBound ? "detach" : "attach",
                )
              }
              title={
                campaignBound
                  ? "Detach this chat from its Roll20 campaign"
                  : "Attach this chat to the active Roll20 campaign"
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
          {editingTitle ? (
            <span className="chat-name chat-name-editor">
              <input
                aria-label="Chat title"
                autoFocus
                maxLength={MAX_CHAT_TITLE_LENGTH}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                value={titleDraft}
              />
              <button
                aria-label="Save chat title"
                className="chat-name-edit"
                disabled={!titleDraft.trim()}
                onClick={submitRename}
                type="button"
              >
                <span aria-hidden="true">✓</span>
              </button>
              <button
                aria-label="Cancel editing chat title"
                className="chat-name-edit"
                onClick={() => setEditingTitle(false)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ) : (
            <span className="chat-name">
              <span className="chat-name-text">{chat.title}</span>
              <button
                aria-label="Edit chat title"
                className="chat-name-edit"
                onClick={beginRename}
                title="Edit chat title"
                type="button"
              >
                <span aria-hidden="true">✎</span>
              </button>
            </span>
          )}
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

      <section className="conversation" aria-live="polite">
        {chat.notices.map((notice) => (
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
              const embeddedImageCount = Math.min(
                images.length,
                countMarkdownImageReferences(text),
              );
              const embeddedImages = images.slice(0, embeddedImageCount);
              const trailingImages = images.slice(embeddedImageCount);
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
                uploadedImages.length === 0
              ) {
                return null;
              }
              return (
                <article
                  className={`message ${message.role}`}
                  key={message.id}
                >
                  <p className="message-author">
                    {message.role === "user" ? "You" : "GM Tools"}
                  </p>
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
                            components={createMarkdownComponents(blockImages)}
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
                            <UploadedImagePreview
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
                    <GeneratedImage
                      image={image}
                      key={`${image.url.slice(0, 80)}:${index}`}
                    />
                  ))}
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
          </div>
        )}
        <div ref={endRef} />
      </section>

      <footer className="composer-area">
        {error ? (
          <div className="chat-error" role="alert">
            <span>{error.message}</span>
            <button type="button" onClick={() => void regenerate()}>
              Retry
            </button>
          </div>
        ) : null}
        {attachmentError ? (
          <div className="attachment-error" role="alert">
            {attachmentError}
          </div>
        ) : null}
        {pendingImages.length > 0 ? (
          <div className="uploaded-image-grid pending-images">
            {pendingImages.map((image) => (
              <UploadedImagePreview
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
          onSubmit={handleSubmit}
        >
          <textarea
            aria-label="Message GM Tools"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
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
              onClick={stopGeneration}
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
          <span>
            {getModelDefinition(activeProfile.modelId).label} via OpenRouter
          </span>
          <button type="button" onClick={clearConversation}>
            Clear chat
          </button>
        </div>
      </footer>
    </main>
  );
}

function ChatWorkspace(): React.JSX.Element {
  const [profiles, setProfiles] = useState<AssistantProfile[] | null>(null);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [chatActivities, setChatActivities] = useState<
    Record<string, ChatActivityStatus>
  >({});
  const [chatResetRevision, setChatResetRevision] = useState(0);
  const [storedChat, setStoredChat] = useState<{
    readonly chat: ChatRecord;
    readonly messages: UIMessage[];
  } | null>(null);
  const storedChatRef = useRef<typeof storedChat>(null);

  const setCurrentChat = useCallback((value: typeof storedChat): void => {
    storedChatRef.current = value;
    setStoredChat(value);
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

  const clearChat = useCallback((): void => {
    const current = storedChatRef.current;
    if (!current) return;
    void clearChatContent(current.chat.id).then((chat) => {
      setCurrentChat({ chat, messages: [] });
      setChats((existing) =>
        [chat, ...existing.filter((candidate) => candidate.id !== chat.id)],
      );
      setChatResetRevision((revision) => revision + 1);
    });
  }, [setCurrentChat]);

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
      if (!validation.success) await saveChatMessages(chat.id, messages);
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
    if (!validation.success) await saveChatMessages(chat.id, messages);
    await chrome.storage.local.set({ [ACTIVE_CHAT_STORAGE_KEY]: chat.id });
    setCurrentChat({ chat, messages });
    setChats(await listChats());
  };

  const switchChat = (chatId: string): void => {
    if (chatId === storedChat.chat.id) return;
    void (async () => {
      await acknowledgeCompletedChat(chatId);
      const loaded = await getStoredChat(chatId);
      if (loaded) await activateStoredChat(loaded);
    })();
  };

  const createNewChat = (): void => {
    void createChat(storedChat.chat.profileId).then(activateStoredChat);
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

  const removeChat = (chatId: string): void => {
    sendChatControl(CHAT_CLEAR, chatId);
    void deleteChat(chatId).then(async () => {
      let remaining = await listChats();
      if (chatId !== storedChat.chat.id) {
        setChats(remaining);
        return;
      }
      let next = remaining[0]
        ? await getStoredChat(remaining[0].id)
        : undefined;
      if (!next) {
        next = await createChat(storedChat.chat.profileId);
        remaining = [next.chat];
      }
      setChats(remaining);
      await activateStoredChat(next);
    });
  };

  return (
    <ChatScreen
      activeProfile={activeProfile}
      chat={storedChat.chat}
      chatActivities={chatActivities}
      chats={chats}
      initialMessages={storedChat.messages}
      key={`${storedChat.chat.id}:${chatResetRevision}`}
      onCampaignBindingChanged={refreshCurrentChatBinding}
      onClearConversation={clearChat}
      onCreateChat={createNewChat}
      onDeleteChat={removeChat}
      onManageProfiles={() => void chrome.runtime.openOptionsPage()}
      onOpenChats={() => void listChats().then(setChats)}
      onRenameChat={renameCurrentChat}
      onSelectProfile={selectProfile}
      onSwitchChat={switchChat}
      profiles={profiles}
    />
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
