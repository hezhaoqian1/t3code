# FD AI Desktop implementation - Checkpoint

- Task ID: 2026-08-09-fd-ai-desktop
- Current todo: Task 1: install dependencies and freeze baseline
- Active slice: Prepare isolated toolchain and run focused baseline tests.
- Blocked on: none
- Next step: Install with frozen lockfile using bundled Node/pnpm, then run targeted baseline tests.

## DriftCheckDraft

- Scope status: aligned with approved FD AI Desktop implementation plan
- Compatibility status: retains FD APIs and T3 local workbench only
- Retirement status: explicit, not yet executed
- New risk signals:
- System Python silently suppressed Aegis helper output; use bundled Python for all workspace checks.
- Advisory decision: continue

## Task 10 Final Review Remediation

- Current todo: Task 10: route FD Skills to Enterprise Agent
- Active slice: Task 10 review findings are repaired and reverified; no Task 11 work started.
- Completed review fixes:
- In-flight server-history restoration now preserves live Enterprise assistant/tool overlay messages and staged turns.
- History invalidation coverage uses a Deferred readiness handshake instead of a scheduler yield.
- Provider command reactor coverage proves accepted FD user text reaches the volatile Enterprise overlay while durable events remain secret-free.
- FD Skill picker coverage proves catalog revocation clears both the per-thread selection and sensitive composer draft.
- Verification: server Task 10 suite passed 6 files and 141 tests; Web FD privacy/selection suite passed 3 files and 81 tests; server and Web typechecks passed; formatter and git diff checks passed.
- Blocked on: none for Task 10 implementation; live authenticated QA remains intentionally deferred because the local endpoint was unavailable.
- Next step: finish the independent code-quality review gate, then commit `feat: integrate managed FD Skills` only when explicitly requested.

## DriftCheckDraft

- Scope status: remains within the approved Task 10 Enterprise Agent boundary.
- Compatibility status: local provider/project mode, durable orchestration, and authenticated loopback ownership remain unchanged; Enterprise instructions, View policy, and history remain server-owned.
- Retirement status: no second persistence owner or local enterprise fallback was introduced.
- New risk signals: live authenticated endpoint evidence is unavailable; automated protocol, privacy, authorization, replay, history-race, and revocation coverage is green.
- Advisory decision: continue

## Task 10 Managed FD Skills

- Current todo: Task 10: route FD Skills to Enterprise Agent
- Active slice: Route permission-filtered managed FD Skills through the New API Enterprise Agent while keeping instructions, View grants, audit, and encrypted history server-owned.
- Completed implementation:
- Added copied/adapted FD catalog, turn, SSE, and history contracts with bounded parsing and credential checks.
- Added per-conversation Skill selection, explicit clear, account-boundary draft/selection scrubbing, and memory-only enterprise overlays.
- Added enterprise tool grounding, retrying-call reconciliation, idempotent replay handling, audit enforcement, account-generation rejection, and post-switch history reloads.
- Added Desktop/Web picker and history synchronization while preserving local provider/project mode.
- Verification: 16 focused files and 343 tests passed; full Server suite passed 162 files and 1,409 tests; contracts, client-runtime, Desktop, Web, and Server typechecks passed.
- Build verification: latest Server bundle, Web production build, Desktop main/preload pack, Desktop smoke, release smoke, and production sensitive-field scan passed. Sensitive identifier count was 0 in preload, preload sourcemap, Web, and server client artifacts.
- Privacy verification: QA roots contained 0 files matching business-query markers and 0 files matching runtime-secret identifiers; values were not printed.
- Specification review: initial review found three P0/P1 issues; generation provenance, existing-thread history reload, and authoritative `replayed:true` terminal handling were repaired and covered by regression tests. Post-fix formal re-review remains pending.
- Code-quality review: independent review requested; pending final findings and re-review.
- Live QA: deferred because `http://127.0.0.1:5734/` returned HTTP 502; no live account or query result is claimed.
- Blocked on: formal post-fix specification approval and independent code-quality approval.
- Next step: finish both review gates, then update evidence and commit `feat: integrate managed FD Skills`; only after that begin Task 11 employee-first UX.

