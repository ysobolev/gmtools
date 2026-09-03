# GM Tools for VTT

GM Tools for VTT is a Chrome and Firefox sidebar assistant for virtual tabletop
game masters, initially integrating with Roll20. It connects directly to
OpenRouter, streams ordinary chat responses in the panel, and keeps the
user-controlled API key in browser memory by default.

The assistant has one model-visible Roll20 tool, `execute_roll20`, which relays
JavaScript through a hidden API chat command and executes it in the campaign's
Mod sandbox. Results and errors return to the model through a private,
non-archived whisper that the extension removes before display.

## Requirements

- Chrome 114 or newer, or Firefox 140 or newer
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
4. Click **Load unpacked** and select the `generated/chrome` directory.
5. Click the extension toolbar icon to open **GM Tools for VTT** in the side panel.
6. Click **Connect OpenRouter**, authorize the app, and send a message.

## Load the Firefox extension

1. Install the development dependencies and build the extension:

   ```sh
   pnpm install
   pnpm build
   ```

2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on**.
4. Select `generated/firefox/manifest.json`.
5. Click the extension toolbar action to open **GM Tools for VTT** in the sidebar.
6. Click **Connect OpenRouter**, authorize the app, and send a message.

The extension uses OpenRouter's OAuth PKCE flow. It does not require an OAuth
client ID or client secret. Each browser derives its own callback URL from its
extension identity. The issued API key is stored in extension session storage,
is not sent to the side panel or Roll20 content script, and is cleared when the
browser exits or the extension is reloaded. Users may opt
into persistent login from **Settings > Authentication**; this stores the key
in extension local storage, which is not a credential vault, and is explicitly
labeled as a security risk. Logging out clears both session and persistent
credential storage.

**Settings > Display** can follow the operating-system theme or force light or
dark mode. The default is the system theme, and changes apply to both the full
settings page and side panel.

Images can be pasted, dropped from disk, or dragged from another webpage into
the message composer. Webpage image drags may prompt for access to that image's
origin so the extension can download and store it locally with the chat.

Use **Settings** in the chat header to open the full-page profile editor. Each
profile selects a game, Roll20 character sheet, and model, with optional custom
prompt instructions. The first pass includes D&D 5e, Vampire: The Masquerade
V5, and a custom game option, plus supported OpenAI and Claude models. Profile
configuration is stored in extension local storage and synchronizes with the
side panel while both are open. Profiles can be changed per chat without
clearing its history.

## Development

Useful commands:

```sh
pnpm typecheck
pnpm test
pnpm check
pnpm chrome:package
pnpm firefox:lint
pnpm firefox:run
pnpm firefox:package
```

Authored code lives under `src`:

- `src/extension/sidepanel.tsx` contains the React side-panel interface.
- `src/extension/options.tsx` contains the full-page profile editor.
- `src/extension/service-worker.ts` owns OAuth, credentials, and model requests.
- `src/extension/extension-chat-transport.ts` bridges AI SDK UI streams over a
  browser extension runtime port.
- `src/extension/openrouter-auth.ts` contains the testable PKCE and response
  parsing helpers.
- `src/extension/profile-config.ts` defines supported games, sheets, models, and
  the layered prompt assembled for each profile.
- `src/protocol.ts` and `src/extension/content-script.ts` implement the encoded
  Roll20 Mod bridge.
- `src/roll20-mod` contains the Mod implementation and Roll20 global types.

The checked-in `generated/chrome`, `generated/firefox`, and
`generated/roll20-mod` directories are generated artifacts. Do not edit them
directly.

## Roll20 execution bridge

To load the Mod script for development:

1. Open the Roll20 game's landing page.
2. Choose **Settings > Mod (API) Scripts**.
3. Create a script named `GMToolsPoc`.
4. Copy `generated/roll20-mod/GMToolsPoc.js` into the editor and save it.

Reload the development extension after each build. The worker injects the
content-script bridge on demand if an
already-open Roll20 tab predates the extension reload. For example: “Use Roll20
to roll a d20 and tell me the result.”

The code supplied to `execute_roll20` is evaluated as a function body with
access to Roll20 Mod globals. Explicit return values must be JSON-serializable;
returned promises are awaited. The bridge accepts commands only from a Roll20
GM. API commands are hidden by Roll20, and marked result whispers use
`noarchive` and are removed from the live chat DOM by a `MutationObserver`.
