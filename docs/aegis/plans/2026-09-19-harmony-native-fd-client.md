# Native HarmonyOS FD Client

Date: `2026-09-19`

Status: native ArkUI foundation, the FD Runtime mobile read/recovery contract,
turn SSE, resumable attachment transfer, scoped preview, and model-aware
attachment input are implemented in dedicated worktrees. The production
gateway now parses text PDFs and Office files, falls back to OCR/vision for
image-only PDF pages, and exposes the resulting attachment context to the
runtime. A real Harmony SDK build remains pending.

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
Uploaded text files, images, PDFs, and Office files can be prepared for an
Agent turn. The gateway selects text extraction, OCR, or visual input according
to the attachment and model; unsupported combinations still return an explicit
capability error instead of silently dropping the file.

## Ownership

| Concern                        | HarmonyOS client           | FD Runtime                                | T3 desktop server            |
| ------------------------------ | -------------------------- | ----------------------------------------- | ---------------------------- |
| Task list and visible messages | Render and encrypted cache | Durable server copy                       | Local event store/projection |
| Active context and resume      | Keep opaque cursor in memory; reconcile after restart | Context, compaction, recovery | Codex app-server cursor |
| Skill catalog/version          | Select and display         | Authorize and provide policy              | Resolve local Skill files    |
| Tools and permissions          | Show status/approval       | Execute, authorize, audit                 | Execute local provider tools |
| Attachments                    | Pick, hash, upload chunks  | Scan, parse, OCR/vision, retain reference | Local attachment worker      |
| File preview                   | Render controlled content  | Issue scoped download/preview URL         | Sign local asset URL         |
| Credentials                    | Secure token storage only  | Issue, rotate, revoke                     | Loopback session/bootstrap   |

The device must never persist tool arguments/results, audit identifiers, provider
credentials, hidden reasoning, or enterprise policy text. Visible user/assistant
text and safe attachment metadata may be cached for offline rendering. The native
client now persists only a short-lived access-token projection and a bounded,
account-bound visible workspace projection in app-private Harmony Preferences; it
never stores the password, refresh cookie, provider key, local file URI, preview
URL, or resume cursor. A process restart reconciles the cached shell and messages
with the server before allowing a turn to run.
Startup validates the stored expiry and calls the gateway user endpoint before
restoring the workspace. Invalid or revoked sessions are cleared fail-closed.

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
deployed replay endpoint; this avoids connecting to an unreleased route. The
current production gateway advertises only turn SSE, so restored turns stay on
the validated SSE path. A client
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

The native client treats an authenticated workspace as unavailable until the remote
thread shell and its detail snapshot have loaded. A failed refresh keeps the local
placeholder visible for recovery, but it cannot be used as a send target. Queue entries
retain a stable visible-message ID, attachments, model and Skill version when a turn
fails, so retrying does not duplicate the user message. Legacy Agent fallback only
reuses an administrator-provisioned compatibility Token; it never creates an unlimited
quota Token. Attachment parts retry transient network, throttling and server errors
within the same upload session, with a bounded exponential backoff.

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
4. The gateway reports upload completion as `ready` for the transfer layer and
   prepares the file on the server. Text PDFs and Office files use server-side
   extraction; image-only PDF pages use the OCR/vision fallback. The runtime
   keeps processing failures explicit and reports the exact unsupported reason
   when the selected model cannot accept the prepared input.
5. The turn contains only attachment IDs and a user-visible name. The runtime
   decides whether to use native model image input, DeepSeek visual preprocessing,
   OCR, or text extraction based on the selected model and policy.
6. `POST /attachments/{id}/preview-url` returns a short-lived, content-disposition
   controlled URL with a preview capability bound to the user, thread, and file.
   The client renders PDF pages, images, plain text, and supported Office output
   through native preview surfaces. Unsupported or unsafe types download only
   after an explicit user action.

