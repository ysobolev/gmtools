import {
  ROLL20_MOD_VERSION,
  ROLL20_PROTOCOL_VERSION,
  formatRoll20Acknowledgement,
  formatRoll20ExecuteResponse,
  parseRoll20ExecuteCommand,
  type Roll20ExecutionOutcome,
} from "../protocol";

interface GMToolsState {
  campaignId: string;
}

function getGMToolsState(): GMToolsState {
  const existing = state.GMTools;
  if (
    typeof existing === "object" &&
    existing !== null &&
    "campaignId" in existing &&
    typeof existing.campaignId === "string"
  ) {
    return existing as GMToolsState;
  }
  const next: GMToolsState = {
    ...(typeof existing === "object" && existing !== null ? existing : {}),
    campaignId: `campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
  };
  state.GMTools = next;
  return next;
}

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

function whisperRecipient(message: Roll20ChatMessage): string {
  if (playerIsGM(message.playerid)) return "gm";
  const name = (message.who ?? "").replace(/["\\]/g, "").trim();
  return name ? `"${name}"` : "gm";
}

function sendAcknowledgement(
  message: Roll20ChatMessage,
  requestId: string,
  accepted: boolean,
  error?: Roll20ExecutionOutcome & { readonly ok: false },
): void {
  const response = formatRoll20Acknowledgement(
    requestId,
    getGMToolsState().campaignId,
    playerIsGM(message.playerid),
    accepted,
    error?.error,
  );
  sendChat(
    "GM Tools",
    `/w ${whisperRecipient(message)} ${response}`,
    null,
    { noarchive: true },
  );
  log(
    `GM Tools acknowledgement submitted: ${requestId} (${accepted ? "accepted" : "rejected"})`,
  );
}

function sendOutcome(
  message: Roll20ChatMessage,
  requestId: string,
  outcome: Roll20ExecutionOutcome,
): void {
  let response: string;
  try {
    response = formatRoll20ExecuteResponse(
      requestId,
      getGMToolsState().campaignId,
      outcome,
    );
  } catch (error) {
    response = formatRoll20ExecuteResponse(
      requestId,
      getGMToolsState().campaignId,
      errorOutcome(error),
    );
  }

  // noarchive prevents persistence in the chat archive. The extension removes
  // this marked GM whisper from the live DOM before the next paint.
  sendChat(
    "GM Tools",
    `/w ${whisperRecipient(message)} ${response}`,
    null,
    { noarchive: true },
  );
  log(`GM Tools response submitted: ${requestId}`);
}

function completeExecution(
  message: Roll20ChatMessage,
  requestId: string,
  outcome: Roll20ExecutionOutcome,
): void {
  log(
    `GM Tools execution completed: ${requestId} (${outcome.ok ? "success" : "error"})`,
  );
  sendOutcome(message, requestId, outcome);
}

function executeCode(
  message: Roll20ChatMessage,
  requestId: string,
  code: string,
): void {
  try {
    const evaluate = eval;
    const result: unknown = evaluate(`(async function () {\n${code}\n})()`);
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).then(
        (value) =>
          completeExecution(message, requestId, {
            ok: true,
            result: value ?? null,
          }),
        (error: unknown) =>
          completeExecution(message, requestId, errorOutcome(error)),
      );
      return;
    }
    completeExecution(message, requestId, {
      ok: true,
      result: result ?? null,
    });
  } catch (error) {
    completeExecution(message, requestId, errorOutcome(error));
  }
}

function handleChatMessage(message: Roll20ChatMessage): void {
  if (message.type !== "api") return;

  const command = parseRoll20ExecuteCommand(message.content);
  if (!command) return;
  log(
    `GM Tools command received: ${command.requestId} (${command.kind}, protocol ${command.protocolVersion})`,
  );
  if (command.protocolVersion !== ROLL20_PROTOCOL_VERSION) {
    sendAcknowledgement(message, command.requestId, false, {
      ok: false,
      error: {
        name: "ProtocolVersionError",
        message: `Unsupported GM Tools protocol ${command.protocolVersion}; this Mod requires protocol ${ROLL20_PROTOCOL_VERSION}.`,
      },
    });
    return;
  }
  if (command.expiresAt < Date.now()) {
    sendAcknowledgement(message, command.requestId, false, {
      ok: false,
      error: {
        name: "CommandExpiredError",
        message: "This GM Tools command expired before the sandbox received it.",
      },
    });
    return;
  }
  const isGM = playerIsGM(message.playerid);
  if (!isGM) {
    sendAcknowledgement(message, command.requestId, false, {
      ok: false,
      error: {
        name: "GMAccessRequiredError",
        message: "GM Tools Roll20 commands require GM access in this campaign.",
      },
    });
    return;
  }
  const campaignId = getGMToolsState().campaignId;
  if (
    command.kind === "execute" &&
    command.expectedCampaignId !== campaignId
  ) {
    sendAcknowledgement(message, command.requestId, false, {
      ok: false,
      error: {
        name: "CampaignMismatchError",
        message: "This conversation is bound to a different Roll20 campaign.",
      },
    });
    return;
  }
  sendAcknowledgement(message, command.requestId, true);
  if (command.kind === "identify") return;
  executeCode(message, command.requestId, command.code);
}

on("ready", () => {
  getGMToolsState();
  on("chat:message", handleChatMessage);
  log(
    `GM Tools execution bridge ${ROLL20_MOD_VERSION} (protocol ${ROLL20_PROTOCOL_VERSION}) ready`,
  );
});
