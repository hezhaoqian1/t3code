# FD AI Local Desktop Design

Date: `2026-08-09`

Status: `authorized amendment; Codex compatibility proof pending`

Owners: `FD AI Desktop`, `FD Gateway / New API`, `FD Tool Gateway`

## 1. Decision Summary

Fork T3 Code into a single-machine FD AI Desktop for non-technical employees. Keep T3's fast React
workbench, event-sourced threads, project filesystem, terminal, Git, Diff, checkpoints, and approval
UI. Replace Clerk and third-party provider setup with FD identity and one company-managed DeepSeek
provider. Remove mobile, T3 Connect, SSH, Tailscale, remote pairing, public sharing, remote server
management, and network-reachable environment modes.

The FD build has two conversation-scoped execution paths behind the existing T3 event projection:

1. Ordinary, project, and standard local Skill conversations run through T3's existing Codex App
   Server runtime, configured for the exact FD New API `deepseek-v4-flash` model and approved local
   tools.
2. Explicit FD Skill turns call the existing server-side Enterprise Agent, which owns FD Skill
   content, View permissions, database tools, query auditing, and encrypted enterprise history.

Each conversation has exactly one execution owner selected when it is created. Changing from the
ordinary/local owner to the Enterprise Agent, or back, creates a new conversation; no live
conversation transparently switches owners. Both paths emit the canonical T3 provider events, so
the client retains one message timeline, one tool lifecycle, one terminal state, and one completion
rule.

## 2. Why This Approach

### 2.1 Considered Approaches

#### A. Reuse T3's Codex App Server runtime

Authorized for the ordinary/project/local-Skill path. T3 already owns a production-grade Codex App
Server driver, session runtime, approval flow, event normalization, cancellation, and resume logic.
FD reuses only that runtime and keeps provider setup hidden; it does not restore arbitrary provider
accounts, model selection, installers, or the other T3 provider runtimes.

#### B. Use T3 with one embedded FD Agent kernel

Implemented as the transitional Task 8 path, but superseded as the target architecture. T3 remains
the product shell and canonical local task owner, while the temporary FD adapter calls DeepSeek
through New API and exposes only explicitly approved tools.

This duplicates mature Codex App Server responsibilities: tool-loop semantics, approvals,
cancellation, compaction, resume, terminal settlement, and native event normalization. Retain it
only until the compatibility spike proves the Codex path and all ordinary/local callers migrate.

#### C. Run every task in the FD cloud Agent

Rejected because a remote service cannot safely and ergonomically own arbitrary local files, Git,
terminal processes, approvals, and checkpoints. It would also turn local tool execution into a
reverse-RPC security system.

### 2.2 Runtime Choice Amendment

Restore the existing T3 Codex App Server implementation as the ordinary/project/local-Skill runtime.
Keep it behind the hidden FD provider instance and current T3 `ProviderAdapterShape` /
`ProviderRuntimeEvent` contracts. FD identity supplies short-lived credentials and policy; it does
not become the Agent loop owner. No provider registry or third-party provider setup is exposed to
employees.

This choice provides streaming text and reasoning summaries, typed tool calls/results, approval
hooks, step limits, timeouts, cancellation, and custom request headers while leaving the following
responsibilities with FD/T3:

- T3 owns durable threads, event projection, checkpoints, Diff, terminal, and Git.
- Codex App Server owns context construction, tool-loop execution, approvals, retries, compaction,
  cancellation, resume, and native session lifecycle for ordinary local conversations.
- T3's Codex adapter/session runtime maps Codex events into canonical T3 runtime events.
- New API owns credentials, quota, model authorization, routing, and upstream compatibility.

`@cline/sdk` and `@cline/core` were evaluated and rejected. The current SDK alias brings its own
accounts, provider catalog, SQLite session store, checkpoints, MCP/plugin system, Hub/remote runtime,
and telemetry, duplicating T3's canonical owners. The lower-level `@cline/agents` package still pulls
the multi-provider `@cline/llms` graph. Using either would make the internal product substantially
more complex than its employee UI suggests.

