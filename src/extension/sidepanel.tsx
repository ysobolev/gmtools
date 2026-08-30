import { useChat } from "@ai-sdk/react";
import { safeValidateUIMessages, type UIMessage } from "ai";
import {
  FormEvent,
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
import { getChatActivity } from "./chat-activity";
import {
  applyDisplayTheme,
  DEFAULT_DISPLAY_THEME,
  DISPLAY_THEME_STORAGE_KEY,
  isDisplayTheme,
  type DisplayTheme,
} from "./display-settings";
import { ExtensionChatTransport } from "./extension-chat-transport";
import {
  ACTIVE_PROFILE_STORAGE_KEY,
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
  isAuthResponse,
  isAuthStateChangedMessage,
  type AuthRequest,
  type AuthStatus,
} from "./openrouter-protocol";

const CHAT_HISTORY_STORAGE_KEY = "openRouterChatHistory";
interface StoredConversation {
  readonly profileId: string;
  readonly messages: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStoredConversation(
  value: unknown,
  profileId: string,
): unknown[] {
  if (Array.isArray(value)) return value;
  if (
    isRecord(value) &&
    value.profileId === profileId &&
    Array.isArray(value.messages)
  ) {
    return value.messages;
  }
  return [];
}
const markdownComponents: Components = {
  a: ({ node: _node, ...properties }) => (
    <a {...properties} rel="noopener noreferrer" target="_blank" />
  ),
  img: ({ alt }) => <span className="image-placeholder">[Image: {alt ?? "image"}]</span>,
};

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
  onManageProfiles,
  onSelectProfile,
  profiles,
}: {
  readonly activeProfile: AssistantProfile;
  readonly onManageProfiles: () => void;
  readonly onSelectProfile: (profileId: string) => void;
  readonly profiles: readonly AssistantProfile[];
}): React.JSX.Element {
  const transport = useMemo(
    () => new ExtensionChatTransport(activeProfile),
    [activeProfile],
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
  } = useChat({ transport, throttle: 40 });
  const [input, setInput] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const activity = getChatActivity(status, messages);

  useEffect(() => {
    let cancelled = false;
    void chrome.storage.session
      .get(CHAT_HISTORY_STORAGE_KEY)
      .then(async (stored) => {
        const validation = await safeValidateUIMessages<UIMessage>({
          messages: readStoredConversation(
            stored[CHAT_HISTORY_STORAGE_KEY],
            activeProfile.id,
          ),
        });
        if (!cancelled && validation.success) setMessages(validation.data);
      })
      .finally(() => {
        if (!cancelled) setHistoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile.id, setMessages]);

  useEffect(() => {
    if (!historyReady) return;
    const timeoutId = window.setTimeout(() => {
      void chrome.storage.session.set({
        [CHAT_HISTORY_STORAGE_KEY]: {
          profileId: activeProfile.id,
          messages,
        } satisfies StoredConversation,
      });
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [activeProfile.id, historyReady, messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" });
  }, [busy, messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

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
    setMessages([]);
    void chrome.storage.session.remove(CHAT_HISTORY_STORAGE_KEY);
    textareaRef.current?.focus();
  };

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div className="profile-control">
          <select
            aria-label="Active assistant profile"
            onChange={(event) => onSelectProfile(event.target.value)}
            value={activeProfile.id}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={onManageProfiles}>
            Settings
          </button>
        </div>
      </header>

      <section className="conversation" aria-live="polite">
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
            {messages.map((message) => {
              const text = textFromMessage(message);
              if (!text) return null;
              return (
                <article
                  className={`message ${message.role}`}
                  key={message.id}
                >
                  <p className="message-author">
                    {message.role === "user" ? "You" : "GM Tools"}
                  </p>
                  {message.role === "assistant" ? (
                    <div className="message-text message-markdown">
                      <ReactMarkdown
                        components={markdownComponents}
                        remarkPlugins={[remarkGfm]}
                      >
                        {text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="message-text">{text}</div>
                  )}
                </article>
              );
            })}
            {activity ? (
              <div
                className={`activity-indicator ${activity.toLowerCase()}`}
                role="status"
              >
                <span>{activity}</span>
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
              onClick={stop}
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
  const [activeProfileId, setActiveProfileId] = useState("");
  const [chatRevision, setChatRevision] = useState(0);
  const profilesRef = useRef<AssistantProfile[] | null>(null);
  const activeProfileIdRef = useRef("");

  const clearChat = useCallback((): void => {
    void chrome.storage.session.remove(CHAT_HISTORY_STORAGE_KEY);
    setChatRevision((revision) => revision + 1);
  }, []);

  const applyProfileState = useCallback((
    loadedProfiles: AssistantProfile[],
    activeId: string,
    clearChangedActiveProfile: boolean,
  ): void => {
    const previousProfiles = profilesRef.current;
    const previousActiveProfile = previousProfiles?.find(
      (profile) => profile.id === activeProfileIdRef.current,
    );
    const nextActiveProfile = loadedProfiles.find(
      (profile) => profile.id === activeId,
    );
    const activeProfileChanged =
      clearChangedActiveProfile &&
      previousActiveProfile !== undefined &&
      JSON.stringify(previousActiveProfile) !== JSON.stringify(nextActiveProfile);

    profilesRef.current = loadedProfiles;
    activeProfileIdRef.current = activeId;
    setProfiles(loadedProfiles);
    setActiveProfileId(activeId);
    if (activeProfileChanged) clearChat();
  }, [clearChat]);

  useEffect(() => {
    let cancelled = false;
    const refreshProfiles = async (clearChangedActiveProfile: boolean): Promise<void> => {
      const stored = await chrome.storage.local.get([
        PROFILES_STORAGE_KEY,
        ACTIVE_PROFILE_STORAGE_KEY,
      ]);
      if (cancelled) return;
      const loadedProfiles = normalizeProfiles(stored[PROFILES_STORAGE_KEY]);
      const storedActiveId = stored[ACTIVE_PROFILE_STORAGE_KEY];
      const activeId =
        typeof storedActiveId === "string" &&
        loadedProfiles.some((profile) => profile.id === storedActiveId)
          ? storedActiveId
          : loadedProfiles[0]!.id;
      applyProfileState(loadedProfiles, activeId, clearChangedActiveProfile);
    };

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (
        areaName === "local" &&
        (PROFILES_STORAGE_KEY in changes || ACTIVE_PROFILE_STORAGE_KEY in changes)
      ) {
        void refreshProfiles(true);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    void refreshProfiles(false).catch(() => {
      if (!cancelled) {
        applyProfileState([DEFAULT_PROFILE], DEFAULT_PROFILE.id, false);
      }
    });
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [applyProfileState]);

  if (!profiles) return <LoadingScreen />;
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]!;

  const selectProfile = (profileId: string): void => {
    if (
      profileId === activeProfile.id ||
      !profiles.some((profile) => profile.id === profileId)
    ) {
      return;
    }
    applyProfileState(profiles, profileId, true);
    void chrome.storage.local.set({ [ACTIVE_PROFILE_STORAGE_KEY]: profileId });
  };

  return (
    <ChatScreen
      activeProfile={activeProfile}
      key={`${activeProfile.id}:${chatRevision}`}
      onManageProfiles={() => void chrome.runtime.openOptionsPage()}
      onSelectProfile={selectProfile}
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
