# Native HarmonyOS FD Client

Date: `2026-09-19`

Status: native ArkUI foundation, the FD Runtime mobile read/recovery contract,
turn SSE, resumable attachment transfer, scoped preview, and text/image model
input are implemented in dedicated worktrees. PDF/Office server-side parsing
and a real Harmony SDK build remain pending.

## Decision

Build a native ArkUI/ArkTS client for HarmonyOS that talks to the FD Runtime over
authenticated HTTPS and a resumable event stream. The client owns presentation and
short-lived local cache. The FD Runtime remains the authority for identity, Skill
authorization, model routing, attachment processing, enterprise tools, audit, and
server-side history.

The HarmonyOS client must not be another hosted web page or an ArkWeb wrapper. It
should share wire semantics with T3 Code, but it does not need to run Node, a PTY,
Git, Codex, or the local T3 server on the device.

## Existing boundaries

T3 already defines the product semantics we should preserve:

- `OrchestrationThreadShell` is the task-list read model.
- `OrchestrationThreadDetailSnapshot` is the durable message and activity view.
- `OrchestrationThreadStreamItem` separates durable snapshots/events from volatile
  streaming overlays.
- `thread.turn.start` carries user text, attachment references, model selection,
  Skill version, and an idempotent command ID.
- `thread.turn.interrupt` is a separate command and must never be inferred from a
  new send.
- Thread and shell subscriptions use monotonically increasing sequences and an
  explicit synchronized marker.

The FD gateway now also exposes the versioned mobile/runtime contract:
`/api/mobile/v1/bootstrap`, `/skills`, `/threads`, thread history/detail, turn
SSE and explicit interrupt routes, plus resumable attachment upload and scoped
preview routes. These routes are a thin adapter over the existing `fd_desktop`
binding, encrypted workspace history, and Skill authorization. They do not
duplicate the long-lived history store or expose provider/tool internals.
Uploaded text files and images can be prepared for an Agent turn; PDF/Office
files can be stored and previewed but still return an explicit unsupported
error when sent as Agent context until server-side extraction is implemented.

## Ownership

| Concern                        | HarmonyOS client           | FD Runtime                                | T3 desktop server            |
| ------------------------------ | -------------------------- | ----------------------------------------- | ---------------------------- |
| Task list and visible messages | Render and encrypted cache | Durable server copy                       | Local event store/projection |
| Active context and resume      | Store opaque resume token  | Context, compaction, recovery             | Codex app-server cursor      |
| Skill catalog/version          | Select and display         | Authorize and provide policy              | Resolve local Skill files    |
| Tools and permissions          | Show status/approval       | Execute, authorize, audit                 | Execute local provider tools |
| Attachments                    | Pick, hash, upload chunks  | Scan, parse, OCR/vision, retain reference | Local attachment worker      |
| File preview                   | Render controlled content  | Issue scoped download/preview URL         | Sign local asset URL         |
| Credentials                    | Secure token storage only  | Issue, rotate, revoke                     | Loopback session/bootstrap   |

The device must never persist tool arguments/results, audit identifiers, provider
credentials, hidden reasoning, or enterprise policy text. Visible user/assistant
text and safe attachment metadata may be cached for offline rendering.

## Remote protocol

Use `/api/mobile/v1` as a versioned namespace. All requests carry a request ID and
all mutations carry an idempotency key. Every stream item carries a `sequence` and
the server returns a `resumeToken` in snapshots and terminal events.

### Session and capability discovery

- `GET /api/mobile/v1/bootstrap` returns API version, supported auth methods,
  server limits, model catalog, attachment capabilities, and stream transports.
- `POST /api/mobile/v1/session` exchanges the FD login/SSO assertion for a short
  lived access token and refresh token. Refresh tokens stay in HarmonyOS secure
  storage and are never sent to a model provider.
- `POST /api/mobile/v1/session/refresh` rotates the access token.
- `DELETE /api/mobile/v1/session` revokes the device session.
- `GET /api/mobile/v1/skills` returns Skill name, version ID, release digest,
  description, risk tier, and model capability flags. The client treats the
  server response as authoritative and does not ship Skill files.