`FdAgentKernel`, `FdResponsesClient`, `ai`, and `@ai-sdk/openai` are transitional implementation
details. They must not appear in employee UI or persisted public contracts and are retired only after
a focused Codex compatibility spike proves exact `deepseek-v4-flash` execution, reasoning/text/tool
event projection, approvals, cancellation, token accounting, terminal settlement, local Skill
loading, and restart/resume behavior through the deployed FD New API. A failed spike retains the
transitional kernel and pauses migration; it does not silently introduce another provider fallback.

## 3. Product Experience

### 3.1 First Launch

1. Electron starts the local FD server on an OS-assigned loopback port.
2. Electron creates a short-lived renderer bootstrap credential in memory.
3. The renderer connects to the local server and displays FD login.
4. The employee signs in through the existing FD/New API account flow; credentials cross the
   context-isolated preload IPC once and Electron main performs the HTTPS login request.
5. Refresh credentials are stored through Electron `safeStorage`; the renderer never persists them.
6. After policy bootstrap succeeds, the employee enters a blank general conversation.

No Provider, model, Base URL, API key, runtime, project, or MCP setup is shown.

### 3.2 Default Task Mode

- The home page opens directly to a conversation.
- A project directory is optional.
- When no workspace is selected, the draft has no shared execution directory. On the first send,
  the server creates one persistent task directory below
  `~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss` and binds the conversation to it permanently.
- Each no-workspace conversation gets its own task directory. Finishing or settling the task keeps
  the directory and files; the next new task creates a different directory.
- Task directories are represented by typed internal projects with `projectPurpose = "task"` so
  they reuse the existing project/thread/runtime contract without appearing in the Workspaces list.
- Existing user-opened projects decode as `projectPurpose = "workspace"`. The legacy hidden office
  project remains readable for compatibility and draft staging but does not receive new turns.
- The primary controls are New conversation, history, attach file, Business capabilities, and Send.
- Provider and raw model choices are hidden. The active model may appear as read-only metadata in
  execution details.
- Technical activity is summarized in plain Chinese: understanding request, checking permission,
  querying data, validating results, completed.
- Raw hidden chain-of-thought is never rendered.

### 3.3 Optional Project Mode

Opening a local directory reveals file tree, terminal, Git, Diff, checkpoints, and advanced approval
controls. The selected workspace is locked after the first send; changing it creates a new task.
Returning to no-workspace mode starts a new draft and does not reuse another task's directory.

### 3.4 Skill Selection

The composer exposes one `Business capabilities` button. It opens two sections:

- `FD business capabilities`: server-managed, permission-filtered, company badge.
- `Local capabilities`: standard Agent Skills discovered from approved local roots.

An FD Skill selection is conversation-scoped: it remains selected for follow-up turns in the same
conversation, has a visible clear action, and is unconditionally reset when a new conversation is
created. The application may suggest an authorized FD Skill for an obvious request, but requires one
employee confirmation and never carries the choice into another conversation.

## 4. Target Architecture

```text
FD AI Desktop
  Electron main
    - local server launcher (127.0.0.1 only)
    - FD identity broker and credential safe storage
    - private credential channel to the local server
    - FD updater
  React renderer
    - employee chat
    - optional project mode
    - FD/native Skill picker
  T3 local server
    - event-sourced orchestration
    - filesystem / terminal / Git / checkpoints
    - in-memory FD runtime session and policy client
    - hidden FD runtime route
      - ordinary/project/local Skill -> Codex App Server -> New API -> DeepSeek
      - FD Skill conversation -> FdEnterpriseAgentClient -> /api/agent/turns
      - canonical ProviderRuntimeEvent stream
  FD Gateway
    - account, token, quota, model policy
    - FD Skill catalog and access groups
    - Enterprise Agent and encrypted history
    - FD Tool Gateway and database audit
```

