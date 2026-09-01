# Multiple-chat robustness checklist

Run these checks with console debugging enabled. Unless a check says otherwise,
enable background execution and use chats with saved campaign bindings.

## Conversation lifecycle

- Start a response, switch chats while it streams, then return. The first chat
  should show activity in the drawer and resume with every buffered update.
- Close the side panel during a response, reopen it, and select the chat. The
  response should continue and restore without a missing tool result.
- Delete a running chat. Its model request and any pending Roll20 command should
  stop, its drawer activity should disappear, and other chats should continue.
- Start turns in two different chats. Both model streams should progress; a
  second turn in either same chat should be rejected until its first turn ends.

## Campaign routing and execution

- Bind two chats to the same campaign and run Roll20 tools from both. Both chats
  should use the same tab route, and their sandbox executions must be serial.
- Bind chats to different campaigns and run a deliberately slow Roll20 command
  in each. The second campaign should begin without waiting for the first.
- Close the routed campaign tab while multiple chats reference it. The worker
  should perform one recovery probe for that campaign, update every running chat,
  and never retry an in-flight command whose outcome is unknown.
- Replace the routed tab with another campaign. The next command should reject
  the stale route, discover another matching tab if one exists, and otherwise
  report a non-retryable campaign mismatch.

## Persistence and configuration

- Rename a chat, close and reopen the panel, and confirm the title and history
  remain intact.
- Delete a profile used by an inactive chat, then open that chat. It should move
  to General and display exactly one fallback notice.
- Restart Chrome, reopen the panel, and select saved chats. Chat history and
  campaign names should remain, while Roll20 tab routes are rediscovered.
