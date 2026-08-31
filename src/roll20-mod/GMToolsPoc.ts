import {
  ROLL20_MOD_VERSION,
  ROLL20_PROTOCOL_VERSION,
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
  log(`GM Tools response submitted: ${requestId}`);
}

function completeExecution(
  requestId: string,
  outcome: Roll20ExecutionOutcome,
): void {
  log(
    `GM Tools execution completed: ${requestId} (${outcome.ok ? "success" : "error"})`,
  );
  sendOutcome(requestId, outcome);
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
        (value) =>
          completeExecution(requestId, {
            ok: true,
            result: value ?? null,
          }),
        (error: unknown) => completeExecution(requestId, errorOutcome(error)),
      );
      return;
    }
    completeExecution(requestId, { ok: true, result: result ?? null });
  } catch (error) {
    completeExecution(requestId, errorOutcome(error));
  }
}

function handleChatMessage(message: Roll20ChatMessage): void {
  if (message.type !== "api" || !playerIsGM(message.playerid)) return;

  const command = parseRoll20ExecuteCommand(message.content);
  if (!command) return;
  log(
    `GM Tools command received: ${command.requestId} (protocol ${command.protocolVersion})`,
  );
  if (command.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
    sendOutcome(command.requestId, {
      ok: false,
      error: {
        name: "ProtocolVersionError",
        message: `Unsupported GM Tools protocol ${command.protocolVersion}; this Mod requires protocol ${ROLL20_PROTOCOL_VERSION}.`,
      },
    });
    return;
  }
  executeCode(command.requestId, command.code);
}

on("ready", () => {
  on("chat:message", handleChatMessage);
  log(
    `GM Tools execution bridge ${ROLL20_MOD_VERSION} (protocol ${ROLL20_PROTOCOL_VERSION}) ready`,
  );
});
