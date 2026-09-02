# Multiple-chat robustness checklist

Run these checks with console debugging enabled and chats with saved campaign
bindings.

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

- Switch between attached chats without sending a message. No campaign
  identity command should be sent to the Roll20 sandbox merely because a chat
  became active.
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

## Workspace UI

- Type a draft in one chat, switch to another, then switch back. The original
  draft should return without changing that chat's drawer order or activity.
- Scroll to the middle of a long chat, switch away, and return. The same visible
  message should be restored. A chat with no saved position should open at the
  bottom, and images loading afterward should not initiate a scroll.
- While scrolled to the bottom, grow the composer to several lines and confirm
  the conversation remains pinned. Repeat while scrolled upward and confirm the
  visible messages do not jump.
- Edit and save a chat title, toggle the drawer, and change profiles. Existing
  message images and Markdown should remain mounted without visible flicker.
- Delete several inactive chats in succession. The drawer should remain open.
- Delete the active chat while others remain. The next displayed chat should be
  selected and the drawer should remain open.
- Delete the only remaining chat. A new unattached chat should be created, the
  drawer should close, and a transient deletion notice should appear outside
  chat history.
- With zero, one, and multiple available campaign candidates, use Attach and
  confirm it respectively shows guidance, attaches immediately, or opens the
  chooser with the active Roll20 tab first.
- Close every Roll20 tab and attach using a campaign known from another chat.
  The durable campaign binding should be copied and later discover its tab when
  Roll20 becomes available.
