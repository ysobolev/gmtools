# GM Tools for VTT

### Sandbox runtime diagnostics

Campaign handshakes record the last-known Roll20 `sandboxVersion` as a string,
without probing or listing API capabilities. This is separate from the GM Tools
bridge version. Replacing the campaign Mod script with the newly built script is
required to report these diagnostics; an older bridge remains compatible but
does not report them. The campaign record caches the observation for offline
attachments, and attachment notices and run-configuration snapshots include it.
No extra handshake is introduced on chat switching. Failed handshakes do not
overwrite the last successful observation.

The runtime identifier comes from `Campaign().sandboxVersion`, a direct JavaScript
property documented by the [Roll20 production team](https://app.roll20.net/forum/post/12319797/mod-api-server-release-apr-18th-2025).
Historically it returned `default` or `experimental`; these are preserved verbatim,
not translated into guessed numeric versions. Missing identifiers are recorded as
unknown (the optional field is omitted). No `v` prefix is added or removed.
Prompt guidance uses documented version differences: `getSheetItem`/`setSheetItem`
exist in both generations, while `getComputed`/`setComputed` require v1.5.
Legacy 2014 sheet work remains supported;
Beacon 2024 work requires the v1.5 capabilities.

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
- An OpenRouter account with available credit, or a provided OpenRouter API key
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

Alternatively, choose **Use an API key instead** on the login screen and paste a
regular OpenRouter API key (not a management key). The extension verifies it
before signing in. Usage is charged to the key owner's account; a tester using
a provided key does not need their own OpenRouter account. Use a dedicated key
with a spending limit when providing access to someone else.

The standard login uses OpenRouter's OAuth PKCE flow. It does not require an OAuth
client ID or client secret. Each browser derives its own callback URL from its
extension identity. Both login methods store the API key in extension session
storage. The worker does not return it to the side panel or Roll20 content script,
and it is cleared when the
browser exits or the extension is reloaded. Users may opt
into **Keep me signed in** on the login screen or from **Settings > Authentication**;
this stores the key in extension local storage, which is not a credential vault,
with a warning about storage on this device. Logging out clears both session and persistent
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

### Local run diagnostics

Before each model run, the worker saves a deduplicated configuration snapshot in
the `runSnapshots` IndexedDB store. It records the resolved system prompt, model
and provider options, active tool definitions, effective behavior settings,
extension build, and profile/campaign identities and names. Authentication keys
are not included. Prompts and campaign names may still contain private data.

The initiating user message's `metadata.gmToolsSubmissions` array records the
run ID, timestamp, submission kind, and snapshot hash. Resume, Retry, and approval
responses append their own markers without adding visible or model-facing prose.
Reconnecting to an existing stream does not create a new run. Snapshots are
collected when their last owning chat is deleted; detaching keeps diagnostics.
Existing conversations are not backfilled. This is local diagnostic storage,
not telemetry or an automatic feedback upload.

The **Feedback** button beside the model name opens a local report form. **Export**
downloads a JSON file to share manually by email or direct message. Conversation
history is included by default, while stored images are opt-in. Unchecking the
conversation excludes its history, snapshots, campaign details, and visible error.
Reports use saved history, so an in-progress response may be absent. Review the
file before sharing: conversations and prompts can contain private information.

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
  profile validation.
- `src/extension/prompts` contains the prompt text and profile prompt assembly.
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
