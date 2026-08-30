// Generated from TypeScript by `npm run build`. Do not edit directly.
"use strict";
(() => {
  // src/extension/service-worker.ts
  function enableActionClick() {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  chrome.runtime.onInstalled.addListener(enableActionClick);
  chrome.runtime.onStartup.addListener(enableActionClick);
})();
