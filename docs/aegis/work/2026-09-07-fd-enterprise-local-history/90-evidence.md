# FD Enterprise Local History - Evidence

## Implementation Evidence

- FD Skill turn start now emits the same durable user `thread.message-sent` event as ordinary T3
  turns and preserves event causation.
- Enterprise runtime ingestion translates only a final assistant completion into one atomic
  assistant-complete command carrying the final text; all raw provider frames remain memory-only.
- Initial remote history snapshots are reconciled against durable messages by exact stable ID and a
  role/text multiset, including repeated prompts and interrupted-turn recovery.
- Missing remote-only visible history is imported through an idempotent internal message command so
  a successful recovery remains available on the next offline restart.
- Failed durable-history reads do not trigger blind imports, and restored historical messages are
  marked so they cannot create a false pre-turn checkpoint or move thread activity time backward.
- The design baseline and ADR explicitly retain enterprise authorization, tools, audit, policy, and
  credentials outside the local durable message boundary.

## Verification Commands

- Focused tests covering the Enterprise runtime, checkpoint and command reactors, orchestration
  engine, ingestion paths, decider, and contracts passed: 10 files, 211 tests.
- `vp run --filter t3 typecheck` and `vp run --filter @t3tools/contracts typecheck` exited 0.
- Focused source lint and changed-file formatting checks passed. A broader touched-test lint also
  reported ten pre-existing `no-manual-effect-runtime-in-tests` violations outside this diff.
- `git diff --check` passed.

## Covered Risk

- Durable user and final assistant projection.
- Stable-ID and fallback role/text deduplication.
- Repeated identical prompts without over-deduplication.
- Interrupted local user turn with a remotely recovered assistant.
- Concurrent live completion/history restore without losing the assistant turn association.
- Enterprise overlay reset without losing the durable final assistant message.
- Historical restore without pre-turn checkpoint side effects.
- Rejection of non-visible roles and completions without authoritative final text.
- Exclusion of tool/audit details from durable provider events.

## Uncovered Risk

- No packaged Desktop close/relaunch acceptance was run in this worktree.
- Existing remote-only conversations still require one successful history endpoint load for display.
- Local at-rest encryption and multi-account partitioning were not added by this change.