## DriftCheckDraft

- Scope status: Task 10 stays at the Enterprise Agent boundary: Desktop owns presentation and volatile synchronization; New API owns Skill permissions, tool execution, audit, and encrypted history; local Skills remain separate and cannot grant enterprise tools.
- Compatibility status: `/api/fd-skills/self`, `/api/agent/turns`, Desktop history, provider SPI, local project mode, and existing thread timeline remain compatible.
- Retirement status: no second database owner or local SQL fallback was added; enterprise instructions and View policy are never persisted in T3 state.
- New risk signals: live authenticated query evidence is still unavailable until the local service endpoint is restored; formal independent review must confirm the replay trust boundary and generation barrier.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 2: make workspace Desktop-only
- Active slice: Remove mobile, marketing, relay, SSH, and Tailscale workspaces plus build/release references.
- Completed todos:
- Task 1: dependency installation and focused baseline tests passed
- Evidence refs:
- task-1-baseline-tests: 4 files, 17 tests passed
- Blocked on: none
- Next step: Map tracked workspace-owned references, remove retired directories, update workspace scripts and regenerate lockfile.

## DriftCheckDraft

- Scope status: Task 1 stayed within baseline-only scope
- Compatibility status: No runtime behavior changed; T3 local workbench and FD API boundary untouched
- Retirement status: Task 2 ready; no retired source deleted yet
- New risk signals:
- Electron GitHub download stalled; ELECTRON_MIRROR npmmirror completed the same locked artifact install.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 3: collapse Electron to one local environment
- Active slice: Remove Desktop SSH, WSL, Tailscale exposure, saved-environment, and connection-catalog owners while preserving one primary loopback backend.
- Completed todos:
- Task 1: dependency installation and focused baseline tests passed
- Task 2: desktop-only workspace retirement and metadata verification passed
- Evidence refs:
- task-1-baseline-tests
- task-2-workspace-graph
- task-2-script-regression
- task-2-release-smoke
- Blocked on: none
- Next step: Map Desktop remote environment owners and their callers, then simplify backend configuration and IPC around one local environment.

## DriftCheckDraft

- Scope status: Task 2 removed only non-Desktop workspace products, release paths, and their dedicated tooling.
- Compatibility status: Electron renderer, local workbench packages, and FD API boundary remain intact; source-level remote callers are deferred to their planned owner tasks.
- Retirement status: Mobile, marketing, relay, SSH, Tailscale packages and active workspace metadata are retired; Desktop/server callers remain explicitly queued for Tasks 3 and 4.
- New risk signals:
- Lockfile graph legitimately re-resolved remaining peer contexts after removing five workspaces; focused release smoke passed.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 4: restrict the server to authenticated loopback
- Active slice: Remove server remote listeners, CLI paths, pairing, relay, and Tailscale bootstrap fields while preserving local authenticated sessions.
- Completed todos:
- Task 1 baseline installation and tests
- Task 2 desktop-only workspace retirement
- Task 3 single local Electron environment
- Evidence refs:
- task-3-desktop-regression
- task-3-typechecks
- task-3-retirement-scan
- Blocked on: none
- Next step: Review and commit Task 3, then map server bootstrap and remote route callers for Task 4.

## DriftCheckDraft

