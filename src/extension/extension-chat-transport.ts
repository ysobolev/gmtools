import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  CHAT_ABORT,
  CHAT_COMPLETE,
  CHAT_ERROR,
  CHAT_PORT_NAME,
  CHAT_RESUME,
  CHAT_RESUME_QUERY,
  CHAT_START,
  isChatControlResponse,
  isChatPortResponse,
} from "./openrouter-protocol";

export class ExtensionChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly profileId: string) {}

  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    return this.openStream(
      chatId,
      abortSignal,
      (port, requestId) =>
        port.postMessage({
          type: CHAT_START,
          requestId,
          chatId,
          messages,
          profileId: this.profileId,
        }),
    );
  }

  private openStream(
    chatId: string,
    abortSignal: AbortSignal | undefined,
    startRequest: (port: chrome.runtime.Port, requestId: string) => void,
  ): ReadableStream<UIMessageChunk> {
    const requestId = crypto.randomUUID();
    const port = chrome.runtime.connect({ name: CHAT_PORT_NAME });

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let finished = false;

        const finish = (action: () => void): void => {
          if (finished) return;
          finished = true;
          abortSignal?.removeEventListener("abort", onAbort);
          action();
          port.disconnect();
        };

        const onAbort = (): void => {
          try {
            port.postMessage({ type: CHAT_ABORT, requestId, chatId });
          } catch {
            // The worker may already have closed the port.
          } finally {
            finish(() => controller.error(abortSignal?.reason ?? new DOMException(
              "The request was stopped.",
              "AbortError",
            )));
          }
        };

        port.onMessage.addListener((value: unknown) => {
          if (!isChatPortResponse(value) || value.requestId !== requestId) return;

          if (value.type === CHAT_COMPLETE) {
            finish(() => controller.close());
          } else if (value.type === CHAT_ERROR) {
            finish(() => controller.error(new Error(value.error)));
          } else {
            controller.enqueue(value.chunk);
          }
        });

        port.onDisconnect.addListener(() => {
          if (finished) return;
          const detail = chrome.runtime.lastError?.message;
          finish(() =>
            controller.error(
              new Error(detail ?? "The model connection closed unexpectedly."),
            ),
          );
        });

        if (abortSignal?.aborted) {
          onAbort();
          return;
        }
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        startRequest(port, requestId);
      },
    });
  }

  async reconnectToStream({
    chatId,
  }: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0]): Promise<
    ReadableStream<UIMessageChunk> | null
  > {
    const response: unknown = await chrome.runtime.sendMessage({
      type: CHAT_RESUME_QUERY,
      chatId,
    });
    if (!isChatControlResponse(response) || response.available !== true) {
      return null;
    }
    return this.openStream(chatId, undefined, (port, requestId) => {
      port.postMessage({ type: CHAT_RESUME, requestId, chatId });
    });
  }
}
