interface StorageAreaAccessControl {
  setAccessLevel?(options: {
    readonly accessLevel: "TRUSTED_CONTEXTS";
  }): Promise<void>;
}

export interface BrowserStorageAccessControl {
  readonly local: StorageAreaAccessControl;
  readonly session: StorageAreaAccessControl;
}

export function restrictExtensionStorage(
  storage: BrowserStorageAccessControl,
): void {
  for (const area of [storage.session, storage.local]) {
    if (typeof area.setAccessLevel !== "function") continue;
    void area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      .catch(() => undefined);
  }
}
