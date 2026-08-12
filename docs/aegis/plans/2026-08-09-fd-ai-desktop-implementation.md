# FD AI Desktop Implementation Plan

Date: `2026-08-09`

Status: `in implementation; Codex runtime amendment authorized`

## Goal

Convert the T3 Code fork into FD AI Desktop for non-technical employees. Ship one Electron-owned,
authenticated, loopback-only execution environment; one FD account system; one company-managed
DeepSeek model path; standard local `SKILL.md` packages; and server-managed FD Skills through the
existing Enterprise Agent. Remove every mobile, hosted, relay, SSH, Tailscale, WSL multi-environment,
remote pairing, public sharing, T3 Cloud, Clerk, and third-party provider product path.

## Architecture

The packaged product has four runtime owners:

1. Electron main owns process launch, local environment authentication, FD identity credentials,
   secure storage, window lifecycle, and updates.
2. The T3 local server owns event-sourced conversations, project files, terminal, Git, Diff,
   checkpoints, local tools, and canonical provider events.
3. The hidden FD provider route selects exactly one execution owner when a conversation is created:
   T3's Codex App Server runtime for ordinary/project/local-Skill conversations, or
   `FdEnterpriseAgentClient` for explicitly selected FD Skill conversations.
4. FD New API, Enterprise Agent, and FD Tool Gateway own employee authorization, model policy,
   enterprise Skill instructions, View grants, database execution, encrypted enterprise history,
   and audit.

Changing execution owner requires a new conversation; there is no transparent mid-conversation
handoff or retry through the other owner. Codex is retained only as the hidden Agent runtime, not as
an employee account/provider product surface. There is no fallback to Claude, Cursor, Grok,
OpenCode, Cline, a public model endpoint, or a remotely reachable T3 environment.

## Tech Stack

- Electron 41 main/preload shell.
- React 19 and the existing T3 renderer.
- Effect 4 and T3 typed contracts/event sourcing.
- T3's existing `effect-codex-app-server` integration and Codex child-process runtime for ordinary,
  project, and local-Skill conversations.
- Transitional `ai` 7 and `@ai-sdk/openai` 4 behind `FdAgentKernel`, retired after the compatibility
  and migration gate passes.
- Existing FD New API username/password, access/refresh session, managed Runtime Token, FD Skill,
  Enterprise Agent SSE, and history APIs.
- SQLite for local metadata; AES-256-GCM payload encryption with keys wrapped by Electron
  `safeStorage` for employee content.
- pnpm 11 / Vite Plus with the Codex-bundled Node runtime during local implementation.

## Baseline And Authority Refs

- Approved design: `docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md`.
- Initial baseline: `docs/aegis/baseline/2026-08-09-initial-baseline.md`.
- T3 rules: `AGENTS.md`.
- T3 orchestration: `docs/internals/overview.md`.
- T3 provider SPI: `docs/internals/providers.md`.
- Current environment auth: `docs/internals/environment-auth.md`.
- Retirement source map: `docs/internals/remote.md` and `docs/internals/workspace-layout.md`.
- FD runtime authority in the adjacent repository:
  `../FD-gateway/docs/architecture/fd-skills-enterprise-agent-runtime.md`.
- Reuse sources in the adjacent repository:
  `../FD-gateway/apps/fd-desktop/src/main/account/`,
  `../FD-gateway/apps/fd-desktop/src/main/runtime/`, and
  `../FD-gateway/apps/fd-desktop/src/main/enterprise-skill-service.ts`.
- Original parity source: `Codex_Business_Workspace_v1.0.0.zip`, especially its four
  `.agents/skills` packages, data dictionary, access policy, and database Skill semantics.

## Compatibility Boundary

Retain:

- Existing FD Web administration and New API contracts.
- Existing Enterprise Agent `fd_desktop` client IDs, idempotency behavior, encrypted history, audit
  semantics, and Tool Gateway authorization.
- T3 local projects, threads, terminal, Git, Diff, checkpoints, approvals, and renderer performance.
- Standard Agent Skills from approved local roots.

Intentionally retire:

- T3 mobile, marketing, Connect relay, cloud account, public web, remote server, SSH, Tailscale, WSL
  environment, hosted pairing, network exposure, QR code, public sharing, and multi-device behavior.
- Clerk and T3 account/subscription behavior.
- Claude, Cursor, Grok, OpenCode, ACP, provider installer/update behavior, and employee-visible
  Codex provider/account configuration. Retain only the Codex App Server runtime required by the
  hidden FD ordinary execution path.
- Automatic migration of T3 Cloud, remote environment, provider-account, or legacy Codex local
  session state.

The server-side FD authorization contract is preserved. Desktop cannot make a local copy of View or
database authorization authoritative.

## TDD Route

- Mode: `off`.
- Decision: `skipped`.
- Strict authority: `not applicable`.
- Test posture: focused post-change regression, contract tests, package inspection, and real-runtime
  acceptance.
- Reason: the user requested complete verification but not strict test-first development. Retirement
  and architecture changes need proportional focused tests without prescribing artificial RED steps.
- Verification: each task names targeted tests; the final gate adds packaged socket, dependency,
  endpoint, real DeepSeek, FD Skill, ZIP parity, and UI checks.

## Planning Readback

### Aegis Visibility

The plan keeps one canonical owner for identity, local execution, enterprise authorization, and turn
completion while retiring cross-cutting remote/provider paths without leaving hidden re-entry points.

