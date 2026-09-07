# FD Enterprise Local History - Intent

- Requested outcome: stop FD Skill chat history from disappearing after Desktop restarts or
  temporary Enterprise history failures.
- Scope: locally persist employee-visible user and final assistant text, reconcile remote recovery
  history, preserve sensitive memory-only runtime data, and add focused regression coverage.
- Non-goals: persist reasoning or tool payloads, move enterprise authority to Desktop, add a second
  history database, or change account and permission behavior.
- Primary plan: `docs/aegis/plans/2026-09-07-fd-enterprise-local-history.md`.
- Architecture decision: `docs/aegis/adr/ADR-0002-persist-visible-fd-enterprise-history-locally.md`.
