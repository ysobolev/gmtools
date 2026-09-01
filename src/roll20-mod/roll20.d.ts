interface Roll20ChatMessage {
  readonly type: string;
  readonly content: string;
  readonly playerid: string;
  readonly who?: string;
}

declare const state: Record<string, unknown>;

declare function on(event: "ready", callback: () => void): void;
declare function on(
  event: "chat:message",
  callback: (message: Roll20ChatMessage) => void,
): void;
declare function playerIsGM(playerId: string): boolean;
declare function randomInteger(maximum: number): number;
declare function sendChat(
  speakingAs: string,
  message: string,
  callback: null,
  options: { readonly noarchive?: boolean },
): void;
declare function log(message: string): void;