The existing `/api/fd-skills/self` response can be adapted into this catalog while
the new endpoint is rolled out. The current `/api/agent/turns` SSE endpoint can be
used by a compatibility adapter, but the native client should move to the unified
stream contract below before release.

The compatibility adapter keeps the gateway's validated `client: fd_desktop`
marker and creates/reuses the managed runtime token only when it actually falls
back to the legacy Agent endpoint. A successful mobile login never needs Token
management permission.

### Threads and history

- `GET /api/mobile/v1/threads?cursor=...` returns paginated thread shells grouped
  by project/workspace.
- `POST /api/mobile/v1/threads` creates a thread and returns `clientThreadId`.
- `GET /api/mobile/v1/threads/{clientThreadId}` returns the detail snapshot,
  including visible messages, attachment references, activities, current status,
  selected Skill version, and `snapshotSequence`.
- `GET /api/mobile/v1/threads/{clientThreadId}/history?before=...` loads older
  pages. The cursor is opaque and exclusive, matching T3 pagination semantics.
- `DELETE`/archive/restore endpoints operate on the same thread ID and are
  idempotent.

The client must render the last known durable snapshot immediately, then reconcile
with the server by sequence. A missing or invalid resume token starts a fresh
runtime context while retaining visible product history; it must never attach one
Skill version's context to another.

### Turns and stream

`POST /api/mobile/v1/threads/{clientThreadId}/turns` accepts:

```json
{
  "requestId": "uuid",
  "idempotencyKey": "uuid",
  "text": "user input",
  "attachments": [{ "attachmentId": "..." }],
  "skillVersionId": 42,
  "model": "deepseek-flash"
}
```

The response is an accepted receipt with `turnId` and the stream URL. The current
mobile rollout enables authenticated SSE for the turn endpoint. The client keeps
a WebSocket replay adapter, but does not open it until bootstrap advertises a
deployed replay endpoint; this avoids connecting to an unreleased route. A client
sends `afterSequence` and `resumeToken` when replay is available. Events are
compatible with the T3 vocabulary:

- `thread.snapshot`, `thread.message-sent`
- `turn.started`, `skill.authorized`
- `tool.started`, `tool.completed`
- `attachment.processing`, `attachment.ready`, `attachment.failed`
- `assistant.reasoning` (ephemeral and optional; never written to durable history)
- `assistant.delta`
- `turn.completed`, `turn.failed`, `turn.interrupted`
- `thread.synchronized`

The server owns ordering and deduplication. The client applies an event only when
its sequence is newer than the last applied sequence, then persists the resulting
visible snapshot. Reconnect is a catch-up operation, not a second turn.

`POST /turns/{turnId}/interrupt` is explicit. A send while another turn is active
is placed in a device-side queue and receives its own idempotency key; it does not
interrupt the active turn. Queue entries can be edited, deleted, reordered, or
sent immediately. Immediate send requires an explicit interrupt confirmation when
the active turn is still running.

## Attachment and preview pipeline

1. ArkUI invokes the system document/photo picker and receives a sandbox URI.
2. The client reads metadata and streams one server-sized part at a time without
   loading the whole file into memory. OpenHarmony's CryptoArchitectureKit
   computes a SHA-256 for each part and for the complete file.
3. `POST /attachments` creates an upload session and returns a server-selected
   chunk size and limits. `PUT /attachments/{id}/parts/{index}` uploads chunks;
   each part is checksum-verified and retryable. `POST /attachments/{id}/complete`
   finalizes the object.
4. The current gateway reports upload completion as `ready` for the transfer
   layer. It does not yet run PDF/Office extraction or OCR; those files remain
   previewable but are rejected as model context with a precise unsupported
   response. The processing-state vocabulary is reserved for the parser/OCR
   worker that will be added later.
5. The turn contains only attachment IDs and a user-visible name. The runtime
   decides whether to use native model image input, DeepSeek visual preprocessing,
   OCR, or text extraction based on the selected model and policy.
6. `POST /attachments/{id}/preview-url` returns a short-lived, content-disposition
   controlled URL with a preview capability bound to the user, thread, and file.
   The client renders PDF pages, images, plain text, and supported Office output
   through native preview surfaces. Unsupported or unsafe types download only
   after an explicit user action.

