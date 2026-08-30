# GM Tools for Roll20 (proof of concept)

This repository contains a Chrome side-panel extension and a Roll20 Mod script.
The extension sends a hidden Mod command through Roll20 chat, the Mod sandbox
generates a random number, and the result appears in the side panel.

## Requirements

- Chrome 114 or newer
- A Roll20 game whose creator has a Pro subscription (required for Mod scripts)
- GM access to that game

## Install the Roll20 Mod script

1. Open the Roll20 game's landing page.
2. Choose **Settings > Mod (API) Scripts**.
3. Create a new script named `GMToolsPoc`.
4. Copy the contents of [`roll20-mod/GMToolsPoc.js`](roll20-mod/GMToolsPoc.js)
   into the editor and save it.
5. Confirm that the sandbox console prints `GM Tools POC ready`.

## Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` directory in this repo.
4. Open the Roll20 game and reload its virtual tabletop tab.
5. Click the extension's toolbar icon to open **GM Tools** in the side panel.
6. Open Roll20's Chat tab, then click **Generate** in the side panel.

The panel should display a value from 1 to 100.

## Protocol

The content script submits this Roll20 API command through the normal chat UI:

```text
!gmtools-poc <request-id>
```

Roll20 delivers `!` commands to `on('chat:message')` as `type: 'api'` without
showing them in chat. The Mod script validates that the sender is a GM and sends
a correlated response as a GM whisper:

```text
GMTOOLS_RESPONSE:<request-id>:<number>
```

The response uses Roll20's `noarchive` option. A `MutationObserver` in the
extension recognizes the marker, removes its message node before the next paint,
and forwards the parsed result to the side panel.

## POC limitations

- The Roll20 Chat tab must have been opened so its input exists in the page.
- DOM selectors are necessarily coupled to Roll20's current chat UI and may need
  adjustment if Roll20 changes its markup.
- Mutation-observer removal prevents normal display, but the response briefly
  exists in the DOM before the observer callback runs.
- Chrome is the only supported browser in this pass.