## 5. Canonical Owners

| Concern                                       | Canonical owner                                                      |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Employee identity, status, group, quota       | FD New API                                                           |
| Administrative mutation                       | FD Workspace Web                                                     |
| FD Skill versions and audience                | FD New API                                                           |
| View, column, row, and SQL permission         | FD Tool Gateway                                                      |
| Enterprise query history                      | FD Enterprise Agent storage                                          |
| Local task events and project checkpoints     | T3 local server                                                      |
| Local Skill discovery                         | FD Desktop local Skill catalog                                       |
| Ordinary/project/local Skill Agent runtime    | Codex App Server                                                     |
| Enterprise Skill Agent runtime                | FD Enterprise Agent                                                  |
| Conversation/project/event projection         | T3 local server                                                      |
| Runtime event normalization                   | T3 Codex adapter for ordinary turns; FD adapter for enterprise turns |
| Renderer-to-local-server authentication       | FD Desktop environment auth                                          |
| FD login, refresh, and device-token lifecycle | Electron main identity broker                                        |
| Credential persistence                        | Electron main / `safeStorage`                                        |

## 6. Identity Design

### 6.1 Separate Trust Layers

The Electron-main `FdIdentityBroker` authenticates the employee to FD services.
`LocalEnvironmentSession` authenticates the Electron renderer to its own loopback server. They use
different credentials and cannot substitute for each other. The local server receives a bounded
runtime projection from the identity broker; it is not a second identity authority.

### 6.2 Credential Flow

- Electron main owns the New API access/refresh session and the per-device Runtime Token.
- Reuse and port the existing FD Desktop `AccountService`, `NewApiClient`, preload IPC contract, and
  `safeStorage` adapter rather than implementing a second login stack.
- Usernames and passwords are sent only from the context-isolated renderer through preload IPC to
  Electron main, then over HTTPS to New API. They are never forwarded to the local T3 server.
- On login, the broker gets or creates one device-named Runtime Token restricted server-side to the
  exact Desktop model allowlist. It does not ask the employee to create, reveal, or paste an API key.
- The local server receives the current short-lived access token, Runtime Token, token ID, user ID,
  and expiry through an inherited private pipe or authenticated local process channel. The ordinary
  runtime credential is injected only into the Codex child-process environment; it never enters
  process arguments, parent/global environment, Codex auth/config files, URLs, persisted session
  payloads, logs, or the renderer.
- The runtime projection exists in local-server memory only. Refresh updates it atomically; logout,
  employee disablement, token revocation, or Electron shutdown aborts turns and clears it.
- Logout and device removal revoke or delete the managed Runtime Token through New API before local
  credential cleanup. A failed remote revocation is recorded for retry and never presented as a fully
  completed logout cleanup.
- The renderer receives only profile, capability, expiry, and recoverable status projections.
- Tokens never enter URLs, SQLite events, logs, command history, model context, or crash reports.
- Refresh is single-flight. A failed refresh pauses new model turns and prompts login; it does not
  silently downgrade to anonymous or local-unmanaged mode.
- User disablement or group changes invalidate cached policy and active FD Skill selections.
- Sign-out aborts active enterprise turns, clears in-memory credentials and policy, removes safe
  storage credentials, and locks protected history.

### 6.3 Web Administration

No administrative mutation UI is added to Desktop. FD Workspace Web remains authoritative for:

- employees and roles;
- access groups and quota;
- DeepSeek model allowlist and defaults;
- FD Skill versions, audiences, resources, and 11 View grants;
- audit review;
- Desktop minimum version, rollout ring, and release metadata. If this release-policy page is not yet
  present, it is implemented in FD Workspace Web rather than Desktop.

Desktop consumes a versioned read-only bootstrap response and refreshes it on login, expiry, explicit
reload, and authorization failure.

## 7. Provider and Model Design

### 7.1 One Product Provider