- Scope status: Task 3 stayed inside the one-Electron-environment retirement boundary.
- Compatibility status: Local preview, window, updater, auth, project filesystem, terminal, and client-runtime compilation remain intact.
- Retirement status: Desktop remote owners and executable IPC paths are removed; server bootstrap fields and client-runtime SSH payload models remain explicitly assigned to Tasks 4 and 5.
- New risk signals:
- Plan task ordering crosses a shared SSH payload contract; payload deletion must occur atomically with client-runtime callers in Task 5.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 5: simplify client contracts to the primary environment
- Active slice: Remove relay, bearer pairing, SSH targets, hosted authorization, and remote environment variants from shared client contracts while preserving the authenticated primary environment.
- Completed todos:
- Task 1: install dependencies and freeze baseline
- Task 2: make workspace Desktop-only
- Task 3: collapse Electron to one local environment
- Task 4: restrict the server to authenticated loopback
- Evidence refs:
- task-4-loopback-runtime
- task-4-auth-retirement
- task-4-regression
- Blocked on: none
- Next step: Review and commit Task 4, then atomically remove retained client-runtime remote target contracts and callers in Task 5.

## DriftCheckDraft

- Scope status: Task 4 stayed within the authenticated loopback server retirement boundary plus directly required dev/migration safety.
- Compatibility status: Electron bootstrap, browser session, access token, session cookie, WebSocket ticket, RPC authorization, local projects, terminal, Git, Diff, preview, and checkpoints remain; broad client remote contracts are unmounted and queued for Task 5.
- Retirement status: Server cloud, Connect, public CLI, pairing/access management, relay, Tailscale, service launcher, remote runtime state, active remote docs/config, and pairing persistence owner are retired; migration history remains only for safe upgrade and final drop.
- New risk signals:
- Web package typecheck remains blocked by Task 5/6 remote renderer owners; do not mask those diagnostics with compatibility shims.
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Task 5 stayed inside primary-environment contracts, local authentication, migration, and directly required development loopback enforcement.
- Compatibility status: Authenticated primary HTTP/WebSocket reconnect, local projects, threads, orchestration, terminal, review, and caches remain; Electron is the sole bearer-token cache owner.
- Retirement status: Contracts/client-runtime remote targets, relay, pairing, DPoP, remote scopes, and saved target owners are retired; remaining Web/shared hosted UI callers are explicitly assigned to Task 6.
- New risk signals:
- Task 6 must remove remaining hosted/shared UI callers rather than reintroduce compatibility exports.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 6: remove remote and multi-environment renderer UX
- Active slice: Delete remote, pairing, cloud, WSL, SSH, provider-maintenance, and multi-environment renderer owners while preserving the primary local workbench.
- Completed todos:
- Task 1: install dependencies and freeze baseline
- Task 2: make workspace Desktop-only
- Task 3: collapse Electron to one local environment
- Task 4: restrict the server to authenticated loopback
- Task 5: simplify client contracts to the primary environment
- Evidence refs:
- task-5-client-contract-regression
- task-5-independent-review
- Blocked on: none
- Next step: Commit Task 5, then delete Task 6 leaf routes/components and collapse root/settings/sidebar/command-palette composition to one primary environment.

## DriftCheckDraft

- Scope status: Task 6 stayed within renderer and shared hosted-owner retirement, plus directly required single-primary state and route corrections.
- Compatibility status: Local backend recovery, projects, threads, drafts, terminal, review, Git, Diff, checkpoints, preview, themes, Desktop updater, SSH Git cloning, provider runtime, and Desktop Clerk remain at their planned ownership boundaries.
- Retirement status: Pairing, Connect, hosted/public startup, renderer Clerk gates, cloud/relay/WSL/SSH environment UX, provider maintenance UI, environment-qualified URLs, and specified shared remote owners are retired without compatibility redirects.
- New risk signals:
- Packaged Desktop manual smoke remains deferred to the real runtime acceptance task; Web production build and full renderer regression are green.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 7: apply FD product identity and login
- Active slice: Add FD account contracts, encrypted credential ownership, private Electron-to-server credential delivery, employee login UI, and FD product identity without importing Codex runtime ownership.
- Completed todos:
- Task 1: install dependencies and freeze baseline
- Task 2: make workspace Desktop-only
- Task 3: collapse Electron to one local environment
- Task 4: restrict the server to authenticated loopback
- Task 5: simplify client contracts to the primary environment
- Task 6: remove remote and multi-environment renderer UX
- Evidence refs:
- task-6-renderer-regression
- task-6-independent-review
- Blocked on: none
- Next step: Commit Task 6, then implement the FD identity broker, credential vault, private child-process credential channel, login gate, and branding in Task 7.