### BaselineUsageDraft

- Required baseline refs: approved design, T3 orchestration/provider/auth/remote docs, FD Enterprise
  Agent design and existing Desktop account/runtime code, original ZIP.
- Acknowledged before plan refs: all required refs above.
- Cited in plan refs: all required refs above.
- Missing refs: production signing identities and final FD Desktop release-policy endpoint.
- Decision: `continue`; signing/release administration is a late release gate and does not block
  local product/runtime implementation.

### Requirement Ready Check

- Requirement source refs: user objective and approved FD AI Desktop design.
- Goals and scope refs: design sections 1, 3, 7, 9, 11, 16-20.
- User/scenario refs: non-technical employee login, ordinary chat, local project work, authorized FD
  data query, new-conversation Skill reset.
- Requirement item refs: one Desktop environment, FD identity, Flash-only DeepSeek, two Skill trust
  paths, Web-only admin, full remote/provider retirement.
- Acceptance refs: design sections 18 and 19.
- Open blocker questions: none for implementation start.
- Decision: `ready`.

### Change Necessity

- User-visible need: the current fork is still T3 Code with remote/multi-provider behavior and cannot
  authenticate or execute as FD AI.
- No-change option: configuration and branding alone leave reachable remote endpoints, Clerk,
  third-party provider runtimes, wrong identity, and no FD Skill route.
- Why code is necessary: runtime ownership, contracts, process launch, auth, persistence, and UI all
  differ from the approved product.
- Minimum boundary: Electron, server, renderer, contracts/client runtime, workspace graph, release
  scripts, and focused FD integration modules.
- Decision: `code-change`.

### Existence Check

- Proposed surfaces: `FdIdentityBroker`, `FdDeepSeekDriver`, `FdAgentKernel`,
  `FdEnterpriseAgentClient`, and `FdSkillCatalog`; amended ordinary-runtime target reuses T3's
  existing Codex driver, adapter, and session runtime.
- Reuse candidates: existing FD Desktop account/runtime code, T3 Provider SPI, T3 event ingestion,
  T3 Skill presentation helpers, New API Enterprise Agent.
- Why reuse alone is insufficient: T3 still needs FD identity, hidden provider policy, credential
  injection, Enterprise Agent routing, and FD Skill ownership. T3 already has the ordinary Agent
  runtime and event projection, so those parts must be reused instead of recreated.
- Creation proof: each new owner bridges one missing boundary and replaces, rather than duplicates,
  the retired T3/FD owner.
- Entropy impact: the Codex reuse amendment retires the duplicated FD tool loop and Responses client
  after proof, while retaining bounded FD identity, policy, and enterprise modules.
- Decision: `reuse-existing` for ordinary execution; `add-with-proof` remains valid only for the FD
  identity and enterprise trust boundaries.

### Architecture Integrity Lens

- Invariant: one employee identity, one local environment, one product provider, one terminal state
  per turn, and server-final enterprise authorization.
- Canonical contracts: T3 `ProviderAdapterShape` and `ProviderRuntimeEvent`; FD Enterprise Agent SSE.
- Responsibility overlap: prohibited between Codex App Server and T3 persistence/checkpoints, and
  between Desktop/local tools and FD Tool Gateway. The transitional AI SDK loop cannot remain as a
  second ordinary owner after migration.
- Higher-level simplification: bind one execution owner at conversation creation, then project both
  owners into the existing T3 event contract without mid-conversation switching.
- Retirement falsifier: any shipped remote target, provider selector, database credential, public
  endpoint, or second conversation owner fails the plan.
- Verdict: proceed.

### Plan Pressure Test

- Owner/contract/retirement: explicit owners and delete lists exist.
- Architecture integrity: local and enterprise routes share event normalization but not trust.
- Verification scope: source graph, runtime socket, package bundle, real model, real Skill, and UI are
  all covered.
- Task executability: tasks are ordered so each deletion follows removal of callers.
- Pressure result: `proceed`.

### Plan-Time Complexity Check

- Artifact class: cross-workspace architecture and retirement.
- Pressure: `DesktopApp.ts`, `DesktopBackendConfiguration.ts`, `server.ts`, client connection state,
  provider registry, and renderer settings currently have mixed responsibilities.
- Projected pressure: over-budget if FD logic is inserted into those files directly or if both Codex
  and `FdAgentKernel` remain active ordinary-runtime owners.
- Governance: keep narrow FD identity/policy/enterprise modules, selectively restore the existing
  Codex owner, and delete the transitional ordinary owner only after compatibility proof.
- Recommendation: split task batches and add owner files; do not implement a permanent
  `isFdBuild ? ... : ...` compatibility fork.

## Execution Readiness View

- Intent Lock: produce FD AI Desktop, not a generic T3 distribution.
- Scope Fence: one Electron-owned local environment; ordinary/local-Skill and FD-Skill execution;
  optional local project mode; no remote or third-party provider compatibility.
- Baseline Lock: approved design and authority refs above.
- Approved Behavior: Flash-only Desktop, Web-only admin, new-chat FD Skill reset, audited data
  conclusions, exactly-once turn settlement.
- Owner/Contract Constraints: FD New API owns identity/model policy; Tool Gateway owns data auth; T3
  owns local state; adapter owns event normalization.
- Compatibility Boundary: retain FD APIs and T3 local workbench; retire all named remote/provider
  surfaces.