Add `ProviderDriverKind("fd-deepseek")` and register only `FdDeepSeekDriver` in the FD build.
Provider settings, installation, account switching, maintenance prompts, and third-party model
pickers are removed from employee UI.

Desktop initially enables exact `deepseek-v4-flash` for Agent and FD Skill turns because that is the
only verified Responses/tool-capable DeepSeek path. The Web product may continue offering its
separate Pro and Flash modes; that does not expand Desktop model support. The server bootstrap
contract may later allow additional verified DeepSeek model IDs, but employees never add arbitrary
IDs. Model authorization is rechecked server-side per turn.

### 7.2 Driver Responsibilities

`FdDeepSeekDriver` supplies:

- provider availability based on FD login and policy;
- one model catalog from the bootstrap response;
- ordinary local sessions;
- selected FD Skill sessions;
- interruption and approval responses;
- thread read and rollback behavior;
- thread title, branch name, commit message, and PR text generation through New API;
- a canonical `ProviderRuntimeEvent` stream.

### 7.3 Route Rule

```text
selected skill source == fd-managed
  -> FdEnterpriseAgentClient
otherwise
  -> FdAgentKernel
```

The route is explicit from typed turn input. It is never inferred from assistant prose or a model
claim. A turn cannot switch route after execution begins.

Selecting an FD Skill routes the full turn to the Enterprise Agent, including greetings and
capability questions. The Enterprise Agent's intent classification decides whether a business tool
is needed. Lack of a tool call is not itself a failed or unauditable turn; only a data conclusion
requires a successful audit reference.

## 8. Local Agent Kernel

### 8.1 Context

The kernel receives:

- current user message and attachments;
- projected thread history selected by the T3 adapter;
- FD system policy;
- optional selected native Skill content;
- current project root, or a restricted office-mode attachment workspace;
- only tools permitted by the current permission mode.

It does not receive refresh tokens, database credentials, hidden FD Skill packages, View policy, or
unrelated thread history.

The kernel has no independent account, provider catalog, session database, checkpoint store, MCP
registry, plugin marketplace, remote runtime, or telemetry service. Those surfaces are either T3/FD
owned or intentionally absent.

### 8.2 Initial Tool Set

| Tool                     | Office mode          | Project mode       | Approval                |
| ------------------------ | -------------------- | ------------------ | ----------------------- |
| Read attached/local file | selected files only  | project root       | explicit outside root   |
| List/search files        | attachment workspace | project root       | explicit outside root   |
| Apply patch/edit         | disabled             | project root       | follows permission mode |
| Run command              | disabled             | project terminal   | follows permission mode |
| Git status/diff          | disabled             | project repository | read-only automatic     |
| Git mutation             | disabled             | project repository | explicit                |
| FD enterprise query      | never local          | never local        | server path only        |

Tool results are structured and size-limited. Errors return typed data to the model instead of being
converted into fake successful text. Cancellation propagates through model request and tool abort
signals.

### 8.3 Completion Invariant

A turn settles exactly once. `running -> completed | failed | interrupted` is monotonic. Late model,
tool, checkpoint, or server-history events cannot reopen or duplicate a settled assistant message.
Checkpoint completion may update Diff metadata but never controls assistant-turn completion.

## 9. Skill Design

### 9.1 Standard Native Skills

Discover standard `SKILL.md` packages from:

- `~/.agents/skills/<name>/SKILL.md`;
- `<project>/.agents/skills/<name>/SKILL.md`;
- existing T3/Codex-compatible roots already surfaced by the local catalog, including
  `~/.codex/skills` and `<project>/.codex/skills`, as compatibility inputs only.

Parse name, description, optional metadata, references, scripts, and assets. Project scope wins user
scope; canonical `.agents` roots win same-scope compatibility collisions. Malformed Skills are hidden
and reported in a diagnostics view. Loading a Skill does not automatically approve scripts or tools.
Skill-relative files are constrained to the Skill directory after real-path resolution so symlinks
cannot escape the approved root.

