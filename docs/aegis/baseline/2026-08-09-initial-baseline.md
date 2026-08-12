# FD AI Desktop Initial Baseline

Date: `2026-08-09`

Status: `initial dual-baseline snapshot`

## 1. Purpose

This baseline separates the current T3 Code behavior from the requested FD AI target so later work
can distinguish intended redesign from accidental drift.

## 2. Workspace Structure

- `apps/server`: event-sourced orchestration, provider adapters, local filesystem, terminal, and Git.
- `apps/web`: React client used by both browser development and the Electron renderer.
- `apps/desktop`: Electron host, bundled server launcher, updater, and desktop integrations.
- `apps/mobile`: Expo/React Native remote client targeted for retirement.
- `infra/relay`: T3 Connect hosted relay targeted for retirement.
- `packages/contracts`: typed client/server and provider contracts.
- `packages/client-runtime`: shared connection, environment, relay, and client state.
- `packages/ssh`: remote environment launcher targeted for retirement.
- `packages/tailscale`: Tailscale endpoint integration targeted for retirement.

## 3. Current Authority Surfaces

- Repository behavior and contribution rules: `AGENTS.md`.
- Current architecture: `docs/internals/overview.md`.
- Current provider SPI: `docs/internals/providers.md` and
  `apps/server/src/provider/ProviderDriver.ts`.
- Current remote architecture: `docs/internals/remote.md` and
  `docs/internals/environment-auth.md`.
- External FD authority: the adjacent FD Gateway repository, especially
  `docs/architecture/fd-skills-enterprise-agent-runtime.md`, the New API account APIs, FD Skill
  catalog APIs, `/api/agent/turns`, and FD Tool Gateway policy enforcement.

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- T3 Code is currently a multi-provider coding-agent control surface.
- It supports Codex, Claude, Cursor, Grok, and OpenCode through provider-specific runtimes.
- It exposes desktop, web, mobile, direct remote, relay, Tailscale, and SSH surfaces.
- T3 Cloud and managed relay paths depend on Clerk.
- It assumes a developer-oriented project-first workflow.

### 4.2 Confirmed FD Target

- Rebrand the product as FD AI Desktop.
- Make non-technical employees the default audience.
- Use the existing FD account system and Web administration only.
- Expose only company-managed DeepSeek models through New API.
- Support server-managed FD Skills and standard local Agent Skills.
- Treat each sent no-workspace task as an isolated persistent task area created on first send under
  `~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss`.
- Keep local projects, files, terminal, Git, Diff, checkpoints, and approvals as an optional advanced
  project mode.
- Remove mobile, T3 Connect, SSH, Tailscale, remote pairing, public sharing, and network-reachable
  environments from the FD product.
- Run the desktop server on the local machine and bind it to loopback only.

### 4.3 Non-negotiables

1. Desktop never receives database credentials or the authoritative View policy.
2. FD Tool Gateway remains the final authorization and audit boundary.
3. Original FD Skill field definitions, business semantics, and query rules do not drift.
4. A new conversation does not inherit an FD Skill selection.
5. Employee UI does not expose Provider, API key, Base URL, MCP, runtime, or model protocol setup.
6. The UI shows auditable progress, not hidden chain-of-thought.
7. A completed turn cannot remain visually running or emit duplicate assistant answers.

### 4.4 Product Non-goals

- Maintaining compatibility with T3 Cloud accounts or subscriptions.
- Shipping a public hosted T3-compatible web client.
- Mobile control, remote servers, SSH workspaces, or Tailscale environments.
- Allowing employees to add arbitrary model providers or credentials.
- Replacing the existing FD Web administrator experience.

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- T3 orchestration owns durable thread events and projections.
- Provider drivers own model-runtime sessions and normalize native events into
  `ProviderRuntimeEvent`.
- Clients use typed Effect RPC over an authenticated WebSocket.
- Provider CLIs currently execute the agent loop and local tools.

### 5.2 FD Target Boundary

- T3 orchestration remains canonical for local task state, checkpoints, terminal, Git, and Diff.
- Desktop owns the task-root policy, Server owns first-send task directory/project/thread bootstrap,
  and Web owns the unsent task draft and task/workspace presentation.
- Durable projects use `projectPurpose = "workspace" | "task"`; missing legacy values resolve to
  `workspace`, and typed task projects do not appear in workspace pickers.
- The employee sees one hidden FD provider route and no provider/account configuration.
- T3's existing Codex App Server runtime owns ordinary, project, and local-Skill Agent execution
  against exact FD New API `deepseek-v4-flash` after compatibility proof.
- The existing FD Enterprise Agent remains canonical for selected FD Skill turns.
- Each conversation binds exactly one execution owner. Changing owner creates a new conversation;
  no transparent mid-conversation handoff is allowed.
- The Codex adapter and FD enterprise adapter normalize their respective paths into the same T3
  runtime event contract.
- New API owns employee identity, model access, quota, and model routing policy.
- FD Web owns all administrative mutation.

`FdAgentKernel`, `FdResponsesClient`, and their AI SDK dependencies describe the implemented
transitional state at commit `36316ed6`, not the amended target. They remain until a bounded
compatibility spike proves credentials, local Skills, event projection, approvals, cancellation,
exactly-once settlement, and restart/resume on the Codex path.

### 5.3 Architecture Non-negotiables

1. Employee identity and local renderer-to-server authentication remain separate concerns.
2. Removing remote pairing must not leave the loopback WebSocket unauthenticated.
3. Business permission decisions are never trusted solely to Desktop state.
4. FD-specific behavior stays behind explicit identity, policy, provider, and skill boundaries.
5. Upstream T3 changes are imported deliberately; FD behavior must not be scattered through unrelated
   provider adapters.

## 6. Current Risks

- Codex App Server compatibility with FD New API and exact `deepseek-v4-flash` must be proven without
  persisting credentials in Codex auth/config/session files or projecting them to logs/renderer.
- Selective restoration must not reintroduce Claude, Cursor, Grok, OpenCode, ACP, provider settings,
  installer/update behavior, or employee-visible Codex accounts.
- Remote and multi-surface assumptions span contracts, server, client runtime, Desktop, CI, and docs.
- Clerk is used by both cloud identity and relay behavior; replacement must avoid removing unrelated
  local process authentication.
- T3 SQLite currently persists conversational events and requires an FD at-rest data decision.
- Removing providers and remote packages creates substantial upstream merge pressure.

## 7. Compatibility Boundary

- Existing FD server APIs and encrypted Enterprise Agent history remain compatible.
- The hidden office project is retained only as a compatibility and pre-send draft staging identity;
  it does not receive new no-workspace turns. See
  `docs/aegis/adr/ADR-0001-first-send-task-projects.md`.
- Existing T3 local data is not promised to migrate until a migration plan is implemented and tested.
- T3 remote, mobile, relay, and third-party provider compatibility is intentionally retired.
