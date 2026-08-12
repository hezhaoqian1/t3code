# FD Enterprise Skills Through Codex App Server - Checkpoint

- Current todo: complete. Desktop FD Skills now execute through the local Codex App Server while New API remains the authorization, Connector, masking, and audit owner.
- Completed slices: Gateway runtime projection and tool-call APIs; Desktop Codex runtime and dynamic-tool bridge; business-capability picker; ordinary local Skill preservation; live Desktop acceptance; restart/history recovery; regression checks.
- Compatibility boundary: Web `/api/agent/turns`, the Web Enterprise Agent runtime, and management APIs were not changed. The new Gateway routes are additive and Desktop-only.
- Runtime owner: a selected managed FD Skill is projected into one Codex App Server session. Each dynamic tool call returns to New API for fresh authorization and audited execution. No local database credential or Connector secret is projected to Desktop.
- Live acceptance: four representative business questions completed in the real Fangde AI Desktop with seven successful audit rows for QA user `34` and Skill version `4`.
- Persistence: the accepted task survived an application close/relaunch and reopened with the complete answer and audit metadata. Its task directory remains at `/Users/windupbird/FangdeAI/Tasks/2026-08-12-00-21-41`.
- Verification: focused Gateway, Server, Desktop, Web, contracts, and Codex protocol tests passed; TypeScript typechecks and Server/Web production builds passed; both worktrees pass `git diff --check`.
- Known unrelated baseline issue: the broader Gateway model suite still fails `TestDeletedWorkspaceAgentClientThreadBindingCanBeRecreated` because its SQLite fixture lacks `workspace_message_feedbacks`. The new Desktop tests pass independently.
- Known test boundary: the external/live App Server integration test remains skipped; the equivalent flow was covered by real Desktop acceptance against the running local App Server.
- Evidence: see `90-evidence.md` and `screenshots/`.

## DriftCheckDraft

- Scope: aligned.
- Compatibility: Web `/api/agent/turns` and management APIs unchanged.
- Retirement: Desktop managed FD Skills no longer use the transitional local model loop; ordinary conversations and local Skills use Codex App Server.
- New owner/fallback: New API is the single enterprise authorization/execution owner; no direct-database or credential fallback was added.
- Evidence status: implementation, protocol, authorization, audit, GUI, restart, regression, typecheck, and build evidence present.
- Decision: ready for handoff with the unrelated Gateway fixture failure disclosed.