Native Skills can be disabled by managed policy. A selected native Skill is loaded on demand into the
local kernel; unselected full Skill contents do not consume model context.

The original ZIP is a migration source, not a trusted local database runtime. Its four packages live
under project `.agents/skills`, and the database package also references local scripts and connection
configuration. Therefore:

- an FD-managed catalog entry wins any name/identity collision with a local Skill, and the local copy
  is hidden with a diagnostic reason;
- a Skill marked FD-managed cannot be downgraded to local execution by copying or renaming files;
- local tools never receive an enterprise database connector, database credential, View policy, or
  permission-bypass command;
- the ZIP's field definitions, data dictionary, access rules, and business semantics are parity
  fixtures for the server-side Enterprise Agent, not Desktop authorization state.

### 9.2 FD Skills

FD Skills are virtual entries built from `/api/fd-skills/self`. Desktop stores only authorized display
metadata, version ID, and source marker. Full Skill instructions and data dictionaries remain on the
server and are loaded by the Enterprise Agent.

Every FD Skill turn sends one authorized `skill_version_id`, client `fd_desktop`, stable client thread
ID, idempotency key, model input, and employee token. The server rejects missing, multiple, stale, or
unauthorized versions.

### 9.3 Skill UI Invariants

- New conversation: no FD Skill selected.
- Local and FD Skills have distinct source badges.
- Revoked FD Skills disappear on policy refresh and cannot be used from stale UI state.
- A Skill suggestion is not execution; employee confirmation produces typed turn input.
- Selecting a database Skill does not force greetings or capability questions into a database tool
  call; the server Enterprise Agent keeps its intent classifier.

## 10. Enterprise Agent Projection

Map Enterprise Agent stream events into T3 events:

| Enterprise event         | T3 projection                            |
| ------------------------ | ---------------------------------------- |
| accepted/started         | turn running                             |
| reasoning/status summary | reasoning/status item                    |
| tool started             | tool lifecycle in progress               |
| tool completed/failed    | terminal tool lifecycle state            |
| assistant delta          | one assistant message delta stream       |
| completed                | assistant message final + turn completed |
| failed                   | typed failure + turn failed              |

The adapter validates conversation, turn, tool call, and audit identifiers before projection. An FD
data conclusion is displayable only when the server marks the turn auditable and returns a successful
audit reference. Zero rows are a successful data result only when a real audited query completed.

## 11. Local-only Security

### 11.1 Removed Product Surfaces

- Delete `apps/mobile` and mobile CI/release scripts.
- Delete `apps/marketing`; the FD Web workspace remains the only administrative and product Web
  surface.
- Delete `infra/relay` and T3 Connect cloud infrastructure.
- Delete `packages/ssh` and Desktop SSH environment management.
- Delete `packages/tailscale` and Tailscale endpoint discovery/serve controls.
- Delete third-party provider drivers, provider-specific CLI/runtime packages such as
  `packages/effect-codex-app-server` and `packages/effect-acp` when no FD code references them, plus
  their install/update/status UI and package dependencies.
- Remove Clerk, T3 Cloud, upstream analytics, and managed relay dependencies.
- Remove pair/connect/service remote CLI commands and remote onboarding UI.
- Remove network access, remote environment, hosted pairing, public sharing, QR code, and device
  management settings.
- Remove remote/mobile documentation and replace architecture docs with the FD local-only model.

### 11.2 Retained Local Security

- The server listens only on `127.0.0.1` or `::1` on an OS-assigned port.
- Electron launches and owns the server process.
- Renderer bootstrap uses an in-memory, single-use credential delivered without URL query or hash.
- HTTP and WebSocket requests require a local session credential.
- Origin checks accept only the packaged FD application scheme and the controlled local
  development origin.
- No setting or CLI flag can widen the bind address in production builds.
- Development-only local browser mode remains explicit and cannot be enabled in packaged builds.

## 12. Data and History

### 12.1 Enterprise Threads