## DriftCheckDraft

- Scope status: Task 7 stayed within FD account identity, credential ownership, the private Electron-to-server projection, renderer authentication gating, Clerk retirement, and public FD product metadata.
- Compatibility status: Local backend bootstrap/auth/restart, projects, files, terminal, Git, Diff, checkpoints, preview, themes, updater UI, and provider/runtime abstractions remain at their existing owners.
- Retirement status: Desktop Clerk, passkey packaging, Clerk public-config projection, orphaned relay identity helpers, upstream account/publish endpoints, and old product schemes are retired without compatibility fallback.
- New risk signals:
- Task 12 still owns the final updater/release mechanism and encrypted conversation migration; Task 13 still owns packaged real-runtime acceptance.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 8: add the FD-managed DeepSeek runtime
- Active slice: Task 7 is complete; do not widen its identity broker into provider or agent runtime ownership.
- Completed todos:
- Task 1: install dependencies and freeze baseline
- Task 2: make workspace Desktop-only
- Task 3: collapse Electron to one local environment
- Task 4: restrict the server to authenticated loopback
- Task 5: simplify client contracts to the primary environment
- Task 6: remove remote and multi-environment renderer UX
- Task 7: apply FD product identity and login
- Evidence refs:
- task-7-identity-regression
- task-7-build-release
- task-7-retirement-scan
- Blocked on: none
- Next step: Begin Task 8 from the FD runtime credential store without moving session or vault ownership out of Electron main.

## Task 7 Specification Review Remediation

- Current todo: Task 8: add the FD-managed DeepSeek runtime
- Active slice: Task 7 review findings are repaired and reverified; Task 8 may consume only the versioned in-memory server projection.
- Completed review fixes:
- Versioned renderer-safe policy bootstrap, exact-model server policy, explicit/single-flight/periodic refresh, and authorization invalidation
- Fail-closed durable logout intent plus crash-safe, idempotent pending revocation recovery
- Strict New API success/status/model checks and tracked immutable enterprise config
- Bounded no-symlink vault/config reads and bounded fail-closed fd6 NDJSON
- Private server package metadata, Task 8 owner diff rollback, and password toggle form safety
- Evidence refs:
- task-7-identity-regression
- task-7-build-release
- task-7-retirement-scan
- Blocked on: none
- Next step: Begin Task 8 without changing Electron credential ownership or rebranding provider/runtime internals.

## Task 7 Final Review And Verification

- Current todo: Task 8: add the FD-managed DeepSeek runtime
- Active slice: Task 7 is committed-ready after the identity, branding, renderer-boundary, and documentation review loops.
- Completed review fixes:
- Login cleanup is crash-safe and idempotent, including session-mismatch recovery and bounded duplicate Runtime Token cleanup.
- Renderer authentication is published only after durable vault commit; broker disposal drains in-flight work.
- FD artwork is the sole tracked icon source; old channel artwork and icon generators are retired.
- The private fd6 credential schema is available only through an explicit contracts subpath and is absent from the renderer production graph.
- Production Web builds remove the development bootstrap credential identifier and inherited value; focused tests cover matching loopback development, non-development, non-loopback, and mismatched-origin behavior.
- The active workspace documentation now describes the Desktop-only, private local runtime.
- Independent review: specification approved; code quality approved after two Minor findings were repaired and re-reviewed.
- Controller verification: 38 focused test files and 375 tests passed; contracts, Desktop, server, Web, scripts, and shared typechecks passed.
- Build verification: hostile-environment Web production build transformed 4,231 modules; server bundle, Desktop main/preload pack, and release smoke passed.
- Retirement verification: renderer credentials and development bootstrap identifiers, Clerk/T3 Cloud/old scheme identifiers, public package publishing, old icon owners, and Task 8 owner drift are absent.
- Blocked on: none
- Next step: Commit Task 7, then start the real exact-Flash Responses protocol spike for Task 8.

