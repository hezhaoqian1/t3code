# DeepSeek V4 Pro Desktop - Checkpoint

- Task ID: 2026-08-17-deepseek-v4-pro-desktop
- Current todo: Complete pre-landing review, merge, package, and activate 0.2.9.
- Completed: Feishu account switching; Task 1 exact two-model credential projection and managed token upgrade; Task 2 selected-model runtime routing; Task 3 compact composer selector.
- Evidence: Task 1 passed 63 focused tests. Task 2 passed 134 focused tests and Server typecheck. Task 3 passed 121 focused Web tests and Web typecheck. Real Desktop QA returned exact Pro and Flash responses in one task, recorded exact models in SQLite, and completed a `pwd` tool call through each model's Codex harness. Feishu cancellation returned to the disabled state without a red error notification.
- Related release input: The Feishu account-switch commit is already included in `codex/deepseek-v4-pro`.
- Active slice: Task 4: integrated verification, documentation, release, and deployment.
- Blocked on: None.
- Next step: Complete pre-landing review, commit the release documentation, and merge the verified branch.
- Resume hint: Stay on `codex/deepseek-v4-pro`; do not alter image behavior or the Web enterprise Agent architecture.
- Drift check: still inside the Flash-default, exact-two-model, no-vision compatibility boundary; no new fallback or state owner; decision continue.
