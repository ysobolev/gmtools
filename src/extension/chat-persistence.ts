import {
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

export async function reconstructCompletedConversation(
  inputMessages: readonly UIMessage[],
  chunks: readonly UIMessageChunk[],
): Promise<UIMessage[] | undefined> {
  let completedAssistantMessage: UIMessage | undefined;
  const replay = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  for await (const message of readUIMessageStream({ stream: replay })) {
    completedAssistantMessage = message;
  }
  return completedAssistantMessage
    ? [...inputMessages, completedAssistantMessage]
    : undefined;
}