## DriftCheckDraft

- Scope status: Task 7 remained inside FD identity, private credential delivery, renderer login gating, product branding, and directly required production-boundary fixes.
- Compatibility status: Local projects, terminal, Git, Diff, checkpoints, approvals, preview, themes, updater UI, and provider/runtime SPIs remain intact.
- Retirement status: Clerk/passkey/public identity paths, public server publishing, old product schemes, old icon generators/assets, and renderer-visible credential contracts are retired.
- New risk signals:
- A repo-wide server test still contains an unrelated stale import of the previously retired mobile workspace; it is outside Task 7 focused verification and must be removed before final delivery.
- Task 8 still requires a real deployed Responses API spike before the embedded agent implementation can be accepted.
- Advisory decision: continue

## Task 8A Responses Protocol Gate

- Current todo: Task 8: add the FD-managed DeepSeek runtime
- Active slice: The exact-Flash Responses transport is accepted; the Provider driver, Agent kernel,
  local tools, approvals, settlement, and provider retirement remain in Task 8B.
- Protocol boundary:
- Exact `deepseek-v4-flash` and exact `/v1/responses`; `store: false`; no
  `previous_response_id` or stored conversation continuation.
- Request-time private credential subscription with active clear, replacement, and expiry
  invalidation; semantically equivalent 30-second policy refreshes do not interrupt long turns.
- Bounded stateless function-call continuation, SDK-plus-JSON-Schema validation, exact model
  metadata enforcement, explicit terminal/error mapping, cancellation, timeout, and stream limits.
- Real deployed probe: exact model identity, text streaming, usage, deterministic function call,
  stateless function output continuation, and cancellation passed. The model did not emit an
  optional reasoning summary during the probe; no summary is fabricated.
- Independent review: specification approved after three trust-boundary fixes; code quality
  approved after credential-lifecycle, output-item validation, schema-budget, and periodic-refresh
  fixes.
- Controller verification: Node 24 focused regression, affected typechecks, server/Web/Desktop
  production builds, release smoke, renderer-secret scans, and final real deployed probe passed.
- Evidence refs:
- task-8a-responses-regression
- task-8a-real-probe
- task-8a-build-boundary
- task-8a-independent-review
- Blocked on: none
- Next step: Commit the protocol gate, then implement `FdAgentKernel`, `FdDeepSeekAdapter`, and
  `FdDeepSeekDriver` while preserving this transport and Task 7 credential ownership.

## DriftCheckDraft

- Scope status: Task 8A stayed inside the FD Responses transport, private runtime origin projection,
  exact SDK dependencies, and directly required protocol tests/probe. Provider, Skills, tools, UI,
  persistence, and settlement owners remain untouched.
- Compatibility status: Electron main still owns account sessions, vault data, Runtime Token
  lifecycle, and policy refresh. The renderer receives no credentials. Existing provider SPI and
  local workbench behavior remain available for Task 8B migration.
- Retirement status: no provider was retired in this slice; retirement begins only after the FD
  driver is feature-complete and canonical callers move.
- New risk signals:
- Deployed Flash supports the requested reasoning-summary protocol but did not emit a summary in
  repeated real probes; user-visible progress must rely on canonical tool/status events and display
  a model summary only when one is actually returned.
