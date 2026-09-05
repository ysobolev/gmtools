import "./configure-csp";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_MAX_STEPS,
  MAX_MAX_STEPS,
  MIN_MAX_STEPS,
  normalizeMaxSteps,
} from "./behavior-settings";
import {
  applyDisplayTheme,
  DEFAULT_DISPLAY_THEME,
  type DisplayTheme,
} from "./display-settings";
import {
  isDurableDataChangedMessage,
} from "./durable-data-protocol";
import {
  getGlobalPreferences,
  updateGlobalPreferences,
} from "./preferences-store";
import {
  deleteProfile as deleteStoredProfile,
  listProfiles,
  saveProfile as saveStoredProfile,
} from "./profile-store";
import {
  listCampaigns,
  updateCampaignConfiguration,
  type CampaignConfigurationPatch,
} from "./campaign-store";
import {
  countCampaignMemories,
  deleteAllCampaignMemories,
  deleteCampaignMemory,
  listCampaignMemories,
  updateCampaignMemory,
  type CampaignMemoryRecord,
} from "./campaign-memory-store";
import {
  DEFAULT_CAMPAIGN_OVERRIDES,
  type CampaignOverride,
  type CampaignOverrides,
  type CampaignRecord,
} from "./campaign-config";
import {
  AUTH_DISCONNECT_REQUEST,
  AUTH_PERSISTENCE_REQUEST,
  AUTH_STATUS_REQUEST,
  CAMPAIGN_DELETE_REQUEST,
  CAMPAIGN_DELETE_PREVIEW_REQUEST,
  isAuthResponse,
  isAuthStateChangedMessage,
  isCampaignDeleteResponse,
  isCampaignDeletePreviewResponse,
  type AuthRequest,
  type AuthStatus,
} from "./openrouter-protocol";
import {
  createProfile,
  DEFAULT_PROFILE,
  getModelDefinition,
  getModelSelectionLabel,
  getRulesetDefinition,
  isAssistantProfile,
  isCuratedModelId,
  MODELS,
  RECOMMENDED_MODEL_ID,
  RULESETS,
  type AssistantProfile,
  type RulesetId,
} from "./profile-config";

type SettingsTab =
  | "profiles"
  | "campaigns"
  | "display"
  | "behavior"
  | "authentication";
async function sendAuthRequest(message: AuthRequest): Promise<AuthStatus> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!isAuthResponse(response)) {
    throw new Error("The extension returned an invalid response.");
  }
  if (!response.ok) throw new Error(response.error);
  return response.status;
}

const PROFILE_TEXT_SAVE_DELAY_MS = 800;

function normalizedProfileDraft(
  draft: AssistantProfile,
): AssistantProfile | undefined {
  const profile: AssistantProfile = {
    ...draft,
    name: draft.name.trim(),
    modelSelection: draft.modelSelection.kind === "fixed"
      ? { kind: "fixed", modelId: draft.modelSelection.modelId.trim() }
      : draft.modelSelection,
  };
  return isAssistantProfile(profile) ? profile : undefined;
}

function nextProfileNumber(profiles: readonly AssistantProfile[]): number {
  const names = new Set(profiles.map((profile) => profile.name));
  for (let number = 1; number <= profiles.length + 1; number += 1) {
    const name = number === 1 ? "New Profile" : `New Profile ${number}`;
    if (!names.has(name)) return number;
  }
  return profiles.length + 1;
}

