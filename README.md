# GM Tools for Roll20

GM Tools is a Chrome side-panel assistant for Roll20 game masters. It connects
directly to OpenRouter, streams ordinary chat responses in the panel, and keeps
the user-controlled API key in browser memory by default.

The assistant has one model-visible Roll20 tool, `execute_roll20`, which relays
JavaScript through a hidden API chat command and executes it in the campaign's
Mod sandbox. Results and errors return to the model through a private,
non-archived whisper that the extension removes before display.

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
and is cleared when Chrome exits or the extension is reloaded. Users may opt
into persistent login from **Settings > Authentication**; this stores the key
in `chrome.storage.local`, which is not a credential vault, and is explicitly
labeled as a security risk. Logging out clears both session and persistent
credential storage.

**Settings > Display** can follow the operating-system theme or force light or
dark mode. The default is the system theme, and changes apply to both the full
settings page and side panel.

Use **Profiles** in the chat header to open the full-page profile editor. Each
profile selects a game, Roll20 character sheet, and model, with optional custom
prompt instructions. The first pass includes D&D 5e, Vampire: The Masquerade
V5, and a custom game option, plus GPT-5.2 and Claude Sonnet 4.6. Profile
configuration is stored in `chrome.storage.local` and synchronizes with the
side panel while both are open. Changing or editing the active profile starts a
new chat.

## Development

Useful commands:

```sh
pnpm typecheck
pnpm test
pnpm check
```

Authored code lives under `src`:

- `src/extension/sidepanel.tsx` contains the React side-panel interface.
- `src/extension/options.tsx` contains the full-page profile editor.
- `src/extension/service-worker.ts` owns OAuth, credentials, and model requests.
- `src/extension/extension-chat-transport.ts` bridges AI SDK UI streams over a
  Chrome runtime port.
- `src/extension/openrouter-auth.ts` contains the testable PKCE and response
  parsing helpers.
- `src/extension/profile-config.ts` defines supported games, sheets, models, and
  the layered prompt assembled for each profile.
- `src/protocol.ts` and `src/extension/content-script.ts` implement the encoded
  Roll20 Mod bridge.
- `src/roll20-mod` contains the Mod implementation and Roll20 global types.

The checked-in `extension` and `roll20-mod` directories are generated artifacts.
Do not edit them directly.

## Roll20 execution bridge

To load the Mod script for development:

1. Open the Roll20 game's landing page.
2. Choose **Settings > Mod (API) Scripts**.
3. Create a script named `GMToolsPoc`.
4. Copy `roll20-mod/GMToolsPoc.js` into the editor and save it.

Reload the unpacked extension after each build. Keep the desired Roll20 campaign
tab focused and its Chat tab available when asking the assistant to inspect or
modify the game. The worker injects the content-script bridge on demand if an
already-open Roll20 tab predates the extension reload. For example: “Use Roll20
to roll a d20 and tell me the result.”

The code supplied to `execute_roll20` is evaluated as a function body with
access to Roll20 Mod globals. Explicit return values must be JSON-serializable;
returned promises are awaited. The bridge accepts commands only from a Roll20
GM. API commands are hidden by Roll20, and marked result whispers use
`noarchive` and are removed from the live chat DOM by a `MutationObserver`.
