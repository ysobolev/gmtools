# Diagnostics

## Model runs

Before each model run, the worker saves a deduplicated configuration snapshot in
the `runSnapshots` IndexedDB store. It records the resolved system prompt, model
and provider options, active tool definitions, effective behavior settings,
extension build, and profile/campaign identities and names. Authentication keys
are not included. Prompts and campaign names may still contain private data.

The initiating user message's `metadata.gmToolsSubmissions` array records the
run ID, timestamp, submission kind, and snapshot hash. Resume, Retry, and approval
responses append their own markers without adding visible or model-facing prose.
Reconnecting to an existing stream does not create a new run. Snapshots are
collected when their last owning chat is deleted; detaching keeps diagnostics.
This is local diagnostic storage, not telemetry or an automatic feedback upload.

Feedback reports can include these snapshots along with saved chat history.
Excluding the conversation also excludes its snapshots, campaign details, and
visible error. Reports can be submitted through the feedback service or exported
as JSON for inspection and manual sharing.

## Sandbox runtime

Campaign handshakes record the last-known Roll20 `sandboxVersion` as a string,
without probing or listing API capabilities. This is separate from the GM Tools
bridge version. Older compatible bridges may omit the runtime observation.
The campaign record caches it for offline attachments, and attachment notices
and run-configuration snapshots include it. Failed handshakes do not overwrite
the last successful observation.

The runtime identifier comes from `Campaign().sandboxVersion`, a direct JavaScript
property documented by the [Roll20 production team](https://app.roll20.net/forum/post/12319797/mod-api-server-release-apr-18th-2025).
Values are preserved verbatim, including historical `default` or `experimental`
identifiers, rather than translated into guessed numeric versions. Missing
identifiers are recorded as unknown by omitting the optional field. No `v` prefix
is added or removed.

Prompt guidance distinguishes the sandbox generations: `getSheetItem` and
`setSheetItem` exist in both, while `getComputed` and `setComputed` require v1.5.
Legacy 2014 sheet work remains supported on v1.0; the Beacon 2024 guidance targets
v1.5.
