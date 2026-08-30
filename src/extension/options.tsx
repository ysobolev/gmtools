import { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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

type EditorMode =
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly profileId: string };

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

function OptionsApp(): React.JSX.Element {
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
  const dirty = mode.kind === "new" || !savedProfile || !profilesEqual(draft, savedProfile);

  if (!profiles) {
    return (
      <main className="loading-shell" aria-live="polite">
        <div className="loading-mark" aria-hidden="true" />
        <p>Loading profiles…</p>
      </main>
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
    const profile = savedProfile ??
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
    <main className="options-shell">
      <header className="options-header">
        <div className="brand-mark" aria-hidden="true">✦</div>
        <div>
          <p className="eyebrow">ROLL20 ASSISTANT</p>
          <h1>GM Tools settings</h1>
        </div>
      </header>

      <div className="options-layout">
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
            Choose the active profile from the GM Tools side panel.
          </p>
        </aside>

        <section className="editor-panel">
          <div className="editor-heading">
            <div>
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
                <small>{draft.additionalInstructions.length.toLocaleString()} / 8,000 characters</small>
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
                {savedMessage ? <span className="saved-message" role="status">{savedMessage}</span> : null}
                {dirty ? (
                  <button className="secondary-button" onClick={cancelChanges} type="button">
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
    </main>
  );
}

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("Missing options-page root element.");
createRoot(rootElement).render(<OptionsApp />);
