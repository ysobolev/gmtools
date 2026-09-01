import { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BACKGROUND_EXECUTION_STORAGE_KEY,
  DEFAULT_MAX_STEPS,
  DEBUG_LOGGING_STORAGE_KEY,
  MAX_MAX_STEPS,
  MAX_STEPS_STORAGE_KEY,
  MIN_MAX_STEPS,
  UNRESTRICTED_WEB_FETCH_STORAGE_KEY,
  isBackgroundExecutionEnabled,
  isDebugLoggingEnabled,
  isUnrestrictedWebFetchEnabled,
  normalizeMaxSteps,
} from "./behavior-settings";
import {
  applyDisplayTheme,
  DEFAULT_DISPLAY_THEME,
  DISPLAY_THEME_STORAGE_KEY,
  isDisplayTheme,
  type DisplayTheme,
} from "./display-settings";
import {
  AUTH_DISCONNECT_REQUEST,
  AUTH_PERSISTENCE_REQUEST,
  AUTH_STATUS_REQUEST,
  isAuthResponse,
  isAuthStateChangedMessage,
  type AuthRequest,
  type AuthStatus,
} from "./openrouter-protocol";
import {
  ACTIVE_PROFILE_STORAGE_KEY,
  createProfile,
  DEFAULT_PROFILE,
  getModelDefinition,
  getRulesetDefinition,
  getSheetAdapterDefinition,
  MODELS,
  normalizeProfiles,
  PROFILES_STORAGE_KEY,
  RULESETS,
  sheetsForRuleset,
  type AssistantProfile,
  type ModelId,
  type RulesetId,
  type SheetAdapterId,
} from "./profile-config";

type SettingsTab = "profiles" | "display" | "behavior" | "authentication";
type EditorMode =
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly profileId: string };

async function sendAuthRequest(message: AuthRequest): Promise<AuthStatus> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!isAuthResponse(response)) {
    throw new Error("The extension returned an invalid response.");
  }
  if (!response.ok) throw new Error(response.error);
  return response.status;
}

function profilesEqual(
  left: AssistantProfile,
  right: AssistantProfile,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.rulesetId === right.rulesetId &&
    left.sheetAdapterId === right.sheetAdapterId &&
    left.modelId === right.modelId &&
    left.additionalInstructions === right.additionalInstructions
  );
}

