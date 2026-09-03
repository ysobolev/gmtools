# Manual Firefox checklist

- Load `generated/firefox/manifest.json` as a temporary add-on in
  `about:debugging#/runtime/this-firefox`.
- Confirm the toolbar action opens the GM Tools sidebar.
- Complete OpenRouter PKCE login and verify the callback returns to the sidebar.
- Open settings and verify profiles, behavior, authentication, and display theme.
- Attach chats to one and multiple Roll20 campaigns, then execute a Mod command.
- Close and reopen the sidebar while a model response or Roll20 task is running.
- Confirm chats, generated images, and uploaded images restore from IndexedDB.
- Reload the add-on and confirm stale content scripts are reinjected on demand.
- Restart Firefox and confirm chats persist while campaign routes are rediscovered.
