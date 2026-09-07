# FD Enterprise Local History - Checkpoint

- Current status: implementation and focused verification complete.
- Durable owner: existing T3 orchestration events and `projection_thread_messages`.
- Persisted boundary: FD Skill user text and authoritative final assistant text.
- Memory-only boundary: streaming deltas, reasoning, tool cards and payloads, audit identifiers,
  policy, permissions, and credentials.
- Recovery boundary: Enterprise Agent history remains available for old and interrupted turns;
  recovered visible messages are imported locally and removed from the volatile snapshot.
- Compatibility: no schema or public RPC changes; ordinary T3 conversations are unchanged.
- Verification: ten focused files passed with 211 tests, Server and contracts typechecks exited
  0, and `git diff --check` passed.
