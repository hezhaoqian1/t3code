# FD Context Regression Investigation

Status: implementation and verification in progress; not released.

## Report And Version Evidence

The reported client is 0.2.18. Its visible assistant message offered to export
394 candidates, but the immediate follow-up denied having that source or rule.
The screenshot alone does not identify whether a model switch or session restart
occurred between those turns. The tasks shown under FangdeAIData are project
threads; the separate zero-count projectless task section is not evidence of
missing history.

GitHub run 34308396332 produced `fd-desktop-release-0.2.18` from
`97dc430c9a9124df10c17b72e54a02ee180bb154`. That code advertises model switching
as unsupported, causing the provider reactor to discard its resume cursor when
the model changes. Its per-Skill cursors are only an in-memory map; session
recreation restores the initial cursor only for the local profile.

The current binding implementation first appears in `e26588dde`, after 0.2.18.
Successful builds on GitHub did not activate the desktop download/update source:
the public latest manifest was still 0.2.18 during this investigation.

## Changes In This Work

- Remote legacy FD history restoration no longer blocks the T3 thread snapshot
  or live event subscription. Backfills still use the idempotent T3 restore
  command and reconcile against durable messages before import.
- Completed overlay messages are removed only after durable persistence is
  acknowledged. In-flight streams and failed-write content remain available.
- The delegated Codex Skill path now applies the enterprise event boundary.
  Final assistant text enters the existing T3 durable message command; reasoning,
  tools and intermediate content stay volatile. Provider snapshot and rollback
  results do not import raw enterprise items through a second history path.
- Skill authorization and tool execution remain in the FD runtime client.
  Model context remains in Codex; the renderer does not rebuild prompts from
  chat bubbles or maintain a second memory store.

## Evidence

- A real authorized Kimi + management Skill run retained synthetic candidate
  count 394 and rule FD_RULE_8371 on a follow-up, after stop/resume, and after a
  switch to DeepSeek. The same versioned provider cursor was retained.
- Socket regression verifies that an indefinitely pending legacy history request
  cannot prevent delivery of the local snapshot and synchronization marker.
- Runtime tests verify durable acknowledgement, active-stream retention, final
  text persistence and removal of enterprise execution data from durable events.

## Still Required Before Release

- Desktop startup now probes the current data directory plus the historical
  lowercase `fangde-ai` directory before creating a new user-data root. This
  prevents an installer naming change from presenting an empty conversation
  list. Existing databases are never copied or modified during this probe.
- Verify migration of 0.2.18 cursors and renderer Skill selection after restart.
  A legacy cursor has no trusted Skill provenance; do not attach it to an
  arbitrary selected Skill or silently claim old model history was restored.
- Finish the restart, workspace, permission and attachment recovery matrix with
  the new event boundary and a real desktop build.
- Review the final diff, update release documentation, push and merge, build a
  new version on GitHub, then activate and verify the desktop update source.
- Do not activate the staged 0.2.25 bundle as the result of these new changes.
