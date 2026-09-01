import { useChat } from "@ai-sdk/react";
import { safeValidateUIMessages, type UIMessage } from "ai";
import {
  FormEvent,
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
import { getChatActivity, getRoll20Receipts } from "./chat-activity";
import {
  ACTIVE_CHAT_STORAGE_KEY,
  MAX_CHAT_TITLE_LENGTH,
  clearChatContent,
  createChat,
  deleteChat,
  getStoredChat,
  listChats,
  renameChat,
  saveChatMessages,
  updateChatProfile,
  type ChatNotice,
  type ChatRecord,
} from "./chat-store";
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
  CAMPAIGN_STATUS_REQUEST,
  CHAT_CLEAR,
  CHAT_COMMIT,
  isAuthResponse,
  isAuthStateChangedMessage,
  isCampaignStatusChangedMessage,
  isCampaignStatusResponse,
  type AuthRequest,
  type AuthStatus,
  type CampaignStatus,
} from "./openrouter-protocol";

function sendChatControl(
  type: typeof CHAT_CLEAR | typeof CHAT_COMMIT,
  chatId: string,
): void {
  void chrome.runtime.sendMessage({ type, chatId }).catch(() => undefined);
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
  chats,
  initialMessages,
  onClearConversation,
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
  readonly chats: readonly ChatRecord[];
  readonly initialMessages: UIMessage[];
  readonly onClearConversation: () => void;
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
  const activeTurnRef = useRef(false);
  const safeMessagesRef = useRef(initialMessages);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const activity = getChatActivity(status, messages);
  const deleteCandidate = chats.find(
    (candidate) => candidate.id === deleteCandidateId,
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
      : "No campaign bound";
  const campaignBound = Boolean(
    campaignStatus.campaignId && campaignStatus.name,
  );

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

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    clearError();
    setInput("");
    void sendMessage({ text });
  }, [busy, clearError, input, sendMessage]);

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
              {chats.map((candidate) => (
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
                    <span>{candidate.campaignName ?? "No campaign bound"}</span>
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
              ))}
            </div>
            {deleteCandidate ? (
              <div
                aria-label="Confirm chat deletion"
                className="chat-delete-confirm"
                role="alertdialog"
              >
                <p>Delete “{deleteCandidate.title}”?</p>
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
            ) : null}
          </aside>
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
          <h1
            aria-label={`Campaign: ${campaignLabel}`}
            className={campaignBound ? "bound" : "unbound"}
            title={campaignLabel}
          >
            {campaignLabel}
          </h1>
          <button
            className="chat-settings-button"
            type="button"
            onClick={onManageProfiles}
          >
            Settings
          </button>
        </div>
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
              const receipts =
                message.role === "assistant" ? getRoll20Receipts(message) : [];
              const images =
                message.role === "assistant"
                  ? getDisplayableAssistantImages(message.parts)
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
              if (!text && receipts.length === 0 && images.length === 0) {
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
                  {receipts.length > 0 ? (
                    <ul className="tool-receipts">
                      {receipts.map((receipt) => (
                        <li
                          aria-label={`${receipt.status === "completed" ? "Completed" : "Failed"}: ${receipt.summary}`}
                          className={`tool-receipt ${receipt.status}`}
                          key={receipt.toolCallId}
                        >
                          <span aria-hidden="true" className="tool-receipt-icon">
                            {receipt.status === "completed" ? "✓" : "✕"}
                          </span>
                          <span>{receipt.summary}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {message.role === "assistant" ? (
                    text ? (
                      <div className="message-text message-markdown">
                        <ReactMarkdown
                          components={createMarkdownComponents(embeddedImages)}
                          remarkPlugins={[remarkGfm]}
                        >
                          {text}
                        </ReactMarkdown>
                      </div>
                    ) : null
                  ) : (
                    <div className="message-text">{text}</div>
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
            {activity ? (
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
        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            aria-label="Message GM Tools"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your GM assistant…"
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
              disabled={!input.trim()}
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
  const [storedChat, setStoredChat] = useState<{
    readonly chat: ChatRecord;
    readonly messages: UIMessage[];
  } | null>(null);
  const [chatRevision, setChatRevision] = useState(0);
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
      setChatRevision((revision) => revision + 1);
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
    setChatRevision((revision) => revision + 1);
  };

  const switchChat = (chatId: string): void => {
    if (chatId === storedChat.chat.id) return;
    void getStoredChat(chatId).then((loaded) => {
      if (loaded) return activateStoredChat(loaded);
    });
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
      chats={chats}
      initialMessages={storedChat.messages}
      key={`${storedChat.chat.id}:${chatRevision}`}
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