The server-side Enterprise Agent history is canonical. Local T3 persistence stores the stable client
thread reference and non-sensitive lifecycle metadata, not decrypted customer query content. On
login or restart, Desktop reloads authorized enterprise history from the existing history endpoint
and reconstructs the view in memory.

### 12.2 Ordinary Local Threads

Local task metadata remains in T3 SQLite. Message text, attachment names, tool arguments/results, and
other employee content are encrypted before durable persistence with an AES-256-GCM per-user data
key. The data key is wrapped through Electron `safeStorage`; ciphertext carries key version, nonce,
and authentication tag. Search indexes never contain plaintext message content.

Sign-out locks local content. Account deletion or explicit local-data deletion removes wrapped keys
and database records. Key rotation and failed decryption are versioned, observable errors, never
silent empty history.

### 12.3 Attachments and Outputs

- Temporary model inputs use per-user directories and restrictive filesystem permissions.
- Enterprise result exports require explicit employee action and inherit audit metadata.
- Sign-out and retention cleanup remove temporary decrypted files.
- Database credentials, FD authorization policy, and server Skill packages are never cached locally.

## 13. Branding and Employee Copy

- Product name: `FD AI` / `方德 AI` according to locale context.
- Replace T3 icons, schemes, bundle IDs, updater metadata, window titles, docs links, and support
  links with FD-owned values.
- Preserve required MIT and third-party notices; do not use upstream trademarks as the product name.
- Employee errors state the action and recovery in Chinese. Protocol, Provider, MCP, Runtime,
  Responses API, and raw exception names stay in diagnostics only.

## 14. Updates and Release

- Electron updater points only to the FD release service.
- Web administration owns release channel, minimum supported version, mandatory/optional state,
  rollout ring, and rollback target.
- Packages require macOS Developer ID signing, notarization, and staple; Windows requires
  Authenticode and Defender/SmartScreen checks.
- Update migrations back up local state, are forward/backward versioned, and restore on failed
  candidate startup.
- The product never downloads provider CLIs or executes upstream self-update commands.
- Runtime dependencies are exact-version locked and pass license, provenance, and production bundle
  inspection; no floating Agent/runtime dependency can silently change tool behavior.

### 14.1 Diagnostics and Privacy

- Upstream T3/Cline analytics and account telemetry are absent.
- Local diagnostics are bounded, redact tokens, credentials, customer fields, prompts, tool
  arguments/results, and filesystem content, and rotate by size and age.
- Enterprise audit remains server-authoritative and is correlated by opaque audit/turn IDs.
- Crash reporting is disabled until FD approves a self-hosted, redacted, employee-visible policy.

### 14.2 Network and Configuration

- Production API origins are FD-owned build/release configuration, not employee settings.
- Requests use HTTPS, reject redirects to unapproved origins, and never fall back to public model
  endpoints.
- Offline or VPN failure produces a recoverable connection state. Cached policy may explain
  previously available capabilities but cannot authorize a new FD Skill or model turn after its TTL.
- No credentials, database hosts, passwords, or API keys are committed to source or shipped docs.

## 15. Fork and Upstream Strategy

- `origin` remains the FD fork and `upstream` tracks `pingdotgg/t3code`.
- FD changes live behind explicit identity, policy, driver, Skill, and product-boundary modules rather
  than scattered feature flags.
- Upstream changes are reviewed and imported deliberately; no automatic updater can overwrite the FD
  build.
- Retired provider/remote/mobile code is deleted rather than kept as an active compatibility path.
- Each upstream sync must rerun local-only socket checks, auth checks, bundle endpoint scans,
  DeepSeek runtime tests, and Skill parity tests before release.

## 16. Migration

### 16.1 From Existing FD Desktop

- FD account and Enterprise Agent history continue through existing server APIs.
- Existing `fd_desktop` client thread IDs may be adopted when mappings are available.
- Existing local Codex snapshots are not imported automatically in the first release; the old app
  remains readable during a documented transition window.