Limits are server-advertised and model-aware. The client must display a precise
reason for rejection (size, type, quota, scan failure, OCR unavailable) instead of
silently dropping an attachment. Long PDFs are processed asynchronously and expose
page counts and progress; the turn can wait for readiness or let the user send
after a clear partial-processing warning.

## ArkUI application model

Use one navigation stack with state stores, not page-local copies of thread data:

- `TaskListPage`: paginated shells, status badges, search, archive/restore, and
  offline/stale indicators.
- `ThreadPage`: durable messages plus volatile progress overlay, activity timeline,
  context/reconnect banner, queue drawer, and attachment chips.
- `SkillSheet`: server catalog, version, risk tier, model compatibility, selected
  state, and explicit deselection.
- `AttachmentSheet`: picker, upload progress, processing state, retry/remove.
- `HistoryPage`: older-page cursor loading and local cache reconciliation.
- `PreviewPage`: scoped preview URL, native PDF/image/text/Office renderers, and
  safe fallback download.

The core state machine has these states:

```text
signedOut -> signingIn -> ready -> loadingShell -> ready
ready -> loadingThread -> threadReady
threadReady -> uploadingAttachment -> processingAttachment -> threadReady
threadReady -> turnQueued -> turnRunning -> turnReady | turnFailed | reconnecting
reconnecting -> catchingUp -> threadReady | authExpired | offline
```

All user actions are commands handled by a single runtime store. A workspace or
Skill selection change must update selection state without replacing composer text,
queued turns, or the current thread snapshot.

## Security and privacy

- Use TLS with certificate validation; certificate pinning is optional and must be
  operationally rotatable if enabled.
- Store access/refresh tokens in HarmonyOS `Preferences` backed by the system secure
  storage or an equivalent KeyStore-backed service. Never log them.
- Bind preview URLs and attachment operations to account, thread, and attachment
  IDs. Reject path-like names and arbitrary remote URLs.
- Treat extracted text, images, OCR output, and Skill content as untrusted model
  context. The runtime applies prompt-injection policy before model invocation.
- The client may display audit status and tool labels, but it cannot fabricate an
  audit result or invoke a tool directly.
- Logout clears tokens, pending upload credentials, volatile state, and local
  caches according to the retention policy; it must not leave another account's
  thread list visible.

## Shared contracts and code layout

Keep the existing TypeScript contracts as the source of product vocabulary and add
JSON Schema fixtures for the remote mobile protocol. Generate ArkTS DTOs and
decoders from those schemas rather than hand-copying dozens of shapes. A proposed
layout is:

```text
packages/fd-runtime-contracts/
  schema/mobile-v1/*.json
  generated/arkts/*.ets
  generated/typescript/*.ts
apps/harmonyos-fd/
  entry/src/main/ets/data/
  entry/src/main/ets/network/
  entry/src/main/ets/state/
  entry/src/main/ets/pages/
  entry/src/main/ets/components/
```

The Electron client continues to use the local T3 server and Codex app-server.
Both clients share IDs, Skill version semantics, attachment metadata, event names,
and recovery rules. They do not share a DOM UI or assume the same runtime is local.

## Delivery plan

### Phase 0: protocol and compatibility proof

- Freeze JSON Schema for bootstrap, catalog, thread shell/detail, turn receipts,
  stream events, attachment upload, and preview URLs.
- Build a fake runtime that replays snapshots, out-of-order events, reconnects,
  and failed uploads.
- Add a compatibility adapter for the current `/api/fd-skills/self` and
  `/api/agent/turns` endpoints so the contract can be exercised before backend
  rollout.

### Phase 1: remote runtime support

- Add mobile session/token endpoints and capability discovery.
- Add durable thread shell/detail/history APIs backed by the same visible message
  owner used by T3, without exposing provider reasoning or tool payloads. The
  first read/recovery slice is now available under `/api/mobile/v1`; it is
  user-scoped and limited to `fd_desktop` bindings.
- Add unified WebSocket/SSE stream with sequence replay and explicit interrupt.

