import { formatRandomResponse, parseRandomCommand } from "../protocol";

function handleChatMessage(message: Roll20ChatMessage): void {
  if (message.type !== "api" || !playerIsGM(message.playerid)) return;

  const requestId = parseRandomCommand(message.content);
  if (!requestId) return;

  const value = randomInteger(100);
  const response = formatRandomResponse(requestId, value);

  // noarchive prevents persistence in the chat archive. The extension removes
  // this marked GM whisper from the live DOM before the next paint.
  sendChat("GM Tools", `/w gm ${response}`, null, { noarchive: true });
}

on("ready", () => {
  on("chat:message", handleChatMessage);
  log("GM Tools POC ready");
});