- Retirement Boundary: source, dependencies, workspace packages, scripts, tests, docs, and bundle
  endpoints are removed together.
- Task Batches: baseline, local-only retirement, branding/identity, provider, Skills, employee UX,
  encryption/release, final acceptance.
- Test Obligations: targeted unit/contract tests per task plus real packaged and server integration
  gates.
- Review Gates: one commit per task group, cached diff review, no unrelated changes, no live
  `~/.t3/userdata` writes.
- Drift Rules: stop and amend the design if implementation requires a remote fallback, Desktop-held
  DB credential, second provider, second history owner, or employee model configuration.
- Evidence Required: commands and acceptance matrix in this plan.
- Advisory Boundary: execution guidance only; final completion requires direct evidence.

## Runtime Toolchain

Every command in this plan runs with the bundled runtime so the machine's Node 14 installation is
never used:

```bash
export PATH="/Users/windupbird/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/windupbird/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/windupbird/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
node --version
pnpm --version
```

Expected: Node satisfies root `^24.13.1`; pnpm resolves the repository-pinned `11.10.0` workflow.

## Task 1: Freeze Baseline And Install Dependencies

**Files:** `pnpm-lock.yaml`, no production source changes.

**Why:** all later focused tests need the correct Node/pnpm runtime and an unchanged upstream
baseline.

**Change Necessity:** dependency installation is required; lockfile changes are rejected in this
task because no dependency selection has changed yet.

**Impact/Compatibility:** never read-write or start against `~/.t3/userdata`; worktree-local `.t3` is
the only test state.

**Steps:**

1. Run the Runtime Toolchain block and `pnpm install --frozen-lockfile`.
2. Run focused baseline tests:

   ```bash
   pnpm exec vp test run apps/desktop/src/backend/DesktopLocalEnvironmentAuth.test.ts
   pnpm exec vp test run apps/server/src/http.test.ts apps/server/src/auth/EnvironmentAuth.test.ts
   pnpm exec vp test run apps/server/src/provider/providerStatusCache.test.ts
   ```

3. Record command output in the workstream checkpoint if a baseline test already fails; do not edit
   behavior to make an unrelated upstream failure disappear.
4. Verify `git status --short` contains only planned documentation.
5. Commit only if installation legitimately updates repository-owned generated metadata; otherwise
   do not create an empty commit.

## Task 2: Make The Workspace Desktop-Only

