# VS Code delegated-agent history: client plan

> Draft implementation plan for Fable. This PR intentionally changes no editor behavior yet.
> It targets the deployed `oyren/1.109` branch and depends on the runtime protocol being deployed first.

Runtime dependency: [oyren-ai-deployable-containers PR #30](https://github.com/oyren-ai/oyren-ai-deployable-containers/pull/30).

## Implementation checklist

- [ ] Import protocol fixtures from the finalized runtime v1 contract and add client tests before changing providers.
- [ ] Add capability negotiation plus session-aware list/create/history/message/stream/control methods.
- [ ] Add strict resource/session parsing and pure metadata/history-to-VS Code mappers.
- [ ] Replace the hardcoded empty item and content providers for all six delegated kinds.
- [ ] Implement untitled-to-durable commit exactly once after server session creation succeeds.
- [ ] Scope busy state, model selection, cancellation, and replay cursors by chat resource.
- [ ] Restore completed history and reconnect an active response without duplicated markdown.
- [ ] Preserve the default participant and old-runtime behavior behind capability detection.
- [ ] Add unit, protocol-fixture, pinned-1.109 integration, and six-provider manual coverage.
- [ ] Ship only after the server canary passes; document feature disable and rollback.

## Outcome

The native VS Code sessions view lists delegated Codex, Cursor, Gemini, OpenCode, Qwen, and Antigravity
conversations owned by the current Oyren server. Opening an item restores the visible user/assistant
turns and continues the matching provider session. Closing a tab or restarting the extension/editor
does not erase completed history.

The client remains a view/controller. It stores no transcript or native provider resume ID. History is
guaranteed for the lifetime of the running Oyren server/container; cross-server archival is not part of
this PR.

## Current root cause

The deployed extension already contributes and registers the proposed Chat Sessions APIs, but disables
their history surfaces explicitly:

- `oyren/extensions/oyren-agent-extension/sessionProviders.js:43-47` registers the item provider and
  returns `[]` from `provideChatSessionItems`.
- `sessionProviders.js:52-61` registers the content provider and returns `history: []`.
- `turnHandler.js:31-33` ignores `ChatContext`, so it never identifies the open session resource.
- `agentClient.js:7-18` keeps one busy/model state object per kind and sends `agent=<kind>`, but never a
  logical session ID.
- `agentClient.js:61-95` follows only `POST /agent/message?follow=1`; it never lists or restores sessions.
- `sessionOptions.js:9-10` documents that model state is per kind, not per session.

This means multiple tabs for one provider alias one client latch and, on the current runtime, one server
singleton. Populating UI history without the server PR would falsely imply isolated, resumable model
contexts. The HTTP boundary already separates client and server; this PR formalizes that boundary
instead of moving runtime code into OpenVSCode.

## Ownership boundary

| Client owns | Runtime server owns |
| --- | --- |
| Chat session resource URI | Logical session metadata and label |
| Provider/item/content registration | Provider process and native resume ID |
| Mapping to VS Code request/response values | Visible transcript persistence/projection |
| Draft text and in-memory last-known item cache | Model, busy, status, and timing authority |
| Per-open-editor replay cursor | Session-local replay stream and retention |
| Friendly localized errors | Authentication, validation, limits, and isolation |

Do not use `workspaceState`, `globalState`, or `globalStorageUri` as a second transcript database.
Extension storage may cache non-authoritative UI state only; the next successful server read replaces it.

## Pinned VS Code 1.109 contract

This branch uses version 3 of `vscode.proposed.chatSessionsProvider.d.ts`, not the latest upstream API:

- `ChatSessionItemProvider` is lines 51-70. Its extension-owned events are
  `onDidChangeChatSessionItems` and unstable `onDidCommitChatSessionItem`.
- `ChatSessionItem` is lines 152-242: `resource`, `label`, optional description/badge/status/tooltip,
  archive flag, timing, changes, and JSON metadata.
- `ChatSession.history` is lines 297-305 and must be chronological
  `(ChatRequestTurn | ChatResponseTurn2)[]`; an active response is excluded.
- `ChatSessionContentProvider` is lines 363-387.
- Request context exposes `chatSessionContext.chatSessionItem` and `isUntitled` at lines 427-434.
- Runtime constructors are `extHostTypes.ts:3481-3490` (`ChatRequestTurn`), `3503-3510`
  (`ChatResponseTurn2`), and `3108-3116` (`ChatResponseMarkdownPart`).

Although the stable declaration marks turn constructors private, the pinned 1.109 runtime exports
them and this CommonJS extension can construct them. A pinned-image integration test is mandatory so
an editor upgrade cannot silently break restore. Do not migrate to `ChatSessionItemController` here:
the 1.109 controller lacks the later new-item handler, while the existing provider's commit event has
the lifecycle this patch needs.

## Resource and protocol adapter

### Stable URI format

Use the contributed session type as the scheme and the public logical UUID as the only path component:

```text
codex-cli:/6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea
```

The server's native ACP/CLI resume identifier, auth token, prompt, model credential, workspace path,
and user identity must never enter a resource URI or item metadata.

Add pure helpers that:

- accept only one of the six contributed schemes;
- accept exactly one canonical lowercase UUID path segment for a durable item;
- recognize only VS Code's `${type}:/untitled-<uuid>` shape as untitled;
- reject authority, query, fragment, extra segments, percent-encoded separators, traversal, or a kind
  mismatch before any HTTP request;
- derive the requested durable UUID from the untitled UUID, so retries are idempotent.

### `agentClient.js`

Keep one transport factory per kind, but move mutable busy/model/cursor state to a map keyed by durable
session UUID. Build URLs with `URL`/`URLSearchParams`, not string concatenation. Add:

- `getCapabilities()` with one single-flight cache and an explicit legacy result on `404`;
- `listSessions(cancellationToken)`;
- `createSession({ id, agent, firstMessage, model }, cancellationToken)`;
- `getSession(id, cancellationToken)` and `getHistory(id, cancellationToken)`;
- session-aware `listModels`, `setModel`, `ensureModel`, `interrupt`, `streamTurn`, and indexed
  `streamResponse` methods;
- typed/protocol error normalization that retains status/code but never logs a body containing content.

Every logical message/stream/control URL carries both `agent=<kind>` and `session=<uuid>`. The default
`oyren.agent` participant continues calling the legacy parameter-free methods. A protocol-capable
runtime must never receive a delegated call without a session; a legacy runtime retains today's
ephemeral per-kind behavior and advertises no history.

Use `clientMessageId` UUIDs for retry safety. A reconnect resumes by the server's session-local indexed
cursor and deduplicates by `(boot, sessionId, n)`. The token stays in the existing local query gate but
must be redacted from errors and test snapshots.

The HTTP client continues to close over the authentication token from `process.env.SESSION_TOKEN`.
Method `cancellationToken` parameters refer only to VS Code cancellation and must never replace or
expose that credential.

## Provider lifecycle

Create one item-change emitter and one commit emitter per kind and register/dispose both with the
extension context. Keep the current defensive activation behavior when proposed APIs are absent.

### Item provider

`provideChatSessionItems(token)`:

1. Feature-detect protocol v1 without spawning an agent.
2. Call `GET /agent/sessions?agent=<kind>`.
3. Validate the response schema and map each metadata record to a `ChatSessionItem`.
4. Return newest-first server order; never merge kinds.
5. On a transient failure, return the last validated in-memory list for this extension process and log
   one content-free diagnostic. On a fresh process with no cache, return `[]` rather than throw during
   activation.

Map statuses and timing as follows:

| Server | VS Code status | Timing |
| --- | --- | --- |
| `empty` | `Completed` | `created` only |
| `in_progress` | `InProgress` | created + last request start |
| `completed` | `Completed` | created + request start/end |
| `failed` | `Failed` | created + request start/end when present |

Use millisecond numbers for `ChatSessionItem.timing`, not `Date` instances. Put only protocol version,
public session ID, agent kind, and model ID in JSON metadata. Malformed records are skipped individually;
one bad session must not hide every item.

### Content provider

`provideChatSessionContent(resource, token)` is asynchronous:

- Untitled resource: return empty completed history, resource-bound request handler, current options,
  and no server item yet.
- Durable resource: fetch session metadata/history, convert only completed interactions, initialize
  that resource's model option, and bind the handler/cancellation/stream to its UUID.
- Running durable resource: return completed `history` plus `activeResponseCallback`, seeded with the
  server's accumulated visible markdown and then tailed strictly after its cursor.
- Unknown/deleted resource: fail that editor with a localized actionable message, not extension
  activation.
- Removed model: keep history readable; select a valid current/fallback model only for the next turn.

History is always chronological request then response. It contains no active response, transient
progress, hidden thinking, tool payload, or duplicate consolidated assistant text.

### Untitled-to-durable state machine

The extension owns `onDidCommitChatSessionItem`; VS Code subscribes to it and migrates the editor/model
from the original untitled resource to the modified durable resource.

On the first nonempty send:

1. Read `context.chatSessionContext` and validate that the bound resource is untitled.
2. Derive its UUID and call `POST /agent/sessions` with the first prompt only for server label creation.
3. Do not start the provider or commit locally until the server returns a successful, matching item.
4. Store the in-memory untitled-to-durable binding and fire
   `{ original: untitledItem, modified: mappedDurableItem }` exactly once.
5. Fire item-change so the list receives the durable item.
6. Send the first turn with the durable ID and stream normally.

Creation is idempotent. Concurrent/retried handlers share one promise per untitled resource. A failed
create remains untitled and retryable. If creation succeeds but message dispatch fails, the durable
empty session remains visible and can be retried; do not attempt a compensating delete that protocol v1
does not support.

## History mapping

Add a pure `sessionMapper.js` (or equivalently named module) so provider registration contains no
schema/rendering logic.

For every validated completed interaction, construct:

```js
new vscode.ChatRequestTurn(
  interaction.request.text,
  undefined,
  [],
  kind,
  [],
  undefined,
  interaction.id,
)

new vscode.ChatResponseTurn2(
  [new vscode.ChatResponseMarkdownPart(interaction.response.markdown)],
  mappedResult,
  kind,
  undefined,
)
```

Keep restored markdown untrusted. Map `outcome: "error"` to a result with readable error details while
ensuring the server's already-projected error markdown appears once. Empty successful markdown still
gets an empty response part so request/response pairing remains stable. Unknown schema versions fail
that session read with a clear compatibility error; unknown optional fields are ignored.

Live and restored output must share conformance fixtures:

- text deltas append in order;
- consolidated assistant text does not duplicate deltas;
- transient tool-use progress is live-only;
- thinking, tool results, echoes, pings, and unknown lines stay hidden;
- result errors append exactly once;
- NDJSON split across TCP chunks is reassembled before mapping.

Do not reconstruct old history from the current 16 MiB rolling buffer. It can begin mid-turn, lacks
logical metadata, and was never a durable transcript. History starts with sessions created after the
server protocol deploy.

## Per-session interaction state

Replace `client.state.busy` with a map keyed by logical UUID. The client blocks a second request only in
the same session; separate sessions of the same provider may proceed concurrently subject to the
server's resource cap. The server remains authoritative and can still return `409 session_busy`.

Cancellation calls `POST /agent/interrupt` with the same kind/session pair and closes only that read
stream. A canceled local socket must not clear another resource's latch or cursor. Always dispose
`onCancellationRequested` subscriptions in `finally`.

Refactor `sessionOptions.js` into:

- a per-kind available-model cache, still loaded lazily so editor boot does not spawn six providers;
- a per-session selected/current model map seeded from server metadata;
- resource-aware option change events and `ensureModel(sessionId, id)` calls.

Changing a model in session A cannot update session B. If a historical model is no longer available,
show it in item description/metadata but choose a valid model only when sending the next turn.

## Compatibility and failure behavior

### New client, old runtime

- Capability `404` selects the legacy adapter for the extension process.
- Delegated messages retain today's `agent=<kind>` behavior and empty history.
- Do not fire commit events or produce fake durable items.
- Default participant behavior is unchanged.

### Old client, new runtime

- Calls without `session` retain the old primary/per-kind response shapes defined by the server PR.
- The server may collect no logical history for those calls; that is preferable to guessing identity.

### Protocol-capable runtime errors

- `401`: render unavailable session authentication; never echo token.
- `404`: mark an opened stale resource unavailable and refresh the item list.
- `409 session_busy`: render the existing one-turn-at-a-time guidance for that resource only.
- `422`: name the unavailable provider and keep the editor/history readable.
- `429`: explain the server's active-agent limit and allow retry after the server hint.
- network failure: preserve last-known list/history already rendered; do not silently switch to the
  launch engine.

Logging may include protocol version, kind, a short public UUID prefix, operation, and status. It must
not include query strings, tokens, prompts, responses, provider resume IDs, workspace paths, or raw
server error bodies.

## Patch map

Expected new modules (names can change only after updating this document and PR body):

- `oyren/extensions/oyren-agent-extension/sessionResource.js`
- `oyren/extensions/oyren-agent-extension/sessionMapper.js`
- `oyren/extensions/oyren-agent-extension/sessionState.js`
- shared JSON protocol fixtures and matching `*.test.js` files

Expected refactors:

- `agentClient.js`: protocol negotiation, safe URL builder, session APIs, per-resource state/replay.
- `sessionProviders.js`: real item/content providers, emitters, commit lifecycle, cache.
- `turnHandler.js`: resource-aware creation/send/cancel and item lifecycle callbacks.
- `renderStream.js`: reusable live/history projection contract without changing visible semantics.
- `sessionOptions.js`: kind-level available models plus resource-level selection.
- `extension.js`: construct/register shared services and dispose them through `ExtensionContext`.
- `package.json`: add a focused `node --test` script without changing the proposal list or six kinds.
- `oyren/scripts/pack-editor-extras.sh` or CI: run extension tests before the existing `node --check` gate.

Do not patch VS Code workbench core for this feature. The pinned proposal already exposes the item,
content, context, commit, history, and active-response surfaces required by the adapter.

## Verification matrix

### Unit and contract tests

Use Node's built-in test runner and injected/fake `vscode` and HTTP modules; add no test dependency.

- All six kinds register, list, and load independently; Claude remains absent by design.
- Stable and untitled URIs round-trip; mismatched schemes, malformed UUIDs, traversal, query, and
  fragment inputs are rejected before HTTP.
- Every logical endpoint carries encoded token, agent, and session exactly once; logs never do.
- Capability `404` selects legacy behavior without breaking send/model/interrupt.
- Metadata maps status, millisecond timing, label, model description, and safe JSON metadata correctly.
- One malformed list record is skipped without losing valid sessions; unknown protocol fails clearly.
- Completed request/response order is exact; active/incomplete responses are excluded from `history`.
- Delta/final/tool/thinking/error fixture behavior is identical for live and restored paths.
- Untitled create/commit fires once after server acknowledgement, never before or after a failed create.
- Retrying the first send reuses the UUID/client message ID and does not create a duplicate item/turn.
- Same-session overlap is blocked; different sessions of the same kind run independently.
- Cancellation, model switching, busy state, and replay cursor affect only their target resource.
- Missing historical models do not hide history or silently change the persisted model.
- Active replay seeds partial markdown, tails after the cursor, and renders every delta exactly once.
- A transient list failure returns last-known in-memory items; fresh failure does not crash activation.
- Default participant calls remain parameter-free and current launch commands remain unchanged.

Suggested focused commands:

```bash
node --test oyren/extensions/oyren-agent-extension/*.test.js
node --check oyren/extensions/oyren-agent-extension/*.js
oyren/scripts/pack-editor-extras.sh # packaging validation only in a non-publishing/dry-run test path
```

Do not invoke the current packaging script's release-upload section in CI or local tests. Extract its
validation/packing portion into a non-publishing helper if needed.

### Pinned editor integration

Against the built `oyren/1.109` server, assert that constructed `ChatRequestTurn`,
`ChatResponseTurn2`, and `ChatResponseMarkdownPart` values survive extension-host serialization and
render in a delegated session. Verify the commit event migrates an untitled editor to the durable URI
without a duplicate tab/item. This guards the proposal-runtime constructor mismatch that unit mocks
cannot prove.

### Manual six-provider matrix

For each contributed kind (`codex-cli`, `cursor-cli`, `gemini-cli`, `opencode`, `qwen-code`, and
`antigravity-cli`):

1. Create a chat, complete two turns, and verify one native history item with server label/timing/model.
2. Close/reopen the item and compare visible user/assistant markdown and order.
3. Reload the browser and extension host; reopen and continue the same provider context.
4. Open a second session of the same kind and alternate turns; verify no cross-talk or shared model.
5. Cancel one running turn and verify the other session is untouched.
6. Close/reopen during a running turn and verify partial output resumes exactly once.

Also verify an uncredentialed kind renders `422` guidance, a removed model leaves history readable, the
primary browser/Oyren chat is unchanged, and an old runtime keeps today's ephemeral experience.

## Rollout and rollback

1. Keep this PR draft until the runtime server PR is deployed to a canary and reports protocol v1.
2. Test old client/new server first, then new client/new server, then new client/old server fallback.
3. Ship through the fast `oyren/` editor-extras layer; no 50-70 minute core server rebuild is required.
4. Gate activation on capability discovery and retain a remotely configurable disable switch if the
   existing editor-extras settings system has an appropriate product flag.
5. Observe content-free counts/latencies for capability, list, open, create, resume, conflicts, limits,
   and protocol failures. Do not add prompt/response analytics.

Rollback the client by disabling/removing session-history use; the additive server protocol and
persisted transcripts remain available for a fixed client. Do not delete server data. If only active
replay fails, keep completed history enabled and disable the active callback separately rather than
falling back to another engine.

## Acceptance criteria

- Native history is populated for every supported delegated model/provider.
- Reopened history exactly matches the visible completed transcript and continues the correct native
  provider session while the server exists.
- Two resources never share busy, model, interrupt, output, or cursor state.
- First send produces one durable URI and one item; retries produce no duplicate model invocation.
- The extension contains no durable transcript/provider resume ID and cannot read history without the
  existing session token.
- Old-runtime fallback and the default participant remain functional.
- The exact pinned 1.109 proposal path is covered by integration, not inferred from latest VS Code docs.
- Server-first rollout and rollback are demonstrated before this PR leaves draft.

## Explicit non-goals

- Changing compact/menu-bar UI settings.
- Adding delegated Claude Code before a server side-engine recipe exists.
- Migrating pre-feature buffer/native CLI history.
- Moving history between destroyed Oyren servers or persisting it in the orchestrator.
- Client-owned transcript storage.
- Rename, archive, delete, share, or export synchronization.
- Migrating to a newer Chat Sessions controller API or upgrading the OpenVSCode base.
- Patching core workbench behavior unrelated to the pinned proposal contract.

## Status (release-prep re-audit, 2026-08-11)

Re-checked this plan for internal consistency and drift as part of a cross-repo pass to get every
repo down to the fewest open PRs that make sense ahead of release. No content changes were needed:

- Protocol v1 surface (`GET /agent/capabilities`, `GET /agent/sessions?agent=<kind>`,
  `POST /agent/sessions`, `GET /agent/sessions/:id`, `GET /agent/sessions/:id/history`, and the
  paired `agent`/`session` parameters on existing endpoints) still matches the runtime side's
  current design.
- The pinned VS Code 1.109 contract section (proposal version 3, `ChatSession.history` semantics,
  constructible `ChatRequestTurn`/`ChatResponseTurn2`/`ChatResponseMarkdownPart`, and the note against
  migrating to the newer controller API) is unchanged and still accurate for the deployed branch.
- The client/server ownership boundary and persistence scope (survives process/editor restarts for
  the life of the server/container; no cross-server archival in this PR) still match the runtime PR's
  own persistence proposal.
- Markdown is well-formed (balanced code fences, consistent heading hierarchy, no broken structure).

Still correctly **draft** per this plan's own stated rollout criterion above ("Keep this PR draft
until the runtime server PR is deployed to a canary and reports protocol v1" / "Server-first rollout
and rollback are demonstrated before this PR leaves draft"): the runtime half,
[oyren-ai-deployable-containers#30](https://github.com/oyren-ai/oyren-ai-deployable-containers/pull/30),
is confirmed still open/draft, not deployed to any canary. This is a structural cross-repo dependency,
not a gap more in-container verification can close — nothing here needs a live editor session to
resolve, it needs the runtime PR to land and canary first.