- No database or local-history deletion occurs without an explicit backup and migration verifier.

### 16.2 From T3 Code

This fork intentionally does not preserve T3 Cloud, provider accounts, remote environments, mobile
devices, or pairing sessions. Local project paths and Git worktrees may be imported only after schema
compatibility is verified.

## 17. Implementation Phases

### Phase 1: Product boundary

- Establish FD build identity and module boundary.
- Remove mobile/relay/SSH/Tailscale workspaces and build jobs.
- Restrict the server to Electron-owned loopback mode.
- Remove Clerk, T3 Connect, remote pairing, and third-party Provider UI.
- Remove third-party provider drivers, protocol packages, dependencies, marketing, and analytics.

Exit evidence: packaged app has no remote listener, remote controls, Clerk/T3 endpoints, mobile build,
or third-party provider selection.

### Phase 2: Identity and policy

- Port FD account client and secure credential storage.
- Add login/expiry/sign-out screens and policy bootstrap.
- Connect read-only FD Skill/model/update policy.

Exit evidence: a real FD employee can log in, refresh, sign out, and see exactly the authorized
capabilities; a disabled employee cannot start a turn.

### Phase 3: DeepSeek local provider

- First pass the deployed FD New API protocol spike for exact `deepseek-v4-flash`.
- Add `FdDeepSeekDriver`, `FdDeepSeekAdapter`, AI-SDK-backed `FdAgentKernel`, text generation, and
  local tools.
- Map reasoning, text, tools, approvals, interruption, and settlement to canonical T3 events.
- Hide all employee model configuration.

Exit evidence: real DeepSeek completes ordinary chat and a local project edit with correct Diff,
approval, cancellation, restart, and exactly-once completion.

### Phase 4: Skills

- Add native Agent Skill discovery and on-demand loading.
- Add FD Skill virtual catalog, picker, per-thread reset, and Enterprise Agent projection.
- Restore enterprise history by stable Desktop thread reference.

Exit evidence: original ZIP scenarios, ordinary greeting/capability prompts, authorized/denied Views,
zero rows, typo cases, audit, and new-thread reset all pass.

### Phase 5: Data protection and release

- Encrypt local content, implement retention and key lifecycle.
- Connect FD updater and release policy.
- Complete branding, packaging, migration tooling, and operations docs.

Exit evidence: ciphertext-at-rest inspection, logout lock, migration/rollback, signed installers, and
macOS/Windows real-device checks pass.

## 18. Verification Matrix

### 18.1 Identity

- Correct and incorrect credentials.
- Refresh success, expiry, network failure, and disabled user.
- Group/Skill revocation while app is open.
- Sign-out clears all active and persisted credentials.

### 18.2 Local-only Boundary

- Packaged server owns a loopback-only socket.
- LAN client cannot connect.
- No pairing, relay, SSH, Tailscale, mobile, or network-access routes are reachable.
- No Clerk, T3 Connect, upstream API, or provider installer endpoint appears in the production bundle.
- No third-party provider SDK/CLI, Cline runtime, upstream analytics, or public model endpoint appears
  in the production dependency graph or bundle.

### 18.3 Agent Runtime

- Plain greeting and capability question.
- Streaming reasoning summary and final text.
- Tool success, structured failure, retry, approval, denial, interruption, and timeout.
- One final assistant message and one terminal turn state.
- Project edit produces correct checkpoint and Diff.
- Restart restores settled history and does not resume completed work.

### 18.4 Skills and FD Data

- All original ZIP Skills remain discoverable according to policy.
- Standard local Skill loads only when selected.
- New conversation has no FD Skill.
- `蔡梦晨` latest holdings returns real audited data under authorized policy.
- `蔡梦辰` zero result is tied to a real audited query, not a model claim.
- Unauthorized View and field attempts fail before database execution.
- 11 View group grants match Web administration.
- Tool status settles and audit card matches the final answer.