function ProfilesSettings(): React.JSX.Element {
  const [profiles, setProfiles] = useState<AssistantProfile[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(
    DEFAULT_PROFILE.id,
  );
  const [draft, setDraft] = useState<AssistantProfile>(DEFAULT_PROFILE);
  const [savedMessage, setSavedMessage] = useState("");
  const pendingDraftsRef = useRef(new Map<string, AssistantProfile>());
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const refreshProfilesAfterSavesRef = useRef(false);
  const selectedProfileIdRef = useRef(DEFAULT_PROFILE.id);
  const creatingProfileRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void listProfiles()
      .then((loadedProfiles) => {
        if (cancelled) return;
        const firstProfile = loadedProfiles[0]!;
        setProfiles(loadedProfiles);
        selectedProfileIdRef.current = firstProfile.id;
        setSelectedProfileId(firstProfile.id);
        setDraft(firstProfile);
      })
      .catch(() => {
        if (cancelled) return;
        setProfiles([DEFAULT_PROFILE]);
      });
    const handleMessage = (message: unknown): void => {
      if (
        !isDurableDataChangedMessage(message) ||
        !message.stores.includes("profiles")
      ) return;
      if (saveChainsRef.current.size > 0) {
        refreshProfilesAfterSavesRef.current = true;
        return;
      }
      void listProfiles().then((loadedProfiles) => {
        if (!cancelled) setProfiles(loadedProfiles);
      });
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
    };
  }, []);

  const selectedModelChoice =
    draft.modelSelection.kind === "recommended"
      ? "recommended"
      : isCuratedModelId(draft.modelSelection.modelId)
        ? draft.modelSelection.modelId
        : "custom";
  const resolvedDraftModelId =
    draft.modelSelection.kind === "recommended"
      ? RECOMMENDED_MODEL_ID
      : draft.modelSelection.modelId;

  if (!profiles) {
    return (
      <div className="section-loading" aria-live="polite">
        <div className="loading-mark" aria-hidden="true" />
        <p>Loading profiles…</p>
      </div>
    );
  }

  const profileValidationMessage = (profile: AssistantProfile): string => {
    if (!profile.name.trim()) return "Profile name is required.";
    if (
      profile.modelSelection.kind === "fixed" &&
      !profile.modelSelection.modelId.trim()
    ) {
      return "OpenRouter model ID is required.";
    }
    return "The profile is invalid.";
  };

  const queueProfileSave = (profile: AssistantProfile): void => {
    setProfiles((current) => current?.map((candidate) =>
      candidate.id === profile.id ? profile : candidate
    ) ?? null);
    const previous = saveChainsRef.current.get(profile.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      try {
        await saveStoredProfile(profile);
        if (selectedProfileIdRef.current === profile.id) setSavedMessage("");
      } catch (error) {
        if (selectedProfileIdRef.current === profile.id) {
          setSavedMessage(
            error instanceof Error ? error.message : "Could not save the profile.",
          );
        }
        refreshProfilesAfterSavesRef.current = true;
      }
    });
    saveChainsRef.current.set(profile.id, next);
    void next.finally(() => {
      if (saveChainsRef.current.get(profile.id) === next) {
        saveChainsRef.current.delete(profile.id);
        if (
          saveChainsRef.current.size === 0 &&
          refreshProfilesAfterSavesRef.current
        ) {
          refreshProfilesAfterSavesRef.current = false;
          void listProfiles().then(setProfiles);
        }
      }
    });
  };

  const flushProfileSave = (
    profileId: string,
    showValidationError: boolean,
  ): void => {
    const timer = saveTimersRef.current.get(profileId);
    if (timer !== undefined) clearTimeout(timer);
    saveTimersRef.current.delete(profileId);
    const pending = pendingDraftsRef.current.get(profileId);
    if (!pending) return;
    const normalized = normalizedProfileDraft(pending);
    if (!normalized) {
      if (showValidationError && selectedProfileIdRef.current === profileId) {
        setSavedMessage(profileValidationMessage(pending));
      }
      return;
    }
    pendingDraftsRef.current.delete(profileId);
    queueProfileSave(normalized);
  };

  const scheduleProfileSave = (
    profile: AssistantProfile,
    immediate: boolean,
  ): void => {
    pendingDraftsRef.current.set(profile.id, profile);
    const existingTimer = saveTimersRef.current.get(profile.id);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    saveTimersRef.current.delete(profile.id);
    if (immediate) {
      flushProfileSave(profile.id, true);
      return;
    }
    const timer = setTimeout(() => {
      flushProfileSave(profile.id, true);
    }, PROFILE_TEXT_SAVE_DELAY_MS);
    saveTimersRef.current.set(profile.id, timer);
  };

  const selectProfile = (profile: AssistantProfile): void => {
    if (profile.id === selectedProfileIdRef.current) return;
    flushProfileSave(selectedProfileIdRef.current, false);
    selectedProfileIdRef.current = profile.id;
    setSelectedProfileId(profile.id);
    setDraft(pendingDraftsRef.current.get(profile.id) ?? profile);
    setSavedMessage("");
  };

  const beginNewProfile = (): void => {
    if (creatingProfileRef.current) return;
    flushProfileSave(selectedProfileIdRef.current, false);
    creatingProfileRef.current = true;
    const profile = createProfile(
      crypto.randomUUID(),
      nextProfileNumber(profiles),
    );
    void saveStoredProfile(profile, { create: true }).then(async () => {
      const nextProfiles = await listProfiles();
      setProfiles(nextProfiles);
      selectedProfileIdRef.current = profile.id;
      setSelectedProfileId(profile.id);
      setDraft(profile);
      setSavedMessage("");
    }).catch((error: unknown) => {
      setSavedMessage(
        error instanceof Error ? error.message : "Could not create the profile.",
      );
    }).finally(() => {
      creatingProfileRef.current = false;
    });
  };

  const changeRuleset = (rulesetId: RulesetId): void => {
    updateDraft({ rulesetId }, true);
  };

  const updateDraft = (
    change: Partial<AssistantProfile>,
    immediate = false,
  ): void => {
    const next = { ...draft, ...change };
    setDraft(next);
    setSavedMessage("");
    scheduleProfileSave(next, immediate);
  };

  const deleteProfile = (): void => {
    if (
      selectedProfileId === DEFAULT_PROFILE.id ||
      profiles.length <= 1
    ) return;
    const deletedProfileId = selectedProfileId;
    const timer = saveTimersRef.current.get(deletedProfileId);
    if (timer !== undefined) clearTimeout(timer);
    saveTimersRef.current.delete(deletedProfileId);
    pendingDraftsRef.current.delete(deletedProfileId);
    const pendingSave = saveChainsRef.current.get(deletedProfileId) ??
      Promise.resolve();
    void pendingSave.then(() => deleteStoredProfile(deletedProfileId)).then(async () => {
      const nextProfiles = await listProfiles();
      setProfiles(nextProfiles);
      const nextProfile = nextProfiles[0]!;
      selectedProfileIdRef.current = nextProfile.id;
      setSelectedProfileId(nextProfile.id);
      setDraft(nextProfile);
      setSavedMessage("Profile deleted.");
    }).catch((error: unknown) => {
      setSavedMessage(
        error instanceof Error ? error.message : "Could not delete the profile.",
      );
    });
  };

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
                selectedProfileId === profile.id
                  ? "profile-item selected"
                  : "profile-item"
              }
              key={profile.id}
              onClick={() => selectProfile(profile)}
              type="button"
            >
              <span className="profile-item-topline">
                <strong>{profile.name}</strong>
              </span>
              <span>{getRulesetDefinition(profile.rulesetId).label}</span>
              <span>{getModelSelectionLabel(profile.modelSelection)}</span>
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          Choose a profile independently for each chat in the GM Tools side
          panel.
        </p>
      </aside>

      <section className="editor-panel">
        <div className="editor-heading">
          <div className="editor-status-line">
            <span className="mode-badge">Editing profile</span>
          </div>
          <h2>{draft.name || "Untitled profile"}</h2>
          <p>
            Combine game guidance and a model into a reusable assistant preset.
          </p>
        </div>

        <div className="profile-form">
          <div className="form-grid">
            <label className="field field-wide">
              <span>Profile name</span>
              <input
                maxLength={80}
                onChange={(event) => updateDraft({ name: event.target.value })}
                onBlur={() => flushProfileSave(draft.id, true)}
                required
                value={draft.name}
              />
            </label>

            <label className="field field-wide">
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

            <label className="field field-wide">
              <span>Model</span>
              <select
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "recommended") {
                    updateDraft(
                      { modelSelection: { kind: "recommended" } },
                      true,
                    );
                  } else if (value === "custom") {
                    updateDraft({
                      modelSelection: {
                        kind: "fixed",
                        modelId:
                          draft.modelSelection.kind === "fixed" &&
                          !isCuratedModelId(draft.modelSelection.modelId)
                            ? draft.modelSelection.modelId
                            : "",
                      },
                    }, true);
                  } else {
                    updateDraft({
                      modelSelection: { kind: "fixed", modelId: value },
                    }, true);
                  }
                }}
                value={selectedModelChoice}
              >
                <option value="recommended">
                  Recommended ({getModelDefinition(RECOMMENDED_MODEL_ID).label})
                </option>
                <optgroup label="OpenAI">
                  {MODELS.filter((model) => model.id.startsWith("openai/")).map(
                    (model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ),
                  )}
                </optgroup>
                <optgroup label="Anthropic">
                  {MODELS.filter((model) =>
                    model.id.startsWith("anthropic/"),
                  ).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
                <option value="custom">Custom…</option>
              </select>
              <small>
                {getModelDefinition(resolvedDraftModelId).description}
              </small>
            </label>

            {selectedModelChoice === "custom" ? (
              <label className="field field-wide custom-model-field">
                <span className="field-label-row">
                  <span>OpenRouter model ID</span>
                  <a
                    href="https://openrouter.ai/models?input_modalities=text,image&supported_parameters=tools"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Browse compatible models ↗
                  </a>
                </span>
                <input
                  maxLength={200}
                  onChange={(event) =>
                    updateDraft({
                      modelSelection: {
                        kind: "fixed",
                        modelId: event.target.value,
                      },
                    })
                  }
                  onBlur={() => flushProfileSave(draft.id, true)}
                  placeholder="provider/model-name"
                  required
                  spellCheck={false}
                  value={
                    draft.modelSelection.kind === "fixed"
                      ? draft.modelSelection.modelId
                      : ""
                  }
                />
                <small>
                  Custom models are passed directly to OpenRouter and have not
                  been tested with GM Tools.
                </small>
              </label>
            ) : null}

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
                onBlur={() => flushProfileSave(draft.id, true)}
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
              <button
                className="danger-button"
                disabled={
                  profiles.length <= 1 ||
                  selectedProfileId === DEFAULT_PROFILE.id
                }
                onClick={deleteProfile}
                title={
                  selectedProfileId === DEFAULT_PROFILE.id
                    ? "The General profile cannot be deleted."
                    : undefined
                }
                type="button"
              >
                Delete profile
              </button>
            </div>
            <div className="save-actions">
              {savedMessage ? (
                <span className="saved-message" role="status">{savedMessage}</span>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface CampaignDraft {
  readonly defaultProfileId: string;
  readonly overrides: CampaignOverrides;
  readonly memoryEnabled: boolean;
}

function campaignDraft(record: CampaignRecord): CampaignDraft {
  return {
    defaultProfileId: record.defaultProfileId,
    overrides: { ...record.overrides },
    memoryEnabled: record.memoryEnabled,
  };
}

function CampaignMemorySettings({
  campaign,
  onCountChange,
  onShowSettings,
}: {
  readonly campaign: CampaignRecord;
  readonly onCountChange: (count: number) => void;
  readonly onShowSettings: () => void;
}): React.JSX.Element {
  const [memories, setMemories] = useState<CampaignMemoryRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [message, setMessage] = useState("");
  const [clearPrompt, setClearPrompt] = useState(false);
  const [deletePromptId, setDeletePromptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMemories = (): void => {
    void listCampaignMemories(campaign.campaignId).then((loadedMemories) => {
      setMemories(loadedMemories);
      onCountChange(loadedMemories.length);
    }).catch(
      (error: unknown) => setMessage(
        error instanceof Error ? error.message : "Could not load campaign memory.",
      ),
    );
  };

  useEffect(() => {
    refreshMemories();
    const handleMessage = (value: unknown): void => {
      if (
        isDurableDataChangedMessage(value) &&
        value.stores.includes("campaignMemories")
      ) refreshMemories();
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [campaign.campaignId]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = (memories ?? []).filter((memory) =>
    !normalizedQuery || memory.content.toLocaleLowerCase().includes(normalizedQuery)
  );

  const saveEdit = (): void => {
    if (!editingId) return;
    setBusy(true);
    setMessage("");
    void updateCampaignMemory(
      campaign.campaignId,
      editingId,
      editingContent,
      false,
    ).then(() => {
      setEditingId(null);
      setDeletePromptId(null);
      setEditingContent("");
      setMessage("Memory updated.");
      refreshMemories();
    }).catch((error: unknown) => setMessage(
      error instanceof Error ? error.message : "Could not update memory.",
    )).finally(() => setBusy(false));
  };

  const removeMemory = (memoryId: string): void => {
    setBusy(true);
    setMessage("");
    void deleteCampaignMemory(campaign.campaignId, memoryId, false).then(() => {
      if (editingId === memoryId) setEditingId(null);
      setMessage("Memory deleted.");
      refreshMemories();
    }).catch((error: unknown) => setMessage(
      error instanceof Error ? error.message : "Could not delete memory.",
    )).finally(() => setBusy(false));
  };

  const clearAll = (): void => {
    setBusy(true);
    setMessage("");
    void deleteAllCampaignMemories(campaign.campaignId).then((count) => {
      setClearPrompt(false);
      setEditingId(null);
      setMessage(`Deleted ${count} ${count === 1 ? "memory" : "memories"}.`);
      refreshMemories();
    }).catch((error: unknown) => setMessage(
      error instanceof Error ? error.message : "Could not clear campaign memory.",
    )).finally(() => setBusy(false));
  };

  return (
    <section className="editor-panel campaign-memory-panel">
      <div className="editor-heading campaign-memory-heading">
        <div>
          <nav aria-label="Campaign settings location" className="campaign-breadcrumbs">
            <button className="mode-badge" onClick={onShowSettings} type="button">
              Campaign settings
            </button>
            <span aria-hidden="true">›</span>
            <span aria-current="page" className="mode-badge">Campaign memory</span>
          </nav>
          <h2>{campaign.name}</h2>
          <p>{campaign.memoryEnabled
            ? "Durable information shared by chats attached to this campaign."
            : "Memory is disabled, but stored information can still be managed."}</p>
        </div>
      </div>
      <div className="campaign-memory-toolbar">
        <label className="field">
          <span>Filter memories</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stored content"
            type="search"
            value={query}
          />
        </label>
        <span>{memories?.length ?? 0} stored</span>
      </div>
      {message ? <p className="saved-message" role="status">{message}</p> : null}
      {memories === null ? <p>Loading memories…</p> : null}
      {memories !== null && visible.length === 0 ? (
        <p className="campaign-memory-empty">
          {memories.length === 0 ? "No memories have been stored." : "No memories match this filter."}
        </p>
      ) : null}
      <div className="campaign-memory-list">
        {visible.map((memory) => (
          <article className="campaign-memory-item" key={memory.id}>
            {editingId === memory.id ? (
              <>
                <textarea
                  maxLength={4000}
                  onChange={(event) => setEditingContent(event.target.value)}
                  rows={6}
                  value={editingContent}
                />
                <div className="campaign-memory-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => setEditingId(null)} type="button">Cancel</button>
                  <button className="primary-button" disabled={busy || !editingContent.trim()} onClick={saveEdit} type="button">Save</button>
                </div>
              </>
            ) : (
              <>
                <p>{memory.content}</p>
                <div className="campaign-memory-meta">
                  <time dateTime={new Date(memory.updatedAt).toISOString()}>
                    Updated {new Date(memory.updatedAt).toLocaleString()}
                  </time>
                  <div className="campaign-memory-actions">
                    {deletePromptId === memory.id ? (
                      <>
                        <button className="secondary-button" disabled={busy} onClick={() => setDeletePromptId(null)} type="button">Cancel</button>
                        <button className="danger-button" disabled={busy} onClick={() => removeMemory(memory.id)} type="button">Confirm delete</button>
                      </>
                    ) : (
                      <>
                        <button className="secondary-button" disabled={busy} onClick={() => {
                          setEditingId(memory.id);
                          setEditingContent(memory.content);
                          setMessage("");
                        }} type="button">Edit</button>
                        <button className="danger-button" disabled={busy} onClick={() => setDeletePromptId(memory.id)} type="button">Delete</button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {memories?.length ? (
        <div className="form-actions campaign-memory-footer">
          <button className="danger-button" disabled={busy} onClick={() => setClearPrompt(true)} type="button">Clear all memory</button>
        </div>
      ) : null}
      {clearPrompt ? (
        <div className="campaign-delete-backdrop">
          <section aria-modal="true" className="campaign-delete-dialog" role="alertdialog">
            <h2>Clear memory for {campaign.name}?</h2>
            <p>This permanently deletes all {memories?.length ?? 0} stored memories.</p>
            <div className="campaign-delete-actions">
              <button className="danger-button" disabled={busy} onClick={clearAll} type="button">Clear all memory</button>
              <button className="secondary-button" disabled={busy} onClick={() => setClearPrompt(false)} type="button">Cancel</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function CampaignsSettings({
  active,
  navigationVersion,
  globalUnrestrictedWebFetch,
  globalWebSearch,
  globalRequireRoll20Approval,
}: {
  readonly active: boolean;
  readonly navigationVersion: number;
  readonly globalUnrestrictedWebFetch: boolean;
  readonly globalWebSearch: boolean;
  readonly globalRequireRoll20Approval: boolean;
}): React.JSX.Element {
  const [campaigns, setCampaigns] = useState<CampaignRecord[] | null>(null);
  const [profiles, setProfiles] = useState<AssistantProfile[]>([DEFAULT_PROFILE]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>({
    defaultProfileId: DEFAULT_PROFILE.id,
    overrides: DEFAULT_CAMPAIGN_OVERRIDES,
    memoryEnabled: false,
  });
  const [managingMemory, setManagingMemory] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [savedMessage, setSavedMessage] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{
    readonly campaign: CampaignRecord;
    readonly chatCount: number;
    readonly activeChatCount: number;
    readonly pendingApprovalChatCount: number;
    readonly memoryCount: number;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pendingCampaignWritesRef = useRef(new Map<string, number>());
  const refreshAfterCampaignWritesRef = useRef(false);
  const campaignWriteErrorsRef = useRef(new Map<string, string>());

  const refresh = async (): Promise<void> => {
    const [loadedCampaigns, loadedProfiles] = await Promise.all([
      listCampaigns(),
      listProfiles(),
    ]);
    const selected = loadedCampaigns.find(
      (campaign) => campaign.campaignId === selectedIdRef.current,
    ) ?? loadedCampaigns[0];
    selectedIdRef.current = selected?.campaignId ?? null;
    setCampaigns(loadedCampaigns);
    setProfiles(loadedProfiles);
    setSelectedId(selectedIdRef.current);
    if (selected) setDraft(campaignDraft(selected));
  };

  useEffect(() => {
    let cancelled = false;
    void refresh();
    const handleMessage = (message: unknown): void => {
      if (
        !isDurableDataChangedMessage(message) ||
        !message.stores.some((store) =>
          store === "campaigns" || store === "profiles" ||
          store === "campaignMemories"
        )
      ) return;
      if (cancelled) return;
      if (message.stores.includes("campaigns")) {
        if (pendingCampaignWritesRef.current.size > 0) {
          refreshAfterCampaignWritesRef.current = true;
        } else {
          void refresh();
        }
      } else if (message.stores.includes("campaignMemories")) {
        const campaignId = selectedIdRef.current;
        if (campaignId) {
          void countCampaignMemories(campaignId).then(setMemoryCount);
        }
      } else {
        void listProfiles().then((loadedProfiles) => {
          if (!cancelled) setProfiles(loadedProfiles);
        });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setManagingMemory(false);
    void refresh();
  }, [active, navigationVersion]);

  useEffect(() => {
    if (!selectedId) {
      setMemoryCount(0);
      return;
    }
    let cancelled = false;
    setMemoryCount(0);
    void countCampaignMemories(selectedId).then((count) => {
      if (!cancelled) setMemoryCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = campaigns?.find(
    (campaign) => campaign.campaignId === selectedId,
  );

  const chooseCampaign = (campaign: CampaignRecord): void => {
    selectedIdRef.current = campaign.campaignId;
    setSelectedId(campaign.campaignId);
    setDraft(campaignDraft(campaign));
    setManagingMemory(false);
    setSavedMessage("");
  };

  const setOverride = (
    key: keyof CampaignOverrides,
    value: CampaignOverride,
  ): void => {
    updateConfiguration({ overrides: { [key]: value } }, {
      ...draft,
      overrides: { ...draft.overrides, [key]: value },
    });
  };

  const updateConfiguration = (
    patch: CampaignConfigurationPatch,
    nextDraft: CampaignDraft,
  ): void => {
    if (!selected) return;
    const campaignId = selected.campaignId;
    setDraft(nextDraft);
    setCampaigns((current) => current?.map((campaign) =>
      campaign.campaignId === campaignId
        ? {
            ...campaign,
            defaultProfileId: nextDraft.defaultProfileId,
            overrides: nextDraft.overrides,
            memoryEnabled: nextDraft.memoryEnabled,
          }
        : campaign
    ) ?? null);
    const pendingWrites = pendingCampaignWritesRef.current;
    if (!pendingWrites.has(campaignId)) {
      campaignWriteErrorsRef.current.delete(campaignId);
    }
    pendingWrites.set(campaignId, (pendingWrites.get(campaignId) ?? 0) + 1);
    setSavedMessage("");
    void updateCampaignConfiguration(campaignId, patch).catch((error: unknown) => {
      campaignWriteErrorsRef.current.set(
        campaignId,
        error instanceof Error ? error.message : "Could not save the campaign.",
      );
      refreshAfterCampaignWritesRef.current = true;
    }).finally(() => {
      const remaining = (pendingWrites.get(campaignId) ?? 1) - 1;
      if (remaining > 0) {
        pendingWrites.set(campaignId, remaining);
      } else {
        pendingWrites.delete(campaignId);
        if (selectedIdRef.current === campaignId) {
          setSavedMessage(campaignWriteErrorsRef.current.get(campaignId) ?? "");
        }
      }
      if (pendingWrites.size === 0 && refreshAfterCampaignWritesRef.current) {
        refreshAfterCampaignWritesRef.current = false;
        void refresh();
      }
    });
  };

  const beginDelete = (): void => {
    if (!selected) return;
    setDeleteError(null);
    void chrome.runtime.sendMessage({
      type: CAMPAIGN_DELETE_PREVIEW_REQUEST,
      campaignId: selected.campaignId,
    }).then((response: unknown) => {
      if (!isCampaignDeletePreviewResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      setDeletePrompt({
        campaign: selected,
        ...response.preview,
      });
    }).catch((error: unknown) => {
      setSavedMessage(
        error instanceof Error
          ? error.message
          : "Could not inspect the campaign.",
      );
    });
  };

  const confirmDelete = (mode: "detach-chats" | "delete-chats"): void => {
    if (!deletePrompt) return;
    setDeleteBusy(true);
    setDeleteError(null);
    void chrome.runtime.sendMessage({
      type: CAMPAIGN_DELETE_REQUEST,
      campaignId: deletePrompt.campaign.campaignId,
      mode,
    }).then(async (response: unknown) => {
      if (!isCampaignDeleteResponse(response)) {
        throw new Error("The extension returned an invalid response.");
      }
      if (!response.ok) throw new Error(response.error);
      setDeletePrompt(null);
      setSavedMessage("");
      await refresh();
    }).catch((error: unknown) => {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete the campaign.",
      );
    }).finally(() => setDeleteBusy(false));
  };

  if (!campaigns) {
    return <div className="section-loading"><p>Loading campaigns…</p></div>;
  }
  if (campaigns.length === 0 || !selected) {
    return (
      <section className="settings-panel simple-panel campaign-empty-state">
        <div className="settings-panel-heading">
          <p className="section-label">Campaign overrides</p>
          <h2>Campaigns</h2>
          <p>Campaigns appear here after you attach a chat from the side panel.</p>
        </div>
      </section>
    );
  }

  const overrideOptions = (globalDescription: string): React.JSX.Element => (
    <>
      <option value="inherit">Use global setting ({globalDescription})</option>
      <option value="enabled">Enabled</option>
      <option value="disabled">Disabled</option>
    </>
  );

  if (managingMemory) {
    return (
      <div className="profile-workspace">
        <aside className="profile-sidebar">
          <div className="sidebar-heading"><div><p className="section-label">Campaign overrides</p><h2>Campaigns</h2></div></div>
          <nav className="profile-list" aria-label="Known campaigns">
            {campaigns.map((campaign) => (
              <button className={campaign.campaignId === selectedId ? "profile-item selected" : "profile-item"} key={campaign.campaignId} onClick={() => chooseCampaign(campaign)} type="button">
                <span className="profile-item-topline"><strong>{campaign.name}</strong></span>
                <span>{profiles.find((profile) => profile.id === campaign.defaultProfileId)?.name ?? "General"} by default</span>
              </button>
            ))}
          </nav>
        </aside>
        <CampaignMemorySettings
          campaign={selected}
          onCountChange={setMemoryCount}
          onShowSettings={() => setManagingMemory(false)}
        />
      </div>
    );
  }

  return (
    <div className="profile-workspace">
      <aside className="profile-sidebar">
        <div className="sidebar-heading">
          <div>
            <p className="section-label">Campaign overrides</p>
            <h2>Campaigns</h2>
          </div>
        </div>
        <nav className="profile-list" aria-label="Known campaigns">
          {campaigns.map((campaign) => (
            <button
              className={campaign.campaignId === selectedId
                ? "profile-item selected"
                : "profile-item"}
              key={campaign.campaignId}
              onClick={() => chooseCampaign(campaign)}
              type="button"
            >
              <span className="profile-item-topline"><strong>{campaign.name}</strong></span>
              <span>{profiles.find((profile) => profile.id === campaign.defaultProfileId)?.name ?? "General"} by default</span>
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          Names follow Roll20 automatically. Overrides apply only to chats
          attached to that campaign.
        </p>
      </aside>

      <section className="editor-panel">
        <div className="editor-heading">
          <div className="editor-status-line">
            <span className="mode-badge">Campaign settings</span>
          </div>
          <h2>{selected.name}</h2>
          <p>Override global behavior and choose defaults for new empty chats.</p>
        </div>
        <div className="profile-form">
          <div className="form-grid">
            <label className="field field-wide">
              <span>Default profile for empty chats</span>
              <select
                onChange={(event) => {
                  const defaultProfileId = event.target.value;
                  updateConfiguration(
                    { defaultProfileId },
                    { ...draft, defaultProfileId },
                  );
                }}
                value={draft.defaultProfileId}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
              <small>Applied when an empty chat is attached. Existing conversations keep their profile.</small>
            </label>
            <label className="field field-wide">
              <span>Fetch from any web domain</span>
              <select value={draft.overrides.unrestrictedWebFetch} onChange={(event) => setOverride("unrestrictedWebFetch", event.target.value as CampaignOverride)}>
                {overrideOptions(globalUnrestrictedWebFetch ? "enabled" : "disabled")}
              </select>
              <small className="warning-note">Allows the model to access any website. Untrusted sites may expose the model to malicious or misleading content.</small>
            </label>
            <label className="field field-wide">
              <span>Web search</span>
              <select value={draft.overrides.webSearch} onChange={(event) => setOverride("webSearch", event.target.value as CampaignOverride)}>
                {overrideOptions(globalWebSearch ? "enabled" : "disabled")}
              </select>
              <small className="warning-note">Search results can contain untrusted content that influences model actions.</small>
            </label>
            <label className="field field-wide">
              <span>Require approval for Roll20 execution</span>
              <select value={draft.overrides.requireRoll20Approval} onChange={(event) => setOverride("requireRoll20Approval", event.target.value as CampaignOverride)}>
                {overrideOptions(globalRequireRoll20Approval ? "required" : "not required")}
              </select>
            </label>
            <label className="toggle-card field-wide campaign-memory-toggle">
              <input
                checked={draft.memoryEnabled}
                onChange={(event) => {
                  const memoryEnabled = event.target.checked;
                  updateConfiguration(
                    { memoryEnabled },
                    { ...draft, memoryEnabled },
                  );
                }}
                type="checkbox"
              />
              <span>
                <strong>Enable memory</strong>
                <small>Allow the assistant to store and retrieve durable information shared by chats attached to this campaign.</small>
              </span>
            </label>
            <div className="campaign-memory-summary field-wide">
              <span><strong>{memoryCount}</strong> stored {memoryCount === 1 ? "memory" : "memories"}</span>
              <button className="secondary-button" onClick={() => setManagingMemory(true)} type="button">Manage memory</button>
            </div>
          </div>
          <div className="form-actions">
            <button className="danger-button" onClick={beginDelete} type="button">Delete campaign</button>
            <div className="save-actions">
              {savedMessage ? <span className="saved-message" role="status">{savedMessage}</span> : null}
            </div>
          </div>
        </div>
      </section>

      {deletePrompt ? (
        <div className="campaign-delete-backdrop">
          <section aria-modal="true" className="campaign-delete-dialog" role="alertdialog">
            <h2>Delete {deletePrompt.campaign.name}?</h2>
            <p>This campaign has {deletePrompt.chatCount} attached {deletePrompt.chatCount === 1 ? "chat" : "chats"}.</p>
            <ul className="campaign-delete-impact">
              <li>{deletePrompt.activeChatCount} active {deletePrompt.activeChatCount === 1 ? "chat" : "chats"} will be stopped.</li>
              <li>{deletePrompt.pendingApprovalChatCount} {deletePrompt.pendingApprovalChatCount === 1 ? "chat has" : "chats have"} pending approvals that will be canceled.</li>
              <li>{deletePrompt.memoryCount} stored {deletePrompt.memoryCount === 1 ? "memory" : "memories"} will be permanently deleted.</li>
            </ul>
            {deletePrompt.activeChatCount > 0 ? (
              <p className="campaign-delete-warning" role="note">
                Roll20 actions already sent to the campaign cannot be canceled and may still finish after deletion.
              </p>
            ) : null}
            {deleteError ? <p className="campaign-delete-error" role="alert">{deleteError}</p> : null}
            <div className="campaign-delete-actions">
              <button className="primary-button" disabled={deleteBusy} onClick={() => confirmDelete("detach-chats")} type="button">Detach and keep chats</button>
              <button className="danger-button" disabled={deleteBusy} onClick={() => confirmDelete("delete-chats")} type="button">Delete chats too</button>
              <button className="secondary-button" disabled={deleteBusy} onClick={() => setDeletePrompt(null)} type="button">Cancel</button>
            </div>
          </section>
        </div>
      ) : null}
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
            your browser profile. Anyone or any software with access to that
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
  debugLoggingEnabled,
  maxSteps,
  requireRoll20Approval,
  unrestrictedWebFetchEnabled,
  webSearchEnabled,
  onDebugLoggingChange,
  onMaxStepsChange,
  onRequireRoll20ApprovalChange,
  onUnrestrictedWebFetchChange,
  onWebSearchChange,
}: {
  readonly debugLoggingEnabled: boolean;
  readonly maxSteps: number;
  readonly requireRoll20Approval: boolean;
  readonly unrestrictedWebFetchEnabled: boolean;
  readonly webSearchEnabled: boolean;
  readonly onDebugLoggingChange: (enabled: boolean) => void;
  readonly onMaxStepsChange: (steps: number) => void;
  readonly onRequireRoll20ApprovalChange: (enabled: boolean) => void;
  readonly onUnrestrictedWebFetchChange: (enabled: boolean) => void;
  readonly onWebSearchChange: (enabled: boolean) => void;
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
            checked={requireRoll20Approval}
            onChange={(event) =>
              onRequireRoll20ApprovalChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>Require approval for Roll20 execution</strong>
            <small>
              Pauses every model-requested Roll20 command so you can review its
              action and generated JavaScript before it runs. Campaign
              discovery and compatibility checks do not require approval.
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

        <label className="toggle-card behavior-card">
          <input
            checked={webSearchEnabled}
            onChange={(event) => onWebSearchChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Allow web searching</strong>
            <small className="warning-note">
              Privacy and security risk. This allows the model to send search
              queries to OpenRouter and Exa. Queries may reveal conversation
              details, results may contain malicious instructions, and every
              search may incur additional charges.
            </small>
          </span>
        </label>

      </div>
    </section>
  );
}

function OptionsApp(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profiles");
  const [campaignNavigationVersion, setCampaignNavigationVersion] = useState(0);
  const [theme, setTheme] = useState<DisplayTheme>(DEFAULT_DISPLAY_THEME);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(false);
  const [unrestrictedWebFetchEnabled, setUnrestrictedWebFetchEnabled] =
    useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [requireRoll20Approval, setRequireRoll20Approval] = useState(false);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPreferences = (): void => {
      void getGlobalPreferences().then((preferences) => {
        if (cancelled) return;
        setTheme(preferences.displayTheme);
        setDebugLoggingEnabled(preferences.debugLoggingEnabled);
        setMaxSteps(preferences.maximumSteps);
        setUnrestrictedWebFetchEnabled(
          preferences.unrestrictedWebFetchEnabled,
        );
        setWebSearchEnabled(preferences.webSearchEnabled);
        setRequireRoll20Approval(preferences.requireRoll20Approval);
      });
    };
    const handleMessage = (message: unknown): void => {
      if (
        isDurableDataChangedMessage(message) &&
        message.stores.includes("settings")
      ) loadPreferences();
    };
    loadPreferences();
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);
  useEffect(() => applyDisplayTheme(theme), [theme]);

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
    void updateGlobalPreferences({ displayTheme: nextTheme });
  };

  const changeDebugLogging = (enabled: boolean): void => {
    setDebugLoggingEnabled(enabled);
    void updateGlobalPreferences({ debugLoggingEnabled: enabled });
  };

  const changeMaxSteps = (steps: number): void => {
    const normalized = normalizeMaxSteps(steps);
    setMaxSteps(normalized);
    void updateGlobalPreferences({ maximumSteps: normalized });
  };

  const changeUnrestrictedWebFetch = (enabled: boolean): void => {
    setUnrestrictedWebFetchEnabled(enabled);
    void updateGlobalPreferences({ unrestrictedWebFetchEnabled: enabled });
  };

  const changeWebSearch = (enabled: boolean): void => {
    setWebSearchEnabled(enabled);
    void updateGlobalPreferences({ webSearchEnabled: enabled });
  };

  const changeRequireRoll20Approval = (enabled: boolean): void => {
    setRequireRoll20Approval(enabled);
    void updateGlobalPreferences({ requireRoll20Approval: enabled });
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
      description: "Games, guidance, and models",
    },
    {
      id: "campaigns",
      label: "Campaigns",
      description: "Defaults and behavior overrides",
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
          <h1>GM Tools for VTT Settings</h1>
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
              onClick={() => {
                if (tab.id === "campaigns") {
                  setCampaignNavigationVersion((version) => version + 1);
                }
                setActiveTab(tab.id);
              }}
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
          <div hidden={activeTab !== "campaigns"}>
            <CampaignsSettings
              active={activeTab === "campaigns"}
              globalRequireRoll20Approval={requireRoll20Approval}
              globalUnrestrictedWebFetch={unrestrictedWebFetchEnabled}
              globalWebSearch={webSearchEnabled}
              navigationVersion={campaignNavigationVersion}
            />
          </div>
          <div hidden={activeTab !== "display"}>
            <DisplaySettings onChange={changeTheme} theme={theme} />
          </div>
          <div hidden={activeTab !== "behavior"}>
            <BehaviorSettings
              debugLoggingEnabled={debugLoggingEnabled}
              maxSteps={maxSteps}
              onDebugLoggingChange={changeDebugLogging}
              onMaxStepsChange={changeMaxSteps}
              onRequireRoll20ApprovalChange={changeRequireRoll20Approval}
              onUnrestrictedWebFetchChange={changeUnrestrictedWebFetch}
              onWebSearchChange={changeWebSearch}
              requireRoll20Approval={requireRoll20Approval}
              unrestrictedWebFetchEnabled={unrestrictedWebFetchEnabled}
              webSearchEnabled={webSearchEnabled}
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
