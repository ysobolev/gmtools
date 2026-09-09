# GM Tools for VTT

GM Tools for VTT is an AI assistant for tabletop game masters, available as a
Chrome side panel or Firefox sidebar. Use it to prepare sessions, improvise NPCs,
develop plots, discuss rules, and work with images—all alongside your game.

Attach a Roll20 campaign to let the assistant inspect and modify your game through
the Roll20 Mod API. It can create characters, update sheets, and perform other
sandbox operations.

- Keep multiple chats organized by campaign.
- Choose an OpenRouter model and customize assistant profiles for your game.
- Paste or drag images into chat, and generate images with supported models.
- Share memories between chats in the same campaign.
- Control web access and execution approval globally or per campaign.

## Requirements

- **Browser:** Chrome 114 or newer, or Firefox 140 or newer.
- **Model access:** an OpenRouter account with sufficient credit for the selected
  model, or a provided OpenRouter API key. Model and server-tool usage is billed
  by OpenRouter to the key owner's account. OpenRouter also offers some free models.
- **For Roll20 integration:** GM access to a campaign whose creator has a Pro
  subscription, plus the GM Tools Mod script installed in that campaign.
- **For Beacon sheet operations:** Roll20 Mod Sandbox v1.5. Non-Beacon
  sheet operations can also work with the v1.0 sandbox.

Roll20 access is not required for ordinary chat and campaign preparation.

## Quick start

### 1. Install the extension

Until store builds are available, clone or download this repository. Its
`generated/` directory contains the built extensions.

**Chrome**

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `generated/chrome`.
3. Click the GM Tools toolbar icon to open the side panel.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `generated/firefox/manifest.json`.
3. Click the GM Tools toolbar icon to open the sidebar.

Firefox temporary installations must be loaded again after restarting the browser.

### 2. Connect OpenRouter

Click **Connect OpenRouter** and complete authorization.

By default, you will need to sign in again after restarting the browser. Select
**Keep me signed in** to remember your login on this device. You can change this
choice under **Settings > Authentication**. Logging out removes the saved login.

You can now send a message without connecting Roll20.

### 3. Connect a Roll20 campaign

1. Open the campaign's landing page and choose **Settings > Mod (API) Scripts**.
2. Create a script named `gmtools.js`, paste the contents of
   [`generated/roll20-mod/GMToolsPoc.js`](generated/roll20-mod/GMToolsPoc.js), and save.
3. Launch the game as GM and allow the sandbox to start.
4. In GM Tools, create a chat and click **Attach** in the campaign banner.
   Choose the campaign if prompted.
5. Try: “Use Roll20 to roll a d20 and tell me the result.”

The attached campaign appears in the banner. Chats retain their campaign
attachment when reopened; the extension rediscovers the appropriate tab as needed.

The assistant can execute GM-level code and make mistakes. For an approval step
before execution, enable **Require approval for Roll20 execution** under
**Settings > Behavior**, or override it for an individual campaign. Stopping a
chat cannot undo or cancel code already dispatched to the Roll20 sandbox.

### 4. Customize your assistant

Open the chat drawer and use **Settings** in its footer.

- **Profiles:** choose a game, model, and optional custom instructions. Use the
  D&D 5e game setting for the built-in character-creation guidance. Switching
  profiles does not clear chat history; edits take effect on the next submission.
- **Campaigns:** set a default profile, override behavior settings, and optionally
  enable shared campaign memory. Stored memories can be viewed and deleted here.
- **Behavior:** configure web searching, unrestricted web fetching, execution
  approval, and the model step limit. Review the warnings before enabling web tools.
- **Display:** use your system theme or select light or dark mode.

Paste or drag images into the composer to attach them. Some webpage image drops,
particularly in Firefox, may require permission to download from the image's host.
Generated images can be dragged directly from the sidebar onto the Roll20 canvas.
To use Roll20's Art Library upload control instead, save the image to disk first.

### Feedback and local data

Use **Feedback** beside the model name to submit a report, optionally including an
email address for a reply. Chat history and diagnostic snapshots are included by
default; images are opt-in. **Export as JSON** saves a report for manual sharing.

Your chats and settings are saved in your browser. You can choose to include chat
data when submitting feedback. Only share campaign information you are comfortable
sending to the developer.

## Development

### Requirements

- Git
- Node.js 22 (the version used in CI)
- pnpm 9.15.0 (pinned in `package.json`)
- A supported browser for manual testing
- OpenRouter access for live model tests, and a suitable Roll20 campaign for
  integration tests

The automated application tests do not require live OpenRouter or Roll20 access.
Terraform is needed only for feedback infrastructure work; see
[`infra/feedback/README.md`](infra/feedback/README.md).

