# GM Tools for Roll20

GM Tools is a Chrome side-panel assistant for Roll20 game masters. It connects
directly to OpenRouter, streams ordinary chat responses in the panel, and keeps
the user-controlled API key in browser memory for the current Chrome session.

The repository also retains the proof-of-concept Roll20 Mod bridge. Its UI is
temporarily hidden while the assistant chat is developed, but the content
script, shared protocol, Mod script, and tests remain in place for upcoming tool
calling.

## Requirements

- Chrome 114 or newer
- An OpenRouter account with available credit
- A Roll20 game whose creator has a Pro subscription when testing the Mod bridge

## Load the Chrome extension

1. Install the development dependencies and build the extension:

   ```sh
   pnpm install
   pnpm build
   ```

2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension` directory.
5. Click the extension toolbar icon to open **GM Tools** in the side panel.
6. Click **Connect OpenRouter**, authorize the app, and send a message.

The extension uses OpenRouter's OAuth PKCE flow. It does not require an OAuth
client ID or client secret. The issued API key is stored in
`chrome.storage.session`, is not sent to the side panel or Roll20 content script,
and is cleared when Chrome exits or the extension is reloaded.

The current model is configured in `src/extension/openrouter-config.ts`.

## Development

Useful commands:

```sh
pnpm typecheck
pnpm test
pnpm check
```

Authored code lives under `src`:

- `src/extension/sidepanel.tsx` contains the React side-panel interface.
- `src/extension/service-worker.ts` owns OAuth, credentials, and model requests.
- `src/extension/extension-chat-transport.ts` bridges AI SDK UI streams over a
  Chrome runtime port.
- `src/extension/openrouter-auth.ts` contains the testable PKCE and response
  parsing helpers.
- `src/protocol.ts` and `src/extension/content-script.ts` retain the Roll20 Mod
  bridge.
- `src/roll20-mod` contains the Mod implementation and Roll20 global types.

The checked-in `extension` and `roll20-mod` directories are generated artifacts.
Do not edit them directly.

## Retained Roll20 Mod bridge

To load the proof-of-concept Mod script for development:

1. Open the Roll20 game's landing page.
2. Choose **Settings > Mod (API) Scripts**.
3. Create a script named `GMToolsPoc`.
4. Copy `roll20-mod/GMToolsPoc.js` into the editor and save it.

The content script still recognizes the private random-number protocol and
removes marked response whispers with a `MutationObserver`. The chat side panel
does not currently invoke that protocol.