function ProfilesSettings(): React.JSX.Element {
  const [profiles, setProfiles] = useState<AssistantProfile[] | null>(null);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [mode, setMode] = useState<EditorMode>({
    kind: "edit",
    profileId: DEFAULT_PROFILE.id,
  });
  const [draft, setDraft] = useState<AssistantProfile>(DEFAULT_PROFILE);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void chrome.storage.local
      .get([PROFILES_STORAGE_KEY, ACTIVE_PROFILE_STORAGE_KEY])
      .then((stored) => {
        if (cancelled) return;
        const loadedProfiles = normalizeProfiles(stored[PROFILES_STORAGE_KEY]);
        const storedActiveId = stored[ACTIVE_PROFILE_STORAGE_KEY];
        const activeId =
          typeof storedActiveId === "string" &&
          loadedProfiles.some((profile) => profile.id === storedActiveId)
            ? storedActiveId
            : loadedProfiles[0]!.id;
        const activeProfile =
          loadedProfiles.find((profile) => profile.id === activeId) ??
          loadedProfiles[0]!;
        setProfiles(loadedProfiles);
        setActiveProfileId(activeId);
        setMode({ kind: "edit", profileId: activeProfile.id });
        setDraft(activeProfile);
        void chrome.storage.local.set({
          [PROFILES_STORAGE_KEY]: loadedProfiles,
          [ACTIVE_PROFILE_STORAGE_KEY]: activeId,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setProfiles([DEFAULT_PROFILE]);
        setActiveProfileId(DEFAULT_PROFILE.id);
      });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== "local") return;
      const activeChange = changes[ACTIVE_PROFILE_STORAGE_KEY];
      if (typeof activeChange?.newValue === "string") {
        setActiveProfileId(activeChange.newValue);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const savedProfile = useMemo(() => {
    if (!profiles || mode.kind !== "edit") return undefined;
    return profiles.find((profile) => profile.id === mode.profileId);
  }, [mode, profiles]);
  const dirty =
    mode.kind === "new" ||
    !savedProfile ||
    !profilesEqual(draft, savedProfile);

  if (!profiles) {
    return (
      <div className="section-loading" aria-live="polite">
        <div className="loading-mark" aria-hidden="true" />
        <p>Loading profiles…</p>
      </div>
    );
  }

  const selectProfile = (profile: AssistantProfile): void => {
    setMode({ kind: "edit", profileId: profile.id });
    setDraft(profile);
    setSavedMessage("");
  };

  const beginNewProfile = (): void => {
    setMode({ kind: "new" });
    setDraft(createProfile(crypto.randomUUID(), profiles.length + 1));
    setSavedMessage("");
  };

  const changeRuleset = (rulesetId: RulesetId): void => {
    const firstSheet = sheetsForRuleset(rulesetId)[0];
    if (!firstSheet) return;
    setDraft({ ...draft, rulesetId, sheetAdapterId: firstSheet.id });
    setSavedMessage("");
  };

  const updateDraft = (change: Partial<AssistantProfile>): void => {
    setDraft({ ...draft, ...change });
    setSavedMessage("");
  };

  const saveProfile = (event: FormEvent): void => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    const profile = { ...draft, name };
    const creating = mode.kind === "new";
    const nextProfiles = creating
      ? [...profiles, profile]
      : profiles.map((candidate) =>
          candidate.id === profile.id ? profile : candidate,
        );
    setProfiles(nextProfiles);
    setMode({ kind: "edit", profileId: profile.id });
    setDraft(profile);
    setSavedMessage(creating ? "Profile created." : "Changes saved.");
    void chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: nextProfiles });
  };

  const cancelChanges = (): void => {
    const profile =
      savedProfile ??
      profiles.find((candidate) => candidate.id === activeProfileId) ??
      profiles[0]!;
    selectProfile(profile);
  };

  const deleteProfile = (): void => {
    if (mode.kind !== "edit" || profiles.length <= 1) return;
    const nextProfiles = profiles.filter(
      (profile) => profile.id !== mode.profileId,
    );
    if (nextProfiles.length === profiles.length) return;
    const nextActiveId =
      mode.profileId === activeProfileId
        ? nextProfiles[0]!.id
        : activeProfileId;
    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveId);
    selectProfile(nextProfiles[0]!);
    setSavedMessage("Profile deleted.");
    void chrome.storage.local.set({
      [PROFILES_STORAGE_KEY]: nextProfiles,
      [ACTIVE_PROFILE_STORAGE_KEY]: nextActiveId,
    });
  };

  const isNew = mode.kind === "new";

  return (
    <div className="profile-workspace">
      <aside className="profile-sidebar">
        <div className="sidebar-heading">
          <div>
            <p className="section-label">Assistant presets</p>
            <h2>Profiles</h2>
          </div>
          <button className="new-button" onClick={beginNewProfile} type="button">
            <span aria-hidden="true">+</span> New profile
          </button>
        </div>
        <nav className="profile-list" aria-label="Assistant profiles">
          {profiles.map((profile) => (
            <button
              className={
                mode.kind === "edit" && mode.profileId === profile.id
                  ? "profile-item selected"
                  : "profile-item"
              }
              key={profile.id}
              onClick={() => selectProfile(profile)}
              type="button"
            >
              <span className="profile-item-topline">
                <strong>{profile.name}</strong>
                {profile.id === activeProfileId ? (
                  <span className="active-badge">Active</span>
                ) : null}
              </span>
              <span>{getRulesetDefinition(profile.rulesetId).label}</span>
              <span>{getModelDefinition(profile.modelId).label}</span>
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          Choose the active profile from the GM Tools for VTT side panel.
        </p>
      </aside>

      <section className="editor-panel">
        <div className="editor-heading">
          <div className="editor-status-line">
            <span className={isNew ? "mode-badge new" : "mode-badge"}>
              {isNew ? "New profile" : "Editing profile"}
            </span>
            {dirty ? <span className="unsaved-badge">Unsaved changes</span> : null}
          </div>
          <h2>{isNew ? "Create a profile" : draft.name}</h2>
          <p>
            Combine game guidance, character-sheet conventions, and a model
            into a reusable assistant preset.
          </p>
        </div>

        <form className="profile-form" onSubmit={saveProfile}>
          <div className="form-grid">
            <label className="field field-wide">
              <span>Profile name</span>
              <input
                autoFocus={isNew}
                maxLength={80}
                onChange={(event) => updateDraft({ name: event.target.value })}
                required
                value={draft.name}
              />
            </label>

            <label className="field">
              <span>Game</span>
              <select
                onChange={(event) =>
                  changeRuleset(event.target.value as RulesetId)
                }
                value={draft.rulesetId}
              >
                {RULESETS.map((ruleset) => (
                  <option key={ruleset.id} value={ruleset.id}>
                    {ruleset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Character sheet</span>
              <select
                onChange={(event) =>
                  updateDraft({
                    sheetAdapterId: event.target.value as SheetAdapterId,
                  })
                }
                value={draft.sheetAdapterId}
              >
                {sheetsForRuleset(draft.rulesetId).map((sheet) => (
                  <option key={`${sheet.rulesetId}:${sheet.id}`} value={sheet.id}>
                    {sheet.label}
                  </option>
                ))}
              </select>
              <small>
                {
                  getSheetAdapterDefinition(
                    draft.sheetAdapterId,
                    draft.rulesetId,
                  ).label
                } guidance will be included in the system prompt.
              </small>
            </label>

            <label className="field field-wide">
              <span>Model</span>
              <select
                onChange={(event) =>
                  updateDraft({ modelId: event.target.value as ModelId })
                }
                value={draft.modelId}
              >
                {MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <small>{getModelDefinition(draft.modelId).description}</small>
            </label>

            <label className="field field-wide">
              <span>
                {draft.rulesetId === "custom"
                  ? "Custom prompt"
                  : "Additional instructions"}
              </span>
              <textarea
                maxLength={8_000}
                onChange={(event) =>
                  updateDraft({ additionalInstructions: event.target.value })
                }
                placeholder={
                  draft.rulesetId === "custom"
                    ? "Describe the game, rules, sheet conventions, and how the assistant should behave."
                    : "Add campaign conventions or corrections to the built-in guidance."
                }
                rows={10}
                value={draft.additionalInstructions}
              />
              <small>
                {draft.additionalInstructions.length.toLocaleString()} / 8,000 characters
              </small>
            </label>
          </div>

          <div className="form-actions">
            <div>
              {!isNew ? (
                <button
                  className="danger-button"
                  disabled={profiles.length <= 1}
                  onClick={deleteProfile}
                  type="button"
                >
                  Delete profile
                </button>
              ) : null}
            </div>
            <div className="save-actions">
              {savedMessage ? (
                <span className="saved-message" role="status">{savedMessage}</span>
              ) : null}
              {dirty ? (
                <button
                  className="secondary-button"
                  onClick={cancelChanges}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
              <button className="primary-button" disabled={!dirty} type="submit">
                {isNew ? "Create profile" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function DisplaySettings({
  theme,
  onChange,
}: {
  readonly theme: DisplayTheme;
  readonly onChange: (theme: DisplayTheme) => void;
}): React.JSX.Element {
  const choices: readonly {
    readonly id: DisplayTheme;
    readonly label: string;
    readonly description: string;
  }[] = [
    {
      id: "system",
      label: "System default",
      description: "Follow your operating system's light or dark appearance.",
    },
    {
      id: "dark",
      label: "Force dark mode",
      description: "Always use the dark GM Tools theme.",
    },
    {
      id: "light",
      label: "Force light mode",
      description: "Always use the light GM Tools theme.",
    },
  ];

  return (
    <section className="settings-panel simple-panel">
      <div className="settings-panel-heading">
        <p className="section-label">Appearance</p>
        <h2>Display</h2>
        <p>Choose how GM Tools appears in the side panel and settings.</p>
      </div>
      <fieldset className="choice-group">
        <legend>Visual style</legend>
        {choices.map((choice) => (
          <label className="radio-card" key={choice.id}>
            <input
              checked={theme === choice.id}
              name="display-theme"
              onChange={() => onChange(choice.id)}
              type="radio"
              value={choice.id}
            />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function AuthenticationSettings({
  busy,
  error,
  onLogout,
  onPersistenceChange,
  status,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onLogout: () => void;
  readonly onPersistenceChange: (enabled: boolean) => void;
  readonly status: AuthStatus | null;
}): React.JSX.Element {
  return (
    <section className="settings-panel simple-panel">
      <div className="settings-panel-heading">
        <p className="section-label">OpenRouter</p>
        <h2>Authentication</h2>
        <p>Control how your OpenRouter login is retained by this extension.</p>
      </div>

      <div className="auth-status-card">
        <div>
          <span
            className={status?.connected ? "status-dot connected" : "status-dot"}
          />
          <strong>{status?.connected ? "Connected" : "Not connected"}</strong>
        </div>
        {status?.keyLabel ? <p>{status.keyLabel}</p> : null}
        {typeof status?.limitRemaining === "number" ? (
          <p>${status.limitRemaining.toFixed(2)} key limit remaining</p>
        ) : null}
      </div>

      <label className="toggle-card persistence-card">
        <input
          checked={status?.persistent ?? false}
          disabled={busy || !status}
          onChange={(event) => onPersistenceChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Keep me signed in on this device</strong>
          <small>
            Security risk: stores your OpenRouter credential persistently in
            your Chrome profile. Anyone or any software with access to that
            profile may be able to recover it.
          </small>
        </span>
      </label>

      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      <div className="logout-row">
        <div>
          <strong>Log out of OpenRouter</strong>
          <p>
            Clears the credential from memory and disk and disables persistent
            login.
          </p>
        </div>
        <button
          className="danger-button"
          disabled={busy || !status?.connected}
          onClick={onLogout}
          type="button"
        >
          {busy ? "Working…" : "Log out"}
        </button>
      </div>
    </section>
  );
}

function BehaviorSettings({
  backgroundExecutionEnabled,
  debugLoggingEnabled,
  maxSteps,
  unrestrictedWebFetchEnabled,
  onBackgroundExecutionChange,
  onDebugLoggingChange,
  onMaxStepsChange,
  onUnrestrictedWebFetchChange,
}: {
  readonly backgroundExecutionEnabled: boolean;
  readonly debugLoggingEnabled: boolean;
  readonly maxSteps: number;
  readonly unrestrictedWebFetchEnabled: boolean;
  readonly onBackgroundExecutionChange: (enabled: boolean) => void;
  readonly onDebugLoggingChange: (enabled: boolean) => void;
  readonly onMaxStepsChange: (steps: number) => void;
  readonly onUnrestrictedWebFetchChange: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="settings-panel simple-panel">
      <div className="settings-panel-heading">
        <p className="section-label">Assistant operation</p>
        <h2>Behavior</h2>
        <p>Control diagnostics and how GM Tools handles active tasks.</p>
      </div>

      <div className="behavior-options">
        <label className="behavior-number-card">
          <span>
            <strong>Maximum steps per request</strong>
            <small>
              Limits the number of model and tool-call iterations that one
              submitted message may use.
            </small>
          </span>
          <input
            max={MAX_MAX_STEPS}
            min={MIN_MAX_STEPS}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isInteger(value)) {
                onMaxStepsChange(
                  Math.max(MIN_MAX_STEPS, Math.min(MAX_MAX_STEPS, value)),
                );
              }
            }}
            type="number"
            value={maxSteps}
          />
        </label>

        <label className="toggle-card behavior-card">
          <input
            checked={debugLoggingEnabled}
            onChange={(event) => onDebugLoggingChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Enable console debugging output</strong>
            <small>
              Writes diagnostic information to the extension service-worker
              console. Debug output may contain conversation and tool-call
              details.
            </small>
          </span>
        </label>

        <label className="toggle-card behavior-card">
          <input
            checked={backgroundExecutionEnabled}
            onChange={(event) =>
              onBackgroundExecutionChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>Continue running tasks in the background</strong>
            <small>
              Keeps the active conversation and its Roll20 tool calls running
              when the side panel is closed. Reopening the panel reconnects to
              the task.
            </small>
          </span>
        </label>

        <label className="toggle-card behavior-card">
          <input
            checked={unrestrictedWebFetchEnabled}
            onChange={(event) =>
              onUnrestrictedWebFetchChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>Allow web fetching from any domain</strong>
            <small className="warning-note">
              Security risk. This allows the model to send any public URL to
              OpenRouter and Exa for retrieval. Fetched pages may contain
              malicious instructions, and their URLs or contents may expose
              sensitive information. Fetches may incur additional charges.
            </small>
          </span>
        </label>

        <label className="toggle-card behavior-card unavailable">
          <input checked={false} disabled readOnly type="checkbox" />
          <span>
            <strong>Use private JavaScript API for chat</strong>
            <small className="warning-note">
              Risky and not implemented yet. This would rely on undocumented
              Roll20 internals that may change without notice.
            </small>
          </span>
        </label>
      </div>
    </section>
  );
}

function OptionsApp(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profiles");
  const [theme, setTheme] = useState<DisplayTheme>(DEFAULT_DISPLAY_THEME);
  const [backgroundExecutionEnabled, setBackgroundExecutionEnabled] =
    useState(false);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(false);
  const [unrestrictedWebFetchEnabled, setUnrestrictedWebFetchEnabled] =
    useState(false);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.storage.local.get(DISPLAY_THEME_STORAGE_KEY).then((stored) => {
      const value = stored[DISPLAY_THEME_STORAGE_KEY];
      if (isDisplayTheme(value)) setTheme(value);
    });
  }, []);
  useEffect(() => applyDisplayTheme(theme), [theme]);

  useEffect(() => {
    void chrome.storage.local
      .get([
        DEBUG_LOGGING_STORAGE_KEY,
        BACKGROUND_EXECUTION_STORAGE_KEY,
        MAX_STEPS_STORAGE_KEY,
        UNRESTRICTED_WEB_FETCH_STORAGE_KEY,
      ])
      .then((stored) => {
        setDebugLoggingEnabled(
          isDebugLoggingEnabled(stored[DEBUG_LOGGING_STORAGE_KEY]),
        );
        setBackgroundExecutionEnabled(
          isBackgroundExecutionEnabled(
            stored[BACKGROUND_EXECUTION_STORAGE_KEY],
          ),
        );
        setMaxSteps(normalizeMaxSteps(stored[MAX_STEPS_STORAGE_KEY]));
        setUnrestrictedWebFetchEnabled(
          isUnrestrictedWebFetchEnabled(
            stored[UNRESTRICTED_WEB_FETCH_STORAGE_KEY],
          ),
        );
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sendAuthRequest({ type: AUTH_STATUS_REQUEST })
      .then((status) => {
        if (!cancelled) setAuthStatus(status);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAuthError(
            error instanceof Error
              ? error.message
              : "Could not read login state.",
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

  const changeTheme = (nextTheme: DisplayTheme): void => {
    setTheme(nextTheme);
    void chrome.storage.local.set({ [DISPLAY_THEME_STORAGE_KEY]: nextTheme });
  };

  const changeDebugLogging = (enabled: boolean): void => {
    setDebugLoggingEnabled(enabled);
    void chrome.storage.local.set({ [DEBUG_LOGGING_STORAGE_KEY]: enabled });
  };

  const changeBackgroundExecution = (enabled: boolean): void => {
    setBackgroundExecutionEnabled(enabled);
    void chrome.storage.local.set({
      [BACKGROUND_EXECUTION_STORAGE_KEY]: enabled,
    });
  };

  const changeMaxSteps = (steps: number): void => {
    const normalized = normalizeMaxSteps(steps);
    setMaxSteps(normalized);
    void chrome.storage.local.set({ [MAX_STEPS_STORAGE_KEY]: normalized });
  };

  const changeUnrestrictedWebFetch = (enabled: boolean): void => {
    setUnrestrictedWebFetchEnabled(enabled);
    void chrome.storage.local.set({
      [UNRESTRICTED_WEB_FETCH_STORAGE_KEY]: enabled,
    });
  };

  const changePersistence = (enabled: boolean): void => {
    setAuthBusy(true);
    setAuthError(null);
    void sendAuthRequest({ type: AUTH_PERSISTENCE_REQUEST, enabled })
      .then(setAuthStatus)
      .catch((error: unknown) =>
        setAuthError(
          error instanceof Error
            ? error.message
            : "Could not change credential storage.",
        ),
      )
      .finally(() => setAuthBusy(false));
  };

  const logout = (): void => {
    setAuthBusy(true);
    setAuthError(null);
    void sendAuthRequest({ type: AUTH_DISCONNECT_REQUEST })
      .then(setAuthStatus)
      .catch((error: unknown) =>
        setAuthError(
          error instanceof Error ? error.message : "Could not log out.",
        ),
      )
      .finally(() => setAuthBusy(false));
  };

  const tabs: readonly {
    readonly id: SettingsTab;
    readonly label: string;
    readonly description: string;
  }[] = [
    {
      id: "profiles",
      label: "Profiles",
      description: "Games, sheets, and models",
    },
    {
      id: "display",
      label: "Display",
      description: "Theme and appearance",
    },
    {
      id: "behavior",
      label: "Behavior",
      description: "Diagnostics and background tasks",
    },
    {
      id: "authentication",
      label: "Authentication",
      description: "OpenRouter credentials",
    },
  ];

  return (
    <main className="options-shell">
      <header className="options-header">
        <div className="brand-mark" aria-hidden="true">✦</div>
        <div>
          <p className="eyebrow">VIRTUAL TABLETOP ASSISTANT</p>
          <h1>GM Tools for VTT settings</h1>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={
                activeTab === tab.id
                  ? "settings-tab active"
                  : "settings-tab"
              }
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <div hidden={activeTab !== "profiles"}>
            <ProfilesSettings />
          </div>
          <div hidden={activeTab !== "display"}>
            <DisplaySettings onChange={changeTheme} theme={theme} />
          </div>
          <div hidden={activeTab !== "behavior"}>
            <BehaviorSettings
              backgroundExecutionEnabled={backgroundExecutionEnabled}
              debugLoggingEnabled={debugLoggingEnabled}
              maxSteps={maxSteps}
              onBackgroundExecutionChange={changeBackgroundExecution}
              onDebugLoggingChange={changeDebugLogging}
              onMaxStepsChange={changeMaxSteps}
              onUnrestrictedWebFetchChange={changeUnrestrictedWebFetch}
              unrestrictedWebFetchEnabled={unrestrictedWebFetchEnabled}
            />
          </div>
          <div hidden={activeTab !== "authentication"}>
            <AuthenticationSettings
              busy={authBusy}
              error={authError}
              onLogout={logout}
              onPersistenceChange={changePersistence}
              status={authStatus}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("Missing options-page root element.");
createRoot(rootElement).render(<OptionsApp />);