### Getting started

```sh
pnpm install --frozen-lockfile
pnpm build
```

Load the extension using the [quick-start instructions](#1-install-the-extension).
After source changes, rebuild and reload the extension. If you change the Mod
implementation, also replace the script in your test campaign.

Edit authored files under `src/`, not `generated/`. Generated artifacts are
checked in; include rebuilt output with source changes. `package.json` is the
single source of truth for the extension version, which the build inserts into
both manifest templates. The Mod bridge and wire protocol are versioned separately.

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Type-check and build both extensions, the Mod, and feedback Worker |
| `pnpm typecheck` | Type-check without generating output |
| `pnpm test` | Build and run the automated tests |
| `pnpm check` | Alias for `pnpm test` |
| `pnpm chrome:package` | Build a Chrome ZIP under `dist/chrome/` |
| `pnpm firefox:package` | Build a Firefox ZIP under `dist/firefox/` |
| `pnpm firefox:lint` | Build and check Firefox extension packaging rules |
| `pnpm firefox:run` | Build and launch Firefox with the extension |
| `pnpm feedback:build` | Build just the feedback Worker |

CI runs application tests, Terraform validation and mocked tests, and checks that
the generated artifacts match the source. Packaging outputs under `dist/` are
gitignored.

See [Diagnostics](docs/diagnostics.md) for run snapshots and sandbox-version
observations, and the [feedback infrastructure guide](infra/feedback/README.md)
for Worker deployment and validation.

## Architecture

### Browser extension

- **Chat interface** — `src/extension/sidepanel.tsx` provides the React chat UI,
  campaign attachment, image attachments, and chat navigation.
- **Settings interface** — `src/extension/options.tsx` manages profiles,
  campaigns, memory, appearance, authentication, and behavior.
- **Background worker** — `src/extension/service-worker.ts` owns credentials,
  model requests, active conversation jobs, and Roll20 routing. Tasks can continue
  while the sidebar is closed. Different chats can run concurrently, while
  Roll20 execution is serialized per campaign.
- **Chat transport** — `src/extension/extension-chat-transport.ts` carries AI SDK
  UI streams over extension runtime ports between the worker and sidebar.
- **Persistence** — `src/extension/database.ts`, the migration registry, and
  `*-store.ts` modules manage IndexedDB records and notify interfaces of changes.
  Credentials remain separate in browser extension storage.
- **Profiles and prompts** — `src/extension/profile-config.ts` defines profile
  configuration; `src/extension/prompts/` holds prompt text and assembly. The
  resolved prompt is rebuilt for each submission from the current configuration.
  The read-only `read_guide` tool loads bundled sheet guides on demand for any
  profile. Its catalog lives in `src/extension/prompts/guides.ts`; detailed D&D
  recipes are tool results rather than part of every system prompt.
  Guide text lives in `src/extension/prompts/guides/*.md` and is bundled as text
  at build time; reading a guide requires no network or filesystem access.
- **Assets and builds** — manifest templates live in `src/extension/`; static
  styles, HTML, and icons live in `src/extension/static/`. `scripts/build.mjs`
  produces `generated/chrome/` and `generated/firefox/`.

### Roll20 bridge and Mod

`src/extension/content-script.ts` connects the extension to the Roll20 page.
`src/protocol.ts` defines the shared message format, and `src/roll20-mod/` contains
the sandbox implementation. The generated Mod lives in `generated/roll20-mod/`.

The model's `execute_roll20` tool relays JavaScript through an encoded API chat
command. The Mod runs on Roll20's servers, accepts commands only from a GM, and
evaluates the code as a function body with access to Roll20 globals. Returned promises are awaited;
return values must be JSON-serializable. Acknowledgments, results, and errors
travel back through marked, non-archived whispers that the content script filters
from the visible chat when recognized.

Campaign handshakes establish identity and compatibility. Durable chat attachments
are separate from ephemeral `campaignId -> tabId` routes shared by chats in the
same campaign. The last-known sandbox runtime version is retained for diagnostics;
switching chats does not trigger an extra sandbox handshake.

### Feedback service

The extension constructs reports locally and either downloads them as JSON or
submits them to a Cloudflare Worker. `src/feedback-schema.ts` defines the shared
report schema. Worker source lives under `src/feedback-worker/`, with its generated
bundle under `generated/feedback-worker/`.

The Worker validates and size-limits reports, applies rate limits, and writes them
to a private R2 bucket. It has no public report-reading endpoint. Terraform under
`infra/feedback/` manages the service, storage retention, and observability.