- `ai` carries transitive gateway/OIDC packages in the install graph; Task 8B production package
  inspection must prove unused public provider paths are absent from executable bundles.
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Task 10 is complete within the approved Enterprise Agent boundary; no Task 11 employee UX source was included.
- Compatibility status: FD New API remains authoritative for Skill permissions, model policy, tools, audit, and enterprise history. T3 retains local provider/project mode and uses only volatile enterprise overlays; authenticated loopback and provider SPI contracts remain intact.
- Retirement status: No local SQL fallback, second enterprise persistence owner, full instruction/View policy storage, or third-party provider path was added. Per-thread retired revision metadata was removed in favor of one process-wide monotonic allocator.
- New risk signals:
- Live authenticated Enterprise QA and all 11 real View grants remain Task 13 acceptance evidence because the local FD endpoint was unavailable during Task 10.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 11: make the default UX employee-first
- Active slice: Task 10 implementation, specification remediation, independent quality review, and final verification are complete. The next source slice is Task 11 employee-first office mode; no Task 11 code has started.
- Completed todos:
- Task 1: install dependencies and freeze baseline
- Task 2: make workspace Desktop-only
- Task 3: collapse Electron to one local environment
- Task 4: restrict the server to authenticated loopback
- Task 5: simplify client contracts to the primary environment
- Task 6: remove remote and multi-environment renderer UX
- Task 7: apply FD product identity and login
- Task 8: add the FD-managed DeepSeek runtime
- Task 9: add local Agent Skills
- Task 10: route FD Skills to Enterprise Agent
- Evidence refs:
- task-10-managed-fd-skills-regression
- task-10-build-boundary
- task-10-final-review-remediation
- task-10-final-quality-gate
- Blocked on: none
- Next step: Commit Task 10 as feat: integrate managed FD Skills, then inspect current app shell/composer/sidebar and implement Task 11 behind the existing local project workbench boundary.

## Task 11 Office Workspace Decision

- Current todo: Task 11: make the default UX employee-first
- Active slice: Create one app-owned default office workspace that reuses the existing internal
  project/thread contract, then distinguish office mode from employee-opened project mode in Web.
- User decision: create a local default office area and handle it like an opened project internally.
- Minimum boundary: Desktop owns the bounded directory and idempotent welcome document; server
  bootstraps the directory as the hidden default project and enforces its restricted local-tool
  policy; Web owns office/project presentation.
- Explicit non-edits: no project-optional thread schema, no user-home or recent-project fallback, no
  Task 12 encryption/updater work, and no change to Enterprise Agent authorization/history ownership.
- Verification: focused Desktop/server startup tests, Web office/project-mode and business-capability
  tests, affected typechecks, retirement/copy scans, and browser screenshots after user permission.
- Blocked on: browser/computer-use permission only for the final visual acceptance pass.
- Next step: implement the bounded office workspace owner and employee-first Web wiring, then run the
  Task 11 specification and code-quality review gates.

## Task 11 Final Quality Gate

- Current todo: Task 11 employee-first office workspace source is ready to commit; automated visual
  acceptance remains pending.
- Implemented boundary: Desktop owns and seeds the bounded office workspace; Server publishes only
  its hidden project identity, starts each launch on a fresh Web draft, and binds the office-read-only
  tool profile to trusted project provenance; Web hides technical workbench and Settings entry points
  in office context while preserving project mode.
- Skill boundary: `projects.listSkills` validates an exact active project root and returns metadata
  only. Project-local Skill instructions remain session-cwd scoped and never enter the global
  provider snapshot. FD selection revocation runs only from an authoritative ready FD catalog.
- Review result: final specification and independent code-quality reviews report no Critical,
  Important, or Minor findings after five quality repairs.
- Fresh verification: 17 focused files and 174 tests passed; Server, Web, contracts,
  client-runtime, and Desktop typechecks passed; current Web production build, Server bundle, and
  Desktop main/preload pack passed; formatter and `git diff --check` passed.
