# FD Enterprise Local History

## Goal

Persist user-visible user and assistant messages from FD Skill turns in T3's existing local event
store so a Desktop restart or transient enterprise-history outage does not make completed history
disappear.

## Architecture

Reuse `thread.message-sent` and `projection_thread_messages`. FD New API remains authoritative for
Skill authorization, tools, audit, and the server-side enterprise copy. Provider reasoning, tool
arguments/results, audit IDs, and policy remain `memory-only`. Remote history remains a repair source
for older and interrupted threads and is reconciled against durable local messages.

## Tech Stack

TypeScript, Effect, T3 orchestration event store, SQLite projections, Vitest/Vite+.

## Baseline/Authority Refs

- `docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md`
- `docs/aegis/baseline/2026-08-09-initial-baseline.md`
- `AGENTS.md`

## Compatibility Boundary

- Keep the authenticated loopback Desktop boundary unchanged.
- Persist only text already rendered as a user or assistant message.
- Never persist enterprise reasoning, tool cards/payloads, audit identifiers, credentials, or policy.
- Existing remote-only histories restore from FD New API and are backfilled into local messages.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Reason: focused regressions are required; strict TDD was not requested.
- Verification: focused decider, ingestion, runtime, logger tests, and server typecheck.

## Requirement Ready Check

- Requirement source refs: user-approved local-first reuse of T3/Codex history behavior.
- Goals and scope refs: persist visible FD Skill user/assistant conversation locally and test it.
- User / scenario refs: employee restarts Desktop or temporarily loses the history API.
- Requirement item refs: local persistence, restart visibility, remote repair, sensitive exclusion.
- Acceptance / verification criteria refs: focused commands below.
- Open blocker questions: none.
- Decision: ready.

## Change Necessity

- User-visible need: completed history must survive process and network changes.
- No-change / non-code option: guidance cannot recover content never written locally.
- Why code change is necessary: FD Skill messages are explicitly excluded from persisted events.
- Minimum change boundary: decider, enterprise runtime reconciliation, ingestion, tests, docs.
- Decision: code-change.

## Architecture Integrity Lens

- Invariant: T3's event store and projection pipeline remain the only local durable message owner.
- Canonical owner / contract: `OrchestrationEngine` and `thread.message-sent`.
- Responsibility overlap: remote history is repair/sync input, not a second Desktop view owner.
- Higher-level simplification: reuse current commands instead of adding an enterprise history table.
- Retirement / falsifier: retire overlay-only completed text; retain overlay streaming/tool activity.
- Verdict: reuse existing owner.

## Tasks

### Task 1: Persist FD Skill user messages

**Files:** `apps/server/src/orchestration/decider.ts` and focused tests.

Emit the existing user `thread.message-sent` event for FD Skill turns and preserve turn-start
causation. Verify with:

```sh
vp test run apps/server/src/orchestration/decider.projectScripts.test.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
```

### Task 2: Persist authoritative FD Skill assistant completions

**Files:** `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`,
`apps/server/src/fd-skills/FdEnterpriseThreadRuntime.ts`, and focused tests.

After applying an enterprise memory-only event to the live overlay, translate only an authoritative
assistant completion with `finalText` into existing assistant message commands. Reuse the stable
enterprise history message ID when available. Provider NDJSON remains memory-only.

### Task 3: Reconcile remote repair history

**Files:** `apps/server/src/fd-skills/FdEnterpriseThreadRuntime.ts`, `apps/server/src/ws.ts`, tests.

Supply durable messages while loading remote history, backfill missing visible messages through an
idempotent internal command, and filter an equivalent role/text multiset before publishing the
volatile snapshot.

### Task 4: Align docs and verify

**Files:** `docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md`.

```sh
vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts \
  apps/server/src/fd-skills/FdEnterpriseThreadRuntime.test.ts \
  apps/server/src/provider/Layers/EventNdjsonLogger.test.ts
vp run --filter t3 typecheck
git diff --check
```

## Risks

- Duplicate remote/local messages: reconcile by stable ID and bounded role/text multiplicity.
- Tool data leakage: keep all provider frames memory-only and assert audit/tool strings are absent.
- Partial turn: commit user text before provider execution; commit final assistant text independently.

## Retirement

The enterprise overlay remains only for streaming deltas, reasoning display, tool activity, and
remote compatibility recovery. It is no longer the durable owner of completed visible text.
