# DeepSeek V4 Pro Desktop - Checkpoint

- Task ID: 2026-08-17-deepseek-v4-pro-desktop
- Current todo: Add the compact Flash/Pro composer selector.
- Completed: Feishu account switching; Task 1 exact two-model credential projection and managed token upgrade; Task 2 selected-model runtime routing.
- Evidence: Task 1 passed 63 focused tests. Task 2 passed 134 focused tests, Server typecheck, formatting, and diff checks.
- Related release input: The Feishu account-switch commit is already included in `codex/deepseek-v4-pro`.
- Active slice: Task 3: composer selector and model-selection state.
- Blocked on: None.
- Next step: Update `modelSelection.ts`, add `FdModelSelector.tsx`, wire it immediately left of Send, and run focused Web tests.
- Resume hint: Stay on `codex/deepseek-v4-pro`; do not alter image behavior or the Web enterprise Agent architecture.
- Drift check: still inside the Flash-default, exact-two-model, no-vision compatibility boundary; no new fallback or state owner; decision continue.