**Files:** delete `apps/mobile/`, `apps/marketing/`, `infra/relay/`, `packages/ssh/`,
`packages/tailscale/`; modify `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `vite.config.ts`,
`.github/workflows/*`, `.github/ISSUE_TEMPLATE/*`, `scripts/release-smoke.ts`, mobile/Connect scripts,
and reference-repo configuration.

**Why:** removed products must leave the build graph and release artifacts, not merely disappear from
navigation.

**Change Necessity:** workspace and release metadata still build and publish forbidden products.

**Impact/Compatibility:** retain `apps/web` because it is the Electron renderer. Remove public Web
deployment/marketing behavior, not the renderer package.

**Steps:**

1. Remove workspace directories with `git rm -r` after confirming each path is tracked.
2. Remove root scripts for marketing, mobile screenshots/lint, shared development, and Connect
   announcements.
3. Remove CI jobs and release-smoke entries that reference deleted workspaces.
4. Regenerate only the pnpm lockfile with `pnpm install --lockfile-only`.
5. Verify no workspace graph reference remains:

   ```bash
   rg -n "apps/mobile|apps/marketing|infra/relay|packages/ssh|packages/tailscale|@t3tools/ssh|@t3tools/tailscale" \
     package.json pnpm-workspace.yaml pnpm-lock.yaml vite.config.ts scripts .github
   pnpm -r list --depth -1
   ```

   Expected: `rg` returns no active path/dependency reference; the workspace graph loads.

6. Run `pnpm exec vp run --filter @t3tools/desktop typecheck` only after Task 3 removes source-level
   imports; until then use lockfile/workspace validation as this task's gate.
7. Commit: `refactor: remove non-desktop workspaces`.

## Task 3: Collapse Electron To One Local Environment

**Files:** delete Desktop SSH, WSL, Tailscale endpoint, connection catalog, saved environment, server
exposure, and network-interface owners and tests under `apps/desktop/src/`; modify
`apps/desktop/src/main.ts`, `apps/desktop/src/app/DesktopApp.ts`, `apps/desktop/src/app/DesktopState.ts`,
`apps/desktop/src/backend/DesktopBackendConfiguration.ts`, `DesktopBackendManager.ts`,
`DesktopBackendPool.ts`, `apps/desktop/src/preload.ts`, `apps/desktop/src/ipc/*`, Electron menu/settings,
and `apps/desktop/package.json`.

**Why:** Electron must launch exactly one primary local backend and expose no environment management
or network-widening IPC.

**Change Necessity:** current Desktop composes SSH, WSL, saved environments, catalog mutation,
network interfaces, and configurable exposure into the primary process.

**Impact/Compatibility:** preserve local preview, window, updater, power monitoring, local auth,
backend restart, project filesystem, and terminal behavior.

**Steps:**

1. Replace `DesktopServerExposure` input in backend configuration with an immutable local value:
   host `127.0.0.1`, OS-assigned port, no Tailscale serve, no advertised non-loopback endpoint.
2. Simplify `DesktopBackendPool` to one primary backend or retire it if `DesktopBackendManager`
   already provides the required lifecycle.
3. Remove SSH, WSL, connection-catalog, server-exposure, and saved-environment IPC channels from
   contracts, handlers, preload, and `Window` typings in one change.
4. Remove settings/menu commands that create, select, expose, reconnect, or disconnect environments.
5. Delete the retired Desktop owner files only after callers are gone.
6. Add/retain tests proving the backend launch config always uses loopback and cannot encode
   Tailscale/SSH/WSL state.
7. Run:

   ```bash
   pnpm exec vp test run apps/desktop/src/backend/DesktopBackendConfiguration.test.ts \
     apps/desktop/src/backend/DesktopLocalEnvironmentAuth.test.ts \
     apps/desktop/src/backend/DesktopBackendManager.test.ts \
     apps/desktop/src/app/DesktopApp.test.ts
   pnpm exec vp run --filter @t3tools/desktop typecheck
   rg -n "DesktopSsh|DesktopWsl|tailscale|ServerExposure|ConnectionCatalog|SavedEnvironment" apps/desktop/src
   ```

   Expected: tests/typecheck pass and `rg` finds no active retired owner.

8. Commit: `refactor(desktop): keep one local environment`.

## Task 4: Restrict The Server To Authenticated Loopback

**Files:** `apps/server/src/config.ts`, `apps/server/src/cli/config.ts`, `apps/server/src/server.ts`,
`apps/server/src/http.ts`, `apps/server/src/bootstrap.ts`, `apps/server/src/bin.ts`, server auth/RPC
files and tests; delete `apps/server/src/cli/connect*`, `pair*`, remote `service*`, `cloud/`, relay
owners, Tailscale integration, hosted/public routes, and network exposure tests.

**Why:** removing UI does not prevent a CLI flag, environment variable, bootstrap payload, or relay
reactor from opening a remotely reachable listener.

**Change Necessity:** current config accepts arbitrary hosts, Tailscale Serve, relay links, pairing,
and public service modes.

**Impact/Compatibility:** retain scoped renderer/local-server authentication, one-time bootstrap,
browser session cookie, WebSocket ticket, RPC scope enforcement, and local dev proxy behavior.

**Repair Track:** make production `ServerConfig.host` a loopback literal supplied by the Desktop
launcher; reject non-loopback bootstrap values rather than normalizing them silently.

**Retirement Track:** delete remote CLI/routes/stores/scopes only after Desktop bootstrap and local
auth tests prove the retained path.

**Steps:**

1. Remove `--host`, `T3CODE_HOST`, Tailscale, relay, connect, pair, public service, and remote
   bootstrap configuration from the CLI/config schema.
2. Make packaged server start reject a non-loopback host and listen on `127.0.0.1` with an
   OS-assigned port.
3. Retain a dev-only loopback browser origin; reject wildcard/LAN origins.
4. Remove remote pairing-link creation, access-management, relay HTTP/RPC, cloud link reconciliation,
   and Tailscale lifecycle layers. Retain the minimum environment session machinery used by the
   Electron renderer.
5. Remove public CLI subcommands; keep only the internal Desktop service launcher and migration/test
   entry points.
6. Add package-level tests that `0.0.0.0`, LAN IPv4, Tailnet IPv4, and non-loopback IPv6 are rejected.
7. Run:

   ```bash
   pnpm exec vp test run apps/server/src/cli/config.test.ts apps/server/src/config.test.ts \
     apps/server/src/http.test.ts apps/server/src/auth/EnvironmentAuth.test.ts \
     apps/server/src/auth/RpcAuthorization.test.ts apps/server/src/bootstrap.test.ts
   pnpm exec vp run --filter t3 typecheck
   rg -n "0\.0\.0\.0|tailscale|connect link|pairing|relay|app\.t3\.codes" apps/server/src
   ```

   Expected: only explicit rejection tests or historical migration comments may match.

8. Commit: `refactor(server): enforce local-only runtime`.

## Task 5: Simplify Client Contracts To The Primary Environment

**Files:** `packages/contracts/src/server.ts`, auth/relay/environment contracts and exports;
`packages/client-runtime/src/connection/`, authorization, environment registry/state, relay state;
corresponding tests; `apps/web/src` connection and environment composition.

**Why:** stale remote target variants allow forbidden states to re-enter through persisted data,
URLs, or renderer actions.

**Change Necessity:** current shared runtime models primary, bearer, relay, and SSH targets and
mobile/hosted device authorization.

**Impact/Compatibility:** keep one platform-managed primary target and authenticated session. Existing
remote/saved environment records are ignored and removed by migration without contacting them.

**Steps:**

1. Reduce connection target and environment selection unions to the primary Desktop environment.
2. Remove relay, bearer pairing, SSH target, hosted pairing URL, device, and remote authorization
   exports and callers.
3. Add a client-state migration that discards remote targets while preserving local project/thread
   references that belong to the primary environment.
4. Remove access/relay scopes from renderer RPC contracts while retaining local orchestration,
   terminal, and review scopes.
5. Run targeted contract and client runtime tests for decoding old state, primary bootstrap, session
   refresh, and WebSocket reconnection.
6. Run:

   ```bash
   pnpm exec vp test run packages/contracts/src/server.test.ts \
     packages/client-runtime/src/connection packages/client-runtime/src/authorization
   pnpm exec vp run --filter @t3tools/contracts typecheck
   pnpm exec vp run --filter @t3tools/client-runtime typecheck
   rg -n "RelayConnectionTarget|SshConnectionTarget|BearerConnectionTarget|hostedPairing|deviceType: .mobile" \
     packages/contracts/src packages/client-runtime/src
   ```

7. Commit: `refactor: remove remote client contracts`.

## Task 6: Remove Remote And Multi-Environment Renderer UX

**Files:** delete hosted pairing, connections/network/access/device/relay/SSH UI and tests under
`apps/web/src`; modify app composition, sidebar, settings, command palette, onboarding, routes, and
desktop bridge types.

**Why:** non-technical employees should enter one local conversation without environment concepts.

**Change Necessity:** renderer still presents Connections, network access, pairing, environment
switching, remote errors, and provider maintenance.

**Impact/Compatibility:** preserve local connection status, recoverable backend restart, projects,
threads, composer, review, terminal, and preview.

**Steps:**

1. Remove routes and commands for pairing, connections, authorized clients, relay, network exposure,
   environment selection, SSH, WSL, and provider management.
2. Replace multi-environment selectors with the single primary environment projection.
3. Remove hosted/public startup branches and Clerk gates; renderer bootstrap always comes from
   Electron preload in production.
4. Keep a test-only local browser bootstrap for Vite development, guarded out of packaged builds.
5. Run focused app-shell, settings, sidebar, command-palette, and local connection tests.
6. Run:

   ```bash
   pnpm exec vp test run --project unit apps/web/src/components/Sidebar.logic.test.ts \
     apps/web/src/components/CommandPalette.logic.test.ts apps/web/src/app
   pnpm exec vp run --filter @t3tools/web typecheck
   rg -n "Pair|Connections|Relay|Tailscale|SSH|WSL|remote environment|network access|Clerk" apps/web/src
   ```

7. Commit: `refactor(web): remove remote environment UI`.

## Task 7: Apply FD Product Identity And Login

**Files:** create FD identity contracts under `packages/contracts/src/fd/`; create
`apps/desktop/src/fd-identity/`; modify Desktop preload/IPC/main/window; add login gate and employee
copy under `apps/web/src/fd/`; modify product/package/build metadata and assets.

**Why:** employees must use existing FD accounts and never see Clerk, provider credentials, or T3
identity.

**Change Necessity:** the current app authenticates T3 Cloud with Clerk and has no FD session owner.

**Impact/Compatibility:** port behavior from the existing FD Desktop but adapt it to T3's Electron
main and local server lifecycle. Identity supplies short-lived credentials and policy to the Codex
child; it does not own Codex sessions or the Agent loop.

**Steps:**

1. Add typed FD account state, login/logout, policy bootstrap, and credential-projection contracts.
2. Port `CredentialVault`, `NewApiHttpClient`, `NewApiClient`, and account state logic into the new
   `FdIdentityBroker`, preserving `safeStorage` AES-GCM wrapping.
3. Change managed Runtime Token creation to exact `deepseek-v4-flash`; validate status/model limit on
   every account bootstrap.
4. Add private main-to-server credential delivery that uses neither argv nor environment variables.
5. Revoke/delete the managed device token on logout; queue and visibly report remote revocation when
   offline while still clearing local interactive access.
6. Add the context-isolated login preload IPC and FD login gate. Renderer receives profile and status,
   never tokens.
7. Replace T3 name, icons, scheme, bundle IDs, window/menu copy, support links, and updater metadata
   with FD-owned values while preserving MIT notices.
8. Run FD identity unit tests, Desktop IPC tests, secure-storage corruption tests, login/logout tests,
   and bundle string scans for Clerk/T3 account endpoints.
9. Commit: `feat(desktop): add FD employee identity`.

## Task 8: Add The Transitional FD DeepSeek Runtime

**Files:** add `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts`,
`apps/server/src/provider/Layers/FdDeepSeekAdapter.ts`, `apps/server/src/fd-agent/*`; modify
`builtInDrivers.ts`, provider defaults/settings/contracts, package dependencies, text generation, and
tests; delete Codex/Claude/Cursor/Grok/OpenCode drivers and protocol packages after callers move.

**Why:** This completed task supplied a working DeepSeek path before the Codex App Server reuse
decision. It is now the migration fallback, not the permanent ordinary-runtime owner.

**Change Necessity:** historical implementation basis. The architecture amendment discovered that
T3's existing Codex runtime can own this behavior once FD compatibility is proven.

**Impact/Compatibility:** keep `ProviderAdapterShape` and `ProviderRuntimeEvent` stable for
orchestration. Employee UI has no provider/model/API-key settings.

**Steps:**

1. Pin exact `ai` and `@ai-sdk/openai` versions and create one FD New API Responses model client.
2. Implement the real protocol spike for exact `deepseek-v4-flash`: text, reasoning summary,
   multi-round tools, cancellation, usage, malformed tool input, 401, 403, 429, 5xx, and timeout.
3. Stop if the deployed endpoint cannot satisfy the spike; capture the wire-level incompatibility and
   amend only the adapter choice, never add a public/second-provider fallback.
4. Implement `FdAgentKernel` with bounded rounds, context budget, structured tools, approvals,
   cancellation, and typed results. AI SDK owns no persistence or checkpoint state.
5. Implement `FdDeepSeekAdapter` session lifecycle and exactly-once settlement mapping.
6. Register only `fd-deepseek`; hard-code/authorize only `deepseek-v4-flash` from FD policy.
7. Move title/branch/commit generation to the same FD model client.
8. Remove unrelated third-party driver files, provider CLI dependencies, `packages/effect-acp`,
   install/update status logic, and provider settings UI. The prior removal of
   `packages/effect-codex-app-server` is superseded by Task 11A's selective restore.
9. Run adapter, ingestion, decider-settlement, checkpoint, cancellation, approval, and dependency
   graph tests.
10. Commit: `feat(server): add FD DeepSeek agent`.

## Task 9: Add Native Skills Without Permission Bypass

**Files:** add `apps/server/src/fd-skills/NativeSkillCatalog.ts`, parser/watcher tests, tool-context
integration, Skill presentation updates in Web, and policy fields in FD contracts.

**Why:** standard local `SKILL.md` packages remain useful for project and office workflows.

**Change Necessity:** removed provider CLIs previously discovered Skills; the FD driver needs a local
catalog independent of Codex/Claude.

**Impact/Compatibility:** support `.agents/skills` and compatibility `.codex/skills` roots. Never
auto-approve Skill scripts or tools.

**Steps:**

1. Parse bounded YAML frontmatter and expose name, description, root, references, scripts, assets,
   source scope, and diagnostics.
2. Resolve real paths and reject symlink escapes, oversized files, malformed frontmatter, duplicate
   identity, and inaccessible roots.
3. Apply precedence: project over user, canonical `.agents` over same-scope `.codex` compatibility.
4. Add managed-policy disablement and hide local Skills colliding with an FD-managed identity.
5. Load full Skill content only for a selected turn; selection never grants tools or approvals.
6. Add tests using all four original ZIP `SKILL.md` files as parser/parity fixtures while ensuring the
   database package cannot expose local database tools.
7. Commit: `feat: add local Agent Skills`.

## Task 10: Route FD Skills To Enterprise Agent

**Files:** add `apps/server/src/fd-skills/FdSkillCatalog.ts`,
`FdEnterpriseAgentClient.ts`, enterprise event projection tests, typed turn context, and Desktop
history restoration; reuse FD API schemas from the adjacent project through copied/adapted owned
contracts, not cross-repository imports.

**Why:** FD Skills need autonomous server-side tools, View grants, encrypted history, and audit while
appearing in the same conversation timeline.

**Change Necessity:** local prompt injection and local SQL execution cannot reproduce the FD trust and
audit boundary.

**Impact/Compatibility:** preserve `/api/fd-skills/self`, `/api/agent/turns`, and Desktop history API.
Send one version ID, stable client thread ID, idempotency key, model, token ID, and access token.

**Steps:**

1. Fetch permission-filtered FD Skill summaries and model capability policy after login.
2. Store display metadata/version/source only; never persist full instructions or View policy.
3. Add typed per-conversation FD Skill selection with explicit clear and unconditional reset on new
   conversation.
4. Route selected FD Skill turns to Enterprise Agent before model execution. Greetings/capability
   questions are valid zero-tool turns; data conclusions require server auditable completion.
5. Project SSE started/status/reasoning/tool/delta/completed/failed events into one T3 turn and one
   assistant stream. Validate IDs and ignore late events after settlement.
6. Restore server-authoritative enterprise history in memory by stable Desktop thread ID.
7. Add parity tests for authorized and denied Views, `蔡梦晨`, `蔡梦辰`, zero rows, typo handling,
   audit IDs, revocation, stale version, duplicate SSE final, stale running state, and new-chat reset.
8. Commit: `feat: integrate managed FD Skills`.

## Task 11: Make The Default UX Employee-First

**Files:** Desktop environment/backend configuration and focused startup tests; server startup
bootstrap and local Agent tool-policy tests; app shell, composer, sidebar/history, project-mode
state, settings, error copy, activity/tool cards, and responsive tests/screenshots under
`apps/web/src`.

**Why:** the T3 developer-first project/provider workflow is too technical for ordinary employees.

**Change Necessity:** hiding remote/provider settings still leaves a project-first coding UI and
technical status vocabulary.

**Impact/Compatibility:** advanced local project mode retains file tree, terminal, Git, Diff,
checkpoints, and approvals. Default task mode starts with a blank chat and no selected workspace.
On first send, the server creates a persistent task directory below
`~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss` and binds the conversation to it. Internally task directories
reuse the existing project/thread contract with typed `projectPurpose = "task"`; user-opened
projects use `projectPurpose = "workspace"`. Existing events and rows decode as `workspace`. The
legacy hidden office project remains readable for compatibility and draft staging but never receives
new turns. Task projects appear through their threads in Tasks and never in the Workspaces list.

**Steps:**

1. Add typed project purpose across contracts, events, projections, SQLite migration, client models,
   and shell streaming. Default missing legacy values to `workspace`; create explicit `task` projects
   only through the server-owned first-send bootstrap.
2. Pass the canonical Desktop task root `~/FangdeAI/Tasks` to the server without creating per-task
   directories at app startup. On a no-workspace first send, create a collision-safe timestamp
   directory and task project, then create and start the thread. If bootstrap fails, delete the new
   project and remove the still-empty directory. Keep the legacy office project only as a hidden
   draft placeholder and compatibility owner.
3. Open directly to a blank no-workspace draft after login. Lock a real workspace or generated task
   directory after first send; changing context starts a new task.
4. Add one `业务能力` picker with FD and local sections, source badges, selection/clear state, loading,
   empty, revoked, and error states.
5. Treat task projects and the hidden draft placeholder as office mode. Enforce the restricted
   file/command/Git tool
   policy at the local Agent owner, then suppress file tree, terminal, Git, Diff, checkpoint,
   branch, and advanced approval controls in Web. Opening an employee-selected local directory
   enters project mode and preserves the existing advanced workbench.
6. Remove Provider, Runtime, API key, Base URL, MCP, Responses API, and model protocol vocabulary from
   employee surfaces.
7. Render concise auditable status summaries, never hidden chain-of-thought.
8. Ensure one assistant response, terminal tool cards, and monotonic completed/failed/interrupted UI.
9. Verify contracts/server/client-runtime/Desktop/Web focused tests, affected typechecks, build, and
   `git diff --check`. Verify task directory creation, collision handling, persistence, project list
   filtering, legacy decode compatibility, bootstrap cleanup, and workspace locking.
10. Verify desktop and compact laptop viewports with Playwright screenshots; check no overlap,
    truncation, stale spinner, or dynamic layout shift.
11. Commit: `feat: add persistent task workspaces`.

## Task 11A: Restore Codex App Server As The Ordinary Runtime

**Files:** selectively restore `packages/effect-codex-app-server/` and the Codex runtime files under
`apps/server/src/provider/`; add the FD-managed Codex home/launch policy and focused tests under
`apps/server/src/fd-codex/`; modify `FdDeepSeekDriver`, the FD adapter/router, server dependencies,
and the lockfile; update architecture/checkpoint/evidence artifacts.

**Why:** T3 already has a mature Codex App Server implementation for sessions, tools, approvals,
cancellation, compaction, resume, usage, and event projection. Keeping `FdAgentKernel` as the
permanent ordinary owner duplicates that implementation and leaves FD with a weaker custom kernel.

**Change Necessity:** documentation alone cannot connect FD credentials and model policy to the
existing Codex child process or enforce one execution owner per conversation. The minimum source
boundary is the previously removed Codex runtime, an FD-specific managed-home/credential wrapper,
and the existing FD routing adapter.

**Impact/Compatibility:** retain the hidden `fd-deepseek` instance and current T3
`ProviderAdapterShape` / `ProviderRuntimeEvent` contracts. The renderer still receives no provider
configuration or credentials. Enterprise Skill instructions, authorization, audit, tools, and
history remain server-owned. Do not restore Claude, Cursor, Grok, OpenCode, ACP, provider settings,
maintenance/installers, updater behavior, or employee Codex accounts.

**Repair Track:** the duplicated ordinary Agent loop is the root architecture problem. Reuse T3's
Codex session/runtime owner, bind exact FD New API configuration around it, and route ordinary/local
conversations there while retaining the enterprise adapter for FD Skill conversations.

**Retirement Track:** keep `FdAgentKernel`, `FdResponsesClient`, `FdDeepSeekTextGeneration`, and
their AI SDK dependencies until the compatibility gate passes. After all ordinary callers and text
generation move, remove them in the same migration commit or a directly following reviewed commit.

**Steps:**

1. Restore only the version-compatible Codex protocol package, adapter, session runtime, developer
   instructions, launch arguments, and their focused fixtures from the parent of Task 8. Do not
   restore provider catalog/settings/maintenance or unrelated providers.
2. Add an FD-managed `CODEX_HOME` writer that pins `model = "deepseek-v4-flash"`, custom provider
   `fd_new_api`, sanitized New API `/v1`, `env_key = "FD_NEW_API_KEY"`, Responses wire API, and the
   server-enforced approval/sandbox profile. The file must contain no secret.
3. Build the Codex child environment from a strict allowlist plus the in-memory Runtime Token. Pass
   credentials only in the child environment; reject invalid keys/values and drain, bound, or redact
   stderr without renderer projection.
4. Add a compatibility harness that uses the restored T3 adapter and proves text, reasoning, tool
   start/progress/completion, approval, structured user input, usage, cancellation, terminal
   settlement, and session resume/restart projection. Include a skipped-by-default live test for the
   exact FD endpoint and `deepseek-v4-flash`.
5. Prove local Skill discovery and selected Skill execution through Codex without making the local
   catalog an authorization owner. Project-local Skill instructions remain cwd-scoped; FD-managed
   Skill instructions never enter Codex.
6. Lock each conversation to `codex-local` or `enterprise-remote` on its first turn. Reject a later
   turn that requests the other owner and require a new conversation instead.
7. On login generation change, token rotation, logout, disablement, or revocation, stop all Codex and
   enterprise sessions, clear volatile enterprise state, regenerate the child environment, and
   resume only under the current identity.
8. Run the restored protocol/stdio/client tests, managed-home and child-environment tests, Codex
   adapter/session tests, FD routing/credential tests, orchestration ingestion/settlement tests, and
   Server/contracts/client-runtime typechecks. Run the live FD test only when
   `FD_RUN_REAL_APP_SERVER=1`, `FD_CODEX_BINARY`, and `FD_NEW_API_KEY` are supplied.
9. Inspect the managed home, test event store, logs, process arguments, and renderer payload fixtures
   for secret markers. Record exact compatibility evidence and keep Task 12 paused if any required
   projection or resume behavior is unproven.
10. After the gate passes, switch ordinary and local-Skill calls to Codex, move text generation,
    remove the transitional kernel/client and AI SDK dependencies, rerun the focused gate, and
    commit `refactor(server): restore Codex agent runtime`.

## Task 12: Protect Local Content And Release Safely

**Files:** persistence migrations/encrypted payload codec, Electron key bridge, retention service,
export path, updater/release policy, packaging config, operations/user/internals docs.

**Why:** employee conversations, filenames, and local tool content can be sensitive even when no
database credential is stored.

**Change Necessity:** current T3 event payloads are plaintext and updater/branding target upstream.

**Impact/Compatibility:** keep searchable non-sensitive metadata; do not create plaintext message
indexes. Enterprise message content stays server-authoritative.

**Steps:**

1. Add a versioned encrypted event-content envelope with AES-256-GCM and authenticated metadata.
2. Wrap per-user keys through Electron `safeStorage`; define rotation, lock, corruption, backup,
   migration, and deletion behavior.
3. Migrate existing FD local content only after backup and verification; do not auto-import T3 Cloud
   or Codex session content.
4. Add retention cleanup for decrypted temp files and attachment workspaces.
5. Connect updater to FD release metadata and block upstream update endpoints.
6. Add redacted rotating diagnostics and keep crash reporting off until approved.
7. Add macOS/Windows signing and rollback runbooks without embedding credentials.
8. Verify SQLite/file inspection contains no known plaintext test markers or credentials.
9. Commit: `feat: protect FD desktop data`.

## Task 13: Final Verification, Documentation, And Delivery

**Files:** focused acceptance tests, docs, changelog/version/release artifacts only.

**Why:** broad completion claims require direct evidence against every explicit requirement.

**Steps:**

1. Run focused package typechecks and tests for changed packages; do not run prohibited repo-wide
   checks unless explicitly requested.
2. Build Desktop and inspect production dependency graph/bundle strings for deleted packages,
   endpoints, provider names, Clerk, relay, Tailscale, SSH, mobile, and public model URLs.
3. Launch the packaged app, capture its PID and socket, and prove the listener is loopback-only. From
   a LAN peer, verify connection refusal.
4. Verify login, refresh, offline, disabled user, logout, token revocation, secure-storage failure, and
   clean restart with real FD New API.
5. Verify real `deepseek-v4-flash` ordinary chat, local Skill, project edit, terminal approval,
   cancellation, Diff, checkpoint, restart, and exactly-once settlement.
6. Verify all four original ZIP Skills and all 11 View grants against Web-admin group policy. Run the
   holdings and typo/zero-row scenarios with real audit evidence.
7. Benchmark cold start, first usable chat, idle memory, streaming, long thread, large Diff, and
   project switching against unmodified T3 baseline.
8. Verify macOS and Windows signed packages, update, failed-update rollback, encrypted-state
   preservation, and minimum-version policy.
9. Update `docs/user`, `docs/internals`, `docs/operations`, Aegis baseline/ADR, VERSION, and CHANGELOG
   to match only proven behavior.
10. Run pre-landing review, fix findings, commit, push FD branch, merge to the FD main branch, deploy
    supporting FD Web/New API changes if any, and repeat production canary acceptance.
11. Remove obsolete worktrees only after merged commit and deployment evidence identify them as
    unused.

## Verification Matrix

| Requirement                   | Authoritative evidence                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| Desktop-only                  | workspace graph, deleted paths, packaged bundle inspection       |
| Local-only                    | captured process socket bound to loopback; LAN refusal           |
| Authenticated renderer/server | bootstrap/session/WebSocket/RPC tests and packaged login         |
| FD identity                   | real login/refresh/logout/revocation and safe-storage inspection |
| Flash-only DeepSeek           | server policy, dependency scan, real runtime requests            |
| No third-party Provider       | driver registry, lockfile/bundle scan, absent UI                 |
| Native Skills                 | parser/security tests and real selected-Skill turn               |
| FD Skills                     | real Enterprise Agent SSE, audit, history, View grants           |
| ZIP parity                    | four-Skill fixtures, field dictionary diff, query scenarios      |
| No duplicate/stale UI         | event/decider tests and Playwright timeline observation          |
| Web-only admin                | absent Desktop mutation UI; FD Workspace policy mutation tests   |
| Data protection               | ciphertext inspection, key lock/rotation/migration tests         |
| Employee usability            | first-launch and office/project mode screenshots/workflow timing |
| Release safety                | signed packages, updater, rollback, production canary            |

## Risks And Rollback

- The local-only retirement has a large compile ripple. Keep commits ordered by caller removal and
  never retain permanent feature flags as a fallback.
- AI SDK Responses compatibility with deployed DeepSeek is a hard runtime spike. Failure pauses the
  provider task, not the already-valid local-only/identity work.
- Enterprise history and T3 event sourcing have different persistence owners. Only references and
  lifecycle metadata may cross the boundary durably.
- Encryption changes event projection and migration. Back up and verify before destructive schema
  changes; retain rollback binaries until migration acceptance.
- Upstream T3 merges become manual after major retirement. Keep FD boundaries narrow and rerun bundle
  and socket checks on every sync.

## Retirement Completion Rules

A retired surface is complete only when all of these are true:

1. Its source owner and tests are deleted or rewritten for the FD owner.
2. No active import, contract variant, route, IPC channel, persisted setting, CLI flag, environment
   variable, package dependency, script, CI job, documentation, or bundle string can recreate it.
3. A focused inverse test proves the forbidden path is rejected or absent.
4. The retained local path has positive runtime evidence.

Do not mark the workstream complete from a clean `rg` alone.