- Visual boundary: Web development and packaged Electron startup were observed. Desktop and compact
  laptop screenshot acceptance is not passed because macOS UI automation timed out twice.
- Evidence refs:
  - task-11-final-quality-gate
- Blocked on: visual acceptance only; no code-quality blocker remains.
- Next step: commit Task 11 as `feat(web): add FD employee workspace`, keep Task 12 paused, then amend
  the design and implementation plan for the authorized Codex App Server compatibility spike.

## Task 11 Task Directory Amendment

- Current todo: replace the shared default office execution directory with one persistent directory
  per no-workspace task.
- User decision: no workspace means a task area, not a default office workspace. Create
  `~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss` on first send; keep its files after the task ends; create a
  different directory for the next task.
- Intent lock: Tasks are existing threads. Workspaces are user-opened projects. A generated task
  directory is an internal typed project with `projectPurpose = "task"` and does not appear in the
  Workspaces list.
- Scope fence: contracts, project event/projection persistence, Desktop bootstrap task-root policy,
  server first-send bootstrap/cleanup, Web draft context and task/workspace presentation, and focused
  tests. Do not alter Codex/Enterprise Agent execution ownership or credential boundaries.
- Compatibility: missing project purpose decodes as `workspace`; the hidden office project remains
  compatible and hidden but receives no new turns. Existing user projects and conversations remain
  addressable.
- TDD route: `off / skipped`; use post-change focused regression and affected typechecks/build.
- Verification: prove timestamp naming and collision handling, no directory on draft creation,
  first-send directory/project/thread binding, failure cleanup, persistence after settlement, typed
  Workspaces filtering, and legacy event/row decoding.
- Blocked on: none.

## Codex App Server Runtime Amendment

- Current todo: Task 11A: restore Codex App Server as the ordinary/project/local-Skill Agent runtime.
- Authorized architecture: T3 continues to own UI, projects, local workbench, and conversation/event
  projection; Codex App Server owns ordinary Agent execution; FD identity owns login, short-lived
  credentials, and policy delivery; FD Enterprise Agent owns enterprise Skills, data authorization,
  audit, and enterprise history.
- Conversation invariant: one execution owner per conversation. The first turn binds
  `codex-local` or `enterprise-remote`; switching owner requires a new conversation.
- Current implementation truth: `FdAgentKernel` and `FdResponsesClient` still own ordinary turns at
  commit `36316ed6`. They are transitional and cannot be retired until the Codex compatibility gate
  passes.
- Existing proof source: the adjacent FD Desktop already contains Managed `CODEX_HOME`, minimal
  child-environment injection, exact `deepseek-v4-flash`, and real Codex App Server integration and
  scenario tests. Task 11A adapts that proven FD boundary to T3's existing Codex adapter/session
  runtime rather than building another kernel.
- Selective restore boundary: `effect-codex-app-server`, Codex adapter/session runtime, developer
  instructions, launch arguments, and focused fixtures only. Do not restore Claude, Cursor, Grok,
  OpenCode, ACP, provider settings/catalog, maintenance/installers, updater behavior, or employee
  Codex accounts.
- Credential invariant: the Runtime Token may exist only in the Codex child-process environment. It
  must not enter process arguments, parent/global environment, Codex auth/config files, persisted
  sessions/events, logs, renderer projections, or crash reports.
- Compatibility gate: exact model/endpoint, text/reasoning/tool/approval/user-input/usage/cancel/
  terminal projection, local Skill execution, exactly-once settlement, identity invalidation, and
  restart/resume must pass before ordinary traffic migrates or transitional code is removed.
- TDD route: `off / skipped`; use focused post-change regression and the opt-in real runtime test.
- Blocked on: no planning blocker. Live endpoint proof requires the existing gated FD integration
  environment; local structural and fake-runtime compatibility work can proceed without it.
- Next step: restore the minimal Codex protocol/runtime slice and add the FD managed-home and child
  environment compatibility harness. Task 12 remains paused.

