// GM Tools proof-of-concept Roll20 Mod script.
// Install from your game's Settings > Mod (API) Scripts page.

var GMToolsPoc = GMToolsPoc || (function () {
    'use strict';

    var COMMAND = '!gmtools-poc';
    var REQUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;

    function handleChatMessage(msg) {
        if (msg.type !== 'api') {
            return;
        }

        var parts = msg.content.trim().split(/\s+/);
        if (parts[0] !== COMMAND) {
            return;
        }

        // Only a GM may use the browser-to-sandbox bridge.
        if (!playerIsGM(msg.playerid)) {
            return;
        }

        var requestId = parts[1];
        if (parts.length !== 2 || !REQUEST_ID_PATTERN.test(requestId)) {
            return;
        }

        var value = randomInteger(100);
        var response = 'GMTOOLS_RESPONSE:' + requestId + ':' + value;

        // noarchive prevents the response from being stored in the chat archive.
        // The extension removes this marked GM whisper before the next paint.
        sendChat('GM Tools', '/w gm ' + response, null, { noarchive: true });
    }

    function registerEventHandlers() {
        on('chat:message', handleChatMessage);
    }

    return {
        registerEventHandlers: registerEventHandlers
    };
}());

on('ready', function () {
    'use strict';
    GMToolsPoc.registerEventHandlers();
    log('GM Tools POC ready');
});
