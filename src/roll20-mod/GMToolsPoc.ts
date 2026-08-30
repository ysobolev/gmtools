import {
  formatRoll20ExecuteResponse,
  parseRoll20ExecuteCommand,
  type Roll20ExecutionOutcome,
} from "../protocol";

function errorOutcome(error: unknown): Roll20ExecutionOutcome {
  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  return {
    ok: false,
    error: { name: "Error", message: String(error) },
  };
}

function sendOutcome(requestId: string, outcome: Roll20ExecutionOutcome): void {
  let response: string;
  try {
    response = formatRoll20ExecuteResponse(requestId, outcome);
  } catch (error) {
    response = formatRoll20ExecuteResponse(requestId, errorOutcome(error));
  }

  // noarchive prevents persistence in the chat archive. The extension removes
  // this marked GM whisper from the live DOM before the next paint.
  sendChat("GM Tools", `/w gm ${response}`, null, { noarchive: true });
}

function executeCode(requestId: string, code: string): void {
  try {
    const evaluate = eval;
    const result: unknown = evaluate(`(function () {\n${code}\n})()`);
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).then(
        (value) => sendOutcome(requestId, { ok: true, result: value ?? null }),
        (error: unknown) => sendOutcome(requestId, errorOutcome(error)),
      );
      return;
    }
    sendOutcome(requestId, { ok: true, result: result ?? null });
  } catch (error) {
    sendOutcome(requestId, errorOutcome(error));
  }
}

function handleChatMessage(message: Roll20ChatMessage): void {
  if (message.type !== "api" || !playerIsGM(message.playerid)) return;

  const command = parseRoll20ExecuteCommand(message.content);
  if (!command) return;
  executeCode(command.requestId, command.code);
}

on("ready", () => {
  on("chat:message", handleChatMessage);
  log("GM Tools execution bridge ready");
});
