# FD Enterprise Skills Through Codex App Server - Intent

- Requested outcome: migrate the old Codex business workspace experience into FD AI Desktop while
  adding FD authentication, centralized enterprise Skills, data permissions, and audit.
- Scope: Desktop managed FD Skills, Codex App Server dynamic tools, additive FD New API endpoints,
  live MySQL acceptance, and GUI verification.
- Non-goals: redesign the Web Enterprise Agent protocol, move admin management to Desktop, place
  database secrets on employee devices, or replace ordinary local Skills.
- Primary plan: `docs/aegis/plans/2026-08-11-fd-enterprise-skills-codex-runtime.md`.
- Baseline refs: current Task 10 managed Skill implementation; Task 11A Codex runtime; supplied
  `Codex_Business_Workspace_v1.0.0.zip`; official OpenAI App Server dynamic tool documentation.
- Risk hints: experimental App Server field, stale authorization, local persistence, tool result
  bounds, cross-repo deployment ordering, and live business-definition ambiguity.

## Execution Readiness View

- Intent lock: Codex runs the Desktop Agent; FD New API remains the enterprise authority.
- Scope fence: additive Desktop endpoints and Desktop runtime wiring only.
- Baseline lock: preserve current Web routes, current picker, and ordinary/local Codex Skills.
- Owner constraints: `FDToolCapability.Execute` remains the only data execution path.
- Compatibility boundary: `/api/agent/turns` and current Web management behavior do not change.
- Retirement boundary: selected managed Desktop turns no longer use the server model loop; no silent
  fallback is allowed.
- Test obligations: focused automated regression, four live queries, GUI screenshots.
- Review gates: security/diff review and verification-before-completion.
- Drift rule: return to plan review if a second SQL executor, client credential projection, Web
  protocol change, or local enterprise policy owner becomes necessary.