## Checkpoint Update

- Current todo: Task 11A: run the real FD Codex App Server compatibility gate
- Active slice: Local structural and fake-runtime compatibility evidence is green. The skipped-by-default real test is implemented but has not run against the exact FD endpoint.
- Completed todos:
- Selectively restored effect-codex-app-server and T3 Codex adapter/session runtime
- Bound exact deepseek-v4-flash and fd_new_api through managed CODEX_HOME and a minimal child environment
- Routed ordinary/project/local-Skill turns through Codex while retaining Enterprise Agent ownership
- Proved structured local Skills, bidirectional conversation owner locking, restart/resume, approval, user input, cancellation, usage, and exactly-once projection with focused local tests
- Passed 14 focused files and 237 tests, four package typechecks, Server bundle, format, diff, and credential-boundary scans
- Evidence refs:
- task-11a-codex-compatibility-local
- Blocked on: FD_RUN_REAL_APP_SERVER, an absolute working FD_CODEX_BINARY, and FD_NEW_API_KEY are unavailable; the global codex install is missing @openai/codex-darwin-x64.
- Next step: Provide the gated runtime inputs and run apps/server/src/fd-codex/FdCodexAppServer.integration.test.ts. Only after it passes, review the compatibility gate and retire FdAgentKernel/FdResponsesClient/AI SDK callers.

## DriftCheckDraft

- Scope status: Task 11A remains inside the approved T3 UI/local-state, Codex ordinary-runtime, FD identity, and Enterprise Agent ownership boundary; Task 12 was not entered.
- Compatibility status: All local protocol, routing, projection, Skill, owner-lock, invalidation, and resume tests pass; exact live FD App Server execution is still unverified.
- Retirement status: FdAgentKernel, FdResponsesClient, FdDeepSeekTextGeneration, and AI SDK dependencies remain transitional and must not be removed until the gated real test passes and the compatibility evidence is reviewed.
- New risk signals:
- The branch routes ordinary turns through Codex but is uncommitted and must not ship until the live gate runs.
- The installed global codex command is unusable because @openai/codex-darwin-x64 is missing.
- Advisory decision: needs-verification

## Task 11 Task Directory Implementation Checkpoint

- Current todo: complete user acceptance for WorkBuddy-style no-workspace tasks.
- Implemented boundary: Desktop publishes `~/FangdeAI/Tasks` as policy only; Web creates a unique
  typed task draft without touching disk; the first turn atomically creates a `projectPurpose =
"task"` project, a matching thread, and a timestamp directory. Failed bootstrap removes the
  created thread/project and removes the task directory only while it remains empty.
- Product behavior: Desktop new-task button, `chat.new` shortcut, and command palette all create a
  no-workspace task. The draft hero offers optional workspace selection. Task projects remain in the
  task list but are excluded from workspace pickers and project settings.
- Compatibility: the hidden office project remains a draft staging identity only. Existing rows and
  events without `projectPurpose` continue as `workspace`; migration 42 defaults existing projection
  rows to `workspace`.
- Verification: task workspace tests passed 3 tests; Web office/task and composer draft tests passed
  85 tests; contracts, client-runtime, Desktop, Web, and Server typechecks passed; Web production
  build transformed 4,221 modules; Server bundle passed. The restarted demo backend on port 51127
  returns HTTP 302, exposes migration 42, and did not create `~/FangdeAI/Tasks` before first send.
- Visual boundary: no browser or Computer Use verification was performed because this task retained
  the existing explicit-permission boundary. User acceptance is available in the restarted Desktop
  demo.
- Blocked on: none for implementation; first real task send is intentionally left to user acceptance
  because it invokes the configured Agent runtime and creates persistent user files.
- Next step: send one no-workspace task in the demo and confirm the resulting directory under
  `~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss`; then continue the Task 11A live Codex compatibility gate.
