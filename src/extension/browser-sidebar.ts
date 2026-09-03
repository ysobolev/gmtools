export interface BrowserSidebarApi {
  readonly sidePanel?: {
    setPanelBehavior(options: {
      readonly openPanelOnActionClick: boolean;
    }): Promise<void>;
  };
  readonly sidebarAction?: {
    open(): Promise<void>;
  };
}

export interface ActionClickedEvent {
  addListener(listener: () => void): void;
}

export function configureBrowserSidebar(
  api: BrowserSidebarApi,
  actionClicked: ActionClickedEvent,
): () => void {
  if (api.sidePanel) {
    const refresh = (): void => {
      void api.sidePanel
        ?.setPanelBehavior({ openPanelOnActionClick: true })
        .catch(() => undefined);
    };
    refresh();
    return refresh;
  }

  if (api.sidebarAction) {
    const sidebarAction = api.sidebarAction;
    actionClicked.addListener(() => {
      void sidebarAction.open().catch(() => undefined);
    });
  }
  return () => undefined;
}
