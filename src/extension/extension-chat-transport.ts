import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  CHAT_ABORT,
  CHAT_COMPLETE,
  CHAT_ERROR,
  CHAT_PORT_NAME,
  CHAT_START,
  isChatPortResponse,
} from "./openrouter-protocol";

export class ExtensionChatTransport implements ChatTransport<UIMessage> {
  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
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
            port.postMessage({ type: CHAT_ABORT, requestId });
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
        port.postMessage({ type: CHAT_START, requestId, messages });
      },
    });
  }

  async reconnectToStream(): Promise<null> {
    return null;
  }
}