### Phase 2: native ArkUI shell

- Create `apps/harmonyos-desktop` as a real ArkTS application.
- Implement the login shell, task list, thread detail, Skill sheet, editable
  queue, native picker, scoped preview surface, and stream reducer against the
  compatibility runtime first, then the staging runtime.
- Verify process death, offline relaunch, account logout, and sequence recovery.

### Phase 3: files and production hardening

- Implement server-side checksum negotiation, resumable chunk retry, processing progress,
  server OCR/vision routing, signed previews, and queue editing.
- Add device-size performance budgets, encrypted cache expiry, accessibility, and
  telemetry with no user text or secrets.
- Release alongside Windows/macOS only after the same end-to-end acceptance matrix
  passes for task recovery, Skill isolation, attachments, stream reconnect, and
  preview authorization.

## Acceptance tests

- Kill and relaunch during a streaming turn; the last durable message and stream
  resume are restored without duplicate assistant text.
- Switch Skill versions in one thread; each version resumes only its own context.
- Queue three messages while a turn runs; edit, delete, reorder, and immediately
  send one; the active turn remains intact unless explicitly interrupted.
- Upload a large text PDF, scanned PDF, image, and Office file; verify server
  processing state, model-specific routing, preview, retry, and size errors.
- Expire the access token during a stream; refresh once, reconnect from sequence,
  and continue. A revoked session returns to sign-in without leaking cached data.
- Attempt a preview URL from another thread/account and after expiry; both are
  rejected by the runtime.

## Open decisions before implementation

1. Whether HarmonyOS targets only desktop or also phone/tablet; this affects
   window layout, picker UX, and minimum API level.
2. Whether FD Runtime will expose the new mobile API directly or through a thin
   gateway service that fronts the existing Agent endpoints.
3. Which FD login/SSO assertion HarmonyOS may use and whether device enrollment
   requires administrator approval.
4. The server-advertised maximum attachment size, chunk size, retention period,
   and OCR/vision quotas for long documents.

## Validation snapshot

The current production gateway was checked from this worktree on `2026-09-19`:

- `POST /api/user/login`, `GET /api/user/self`, `GET /api/status`, and
  `GET /api/fd-skills/self` returned `200` for the supplied administrator account.
- The catalog returned four Skills and seven model capability entries, including
  `deepseek-flash`, `kimi-k3`, Qwen, and GLM under `enterprise-agent-v1`.
- A minimal `POST /api/agent/turns` with an existing managed model token and
  `client: fd_desktop` returned progress, `turn.started`, `assistant.delta`, and
  `turn.completed` events.
- `GET /api/mobile/v1/threads` currently returns `404`, so the native client keeps
  the compatibility adapter enabled and does not claim the new mobile protocol is
  deployed yet.
- The repository machine has no DevEco/Harmony SDK or `hvigorw` wrapper. The
  ArkUI build remains pending on a Harmony-capable build host; T3 server, desktop,
  contracts, and native static checks pass in this worktree.

## Worktree implementation status

The dedicated branch `codex/harmony-native-fd-client` currently contains:

- A native ArkUI entry point for task list, thread history, streaming progress,
  Skill selection/deselection, queue editing, attachment chips, and preview.
- A reducer in `FdStore` that applies monotonically increasing stream sequences,
  keeps volatile assistant deltas separate from durable snapshots, and starts
  queued turns only after an explicit terminal event.
- A compatibility client for the existing gateway plus the versioned
  `/api/mobile/v1` contract. The model selector uses the gateway's advertised
  capability keys when available, so adding a model does not require an app
  rebuild.
- A picker URI transfer adapter that opens the URI, reads bounded chunks, uploads
  them with progress, finalizes the server attachment, and replaces the local
  temporary ID. A 404/405 mobile API response is surfaced as an actionable error;
  the attachment is never silently sent through the legacy text-only endpoint.

The dedicated gateway branch contains the mobile endpoints, but they have not
been deployed to production from this worktree. The production gateway may
still return `404` for `/api/mobile/v1/threads` until that branch is released.
The existing legacy Skill/history/SSE compatibility path remains available for
text-only smoke tests.
