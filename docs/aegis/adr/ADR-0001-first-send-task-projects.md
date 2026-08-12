# ADR-0001 - Use first-send typed projects for no-workspace tasks

Status: `recorded-from-work`
Date: `2026-08-11`

## Source Evidence

- Implemented Task 11 task-directory amendment in contracts, Desktop bootstrap, Server orchestration, and Web task drafts.
- Focused filesystem and Web regressions, five package typechecks, production build, migration inspection, and live Desktop startup passed.

## Context

A shared hidden office project was useful as a renderer draft placeholder but was the wrong execution workspace: unrelated employee tasks shared files, and creating a directory on New Task produced empty persistent folders. No-workspace tasks need isolation without making orchestration threads project-optional.

## Decision

Keep the hidden office project only as a pre-send draft staging identity. On first send, the Server creates a timestamp directory under ~/FangdeAI/Tasks, creates a project with projectPurpose=task, binds the new thread to that project, and cleans up failed bootstrap state while the directory remains empty. User-opened projects retain projectPurpose=workspace.

## Alternatives Considered

- Continue using one shared hidden office project for every no-workspace task; rejected because files and cwd leak across unrelated tasks.
- Make orchestration threads project-optional; rejected because it expands event, projection, runtime, and tool contracts without providing a filesystem boundary.
- Create the task directory when the user clicks New Task; rejected because abandoned drafts would leave empty persistent directories.

## Consequences

- Every sent no-workspace task receives an isolated persistent cwd and retains generated files after the task ends.
- Task projects accumulate as durable internal project rows but are excluded from workspace pickers by typed purpose.
- The first-send bootstrap owns a small cross-owner transaction and cleanup path across project, thread, and filesystem state.

## Compatibility Boundary

Events and projection rows without projectPurpose decode and migrate as workspace. Existing user projects and conversations remain addressable. The hidden office project remains available only for compatibility and draft staging. Codex App Server, FD identity, and Enterprise Agent ownership do not change.

## Retirement Impact

Retire the hidden office project as an execution cwd for new turns. Retain its startup bootstrap and identity until the Web draft model no longer requires a project-backed staging reference; that future removal must migrate persisted unsent drafts.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-08-09-initial-baseline.md
- Action: update baseline
- Reason: The decision adds projectPurpose to the durable project contract and changes the canonical filesystem owner and creation point for no-workspace tasks.

## Evidence References

- docs/aegis/work/2026-08-09-fd-ai-desktop/20-checkpoint.md#task-11-task-directory-implementation-checkpoint
- docs/aegis/work/2026-08-09-fd-ai-desktop/90-evidence.md#task-11-task-directory-amendment

## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
