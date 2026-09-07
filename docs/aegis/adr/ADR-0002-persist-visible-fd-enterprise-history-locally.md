# ADR-0002 - Persist visible FD Enterprise history locally

Status: `recorded-from-work`
Date: `2026-09-07`

## Context

FD Skill conversations previously kept all message content in a process-local overlay and rebuilt
the view from the Enterprise Agent history endpoint. A restart combined with an unavailable or
failed history request therefore made completed conversations appear to disappear, despite ordinary
T3 conversations already using the local orchestration event store and SQLite projections.

## Decision

Persist employee-visible FD Skill user text and authoritative final assistant text through T3's
existing `thread.message-sent` event and `projection_thread_messages` projection. Keep streaming
deltas, reasoning, tool arguments/results, audit identifiers, policy, and credentials memory-only.
Retain the Enterprise Agent history endpoint as the compatibility and recovery source for older and
interrupted turns. Import recovered visible messages through the same local message owner, then
reconcile by stable ID or bounded role/text multiplicity before presenting the overlay.

## Alternatives Considered

- Keep all Enterprise content memory-only; rejected because availability of local history would
  continue to depend on authentication, network, and the history endpoint after every restart.
- Add an FD-specific local history table; rejected because it would duplicate T3's existing durable
  message owner and projection behavior.
- Persist raw provider events; rejected because those events can include reasoning, tool payloads,
  audit details, and other data outside the employee-visible conversation boundary.

## Consequences

- New completed FD Skill conversations survive Desktop restarts and transient history outages.
- Existing T3 event ordering, projection, and thread snapshot behavior remain the durable owner.
- The local SQLite database now contains employee-visible enterprise prompt and answer text and must
  be protected according to the Desktop host's local-data policy.
- Remote/local reconciliation is required to avoid duplicate messages after history recovery.

## Compatibility Boundary

Enterprise authorization, tool execution, audit, permissions, and the server-side history copy do
not move to Desktop. Existing remote-only histories still load through the current endpoint. No new
database schema or public RPC contract is introduced.

## Baseline Sync

- Needed: yes
- Target: `docs/aegis/baseline/2026-08-09-initial-baseline.md`
- Action: update baseline
- Reason: the decision changes the accepted local persistence boundary for FD Skill message text.

## Evidence References

- `docs/aegis/work/2026-09-07-fd-enterprise-local-history/90-evidence.md`
- `docs/aegis/plans/2026-09-07-fd-enterprise-local-history.md`

## Boundary

This ADR records the implemented architecture decision. It does not replace runtime verification or
grant release authority.