### 18.5 Performance

- Cold start, first usable chat, memory at idle, long-thread scrolling, token streaming, large Diff,
  and project switching are benchmarked against unmodified T3 Code.
- No continuously repainting progress animation.
- Event subscriptions do not send full-thread snapshots for deltas.

### 18.6 Packaging

- macOS arm64/x64 and Windows x64 packages contain only FD assets and required runtimes.
- Signing and updater metadata verify.
- Upgrade and rollback preserve encrypted local state.

## 19. Acceptance Criteria

The redesign is complete only when all of the following are proven:

1. A non-technical employee can install, log in, open a new chat, use an authorized FD Skill, and
   understand the result without configuring a Provider, model, API key, project, MCP, or runtime.
2. Only FD-managed DeepSeek models are callable.
3. Standard native Skills and authorized FD Skills both work with distinct trust and execution paths.
4. Web remains the only administration surface.
5. Mobile, T3 Connect, SSH, Tailscale, remote pairing, public sharing, and network-reachable server
   modes are absent from the shipped product.
6. Local renderer/server communication remains authenticated and loopback-only.
7. FD permissions and audit remain enforced server-side, with no database credential on Desktop.
8. Original ZIP query semantics and field definitions have no unexplained drift.
9. Turns settle exactly once, with no duplicate answer or stale running state.
10. Local sensitive content is encrypted at rest and protected across logout, update, and migration.
11. Focused tests, real DeepSeek tests, ZIP parity, package inspection, and macOS/Windows real-device
    evidence all pass.

## 20. Explicit Deferred Items

- Mobile application of any kind.
- Remote control or cross-device continuity.
- SSH or remote project execution.
- Employee-selectable third-party models or providers.
- Public plugin marketplace.
- Automatic import of legacy Codex local snapshots.

## 21. Design Artifacts

### TaskIntentDraft

- Outcome: a simple, local-only FD AI Desktop derived from T3 Code.
- Success evidence: the acceptance criteria and verification matrix above.
- Stop condition: do not ship when any identity, authorization, data-at-rest, runtime-completion,
  local-only network, ZIP parity, signing, or rollback gate lacks evidence.
- Non-goals: all remote/mobile/multi-provider compatibility listed above.

### BaselineReadSetHint

- `AGENTS.md`
- `docs/internals/overview.md`
- `docs/internals/providers.md`
- `docs/internals/environment-auth.md`
- `docs/internals/remote.md`
- FD Gateway `docs/architecture/fd-skills-enterprise-agent-runtime.md`
- Existing FD Desktop identity, Enterprise Agent, routed runtime, and skill service implementations.

### BaselineUsageDraft

- Required baseline refs: T3 architecture/provider/auth; FD identity/Skill/Agent/Gateway contracts.
- Acknowledged before plan refs: all listed above.
- Missing refs: final FD Desktop release-policy API, signing identities, and rollout infrastructure are
  not yet available.
- Decision: use the existing username/password, access/refresh session, and managed Runtime Token
  contract now; keep future SSO behind `FdIdentityBroker` and implement release administration only
  in FD Workspace Web.

### ImpactStatementDraft

- Affected layers: workspace graph, contracts, server runtime, provider SPI, web renderer, Electron,
  persistence, CI/release, docs, and FD Gateway integration.
- Canonical new owners: `FdDeepSeekDriver`, `FdAgentKernel`, and their FD-specific collaborators.
- Retired owners: mobile, relay, SSH, Tailscale, remote environment and third-party provider product
  registrations.
- Compatibility: FD server APIs retained; T3 remote/provider compatibility intentionally removed.
- Primary risk: replacing external provider CLIs with a robust embedded DeepSeek tool loop while
  preserving T3 event and completion invariants.

## 22. User Approval

Implementation starts after the user approves this specification. Any change to the two-route
runtime, local-only boundary, administrative owner, data-at-rest rule, or Skill trust model requires
an explicit specification amendment before code changes proceed.