The deployed attachment endpoints use strict JSON decoding. Their request
bodies therefore remain exactly the deployed contract (`threadId`, `name`,
`mimeType`, `sizeBytes`, optional `sha256`; then `totalParts` and `sha256`; then
the preview `requestId`). Turn creation carries the required `requestId` and
`idempotencyKey`; attachment idempotency fields will be added only when the
gateway accepts them, so a native client update cannot break the existing
upload path.

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
- Store the short-lived access-token projection in HarmonyOS `Preferences` backed
  by the app-private storage boundary; never log it. The current gateway does not
  expose the planned mobile refresh-cookie contract, so expired sessions are
  cleared and require sign-in rather than inventing a client-side refresh flow.
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

- Extend the deployed checksum negotiation, resumable chunk retry, processing
  progress, OCR/vision routing, signed previews, and queue editing with device
  performance budgets and failure recovery.
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

The production gateway was checked again on `2026-09-20`. The active gateway
reports version `1d1516d`; it includes the mobile runtime adapter and the
five-minute attachment-stream flush fixes.

- `POST /api/user/login`, `GET /api/user/self`, `GET /api/status`, and
  `GET /api/fd-skills/self` returned `200` for the supplied administrator account.
- `GET /api/mobile/v1/bootstrap` remains account-protected and is checked with
  the authenticated mobile session rather than as an anonymous health probe.
- The catalog returned four Skills and seven model capability entries, including
  `deepseek-flash`, `kimi-k3`, Qwen, and GLM under `enterprise-agent-v1`.
- A minimal `POST /api/agent/turns` with an existing managed model token and
  `client: fd_desktop` returned progress, `turn.started`, `assistant.delta`, and
  `turn.completed` events.
- The mobile thread, attachment and turn endpoints were exercised through the
  real FD Runtime with the supplied administrator account. A cold 26-page PDF
  produced an SSE stream with attachment progress, turn events and a durable
  response whose page references covered pages 1 through 26.
- The repository machine has no DevEco/Harmony SDK, `hvigorw` wrapper, Harmony
  emulator or connected device. The ArkUI source therefore passes the native
  static contract check here, while HAP compilation and device UI acceptance
  remain a required step on a Harmony-capable build host. The live gateway
  smoke test also covered login, bootstrap, model discovery, text SSE, a
  26-page scanned PDF upload/complete/analysis, durable history, and signed
  preview authorization; the response enumerated pages 1 through 26 and the
  preview accepted the bound thread while rejecting a tampered one.

## Worktree implementation status

The isolated release worktree branch `codex/harmony-native-release` contains:

- A native ArkUI entry point for task list, thread history, streaming progress,
  Skill selection/deselection, queue editing, attachment chips, and preview.
- A reducer in `FdStore` that applies monotonically increasing stream sequences,
  reconciles legacy streams that omit message IDs, keeps volatile assistant
  deltas separate from durable snapshots, and starts queued turns only after an
  explicit terminal event.
- A compatibility client for the existing gateway plus the versioned
  `/api/mobile/v1` contract. The model selector uses the gateway's advertised
  capability keys when available, so adding a model does not require an app
  rebuild.
- A picker URI transfer adapter that opens the URI, reads bounded chunks, uploads
  them with progress, finalizes the server attachment, and replaces the local
  temporary ID. Attachments are removed from the composer after enqueueing but
  remain attached to the durable user message so parser events can still update
  their state.
- A bounded Harmony Preferences workspace cache that restores the last visible
  thread, messages, Skill/model selection, and queue while offline. It serializes
  writes, removes local-only attachment fields, marks interrupted uploads for
  reselection, and falls back to the remote T3 thread/detail/history projection
  after reconnect.
- Queue entries can be edited, deleted, reordered, or sent immediately. An
  immediate send requests interruption of the active turn and waits for the
  terminal event before starting the selected entry. A 404/405 mobile API
  response is surfaced as an actionable error; attachments are never silently
  sent through the legacy text-only endpoint.

The gateway is deployed independently from the T3 client worktree. This branch
does not alter the Windows/macOS Electron renderer or release manifests. The
legacy Skill/history/SSE compatibility path remains available for text-only
smoke tests while Harmony uses the versioned mobile contract.
