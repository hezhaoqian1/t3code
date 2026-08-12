---
name: test-t3-app
description: Launch, retain, and test the authenticated T3 Code Electron app with isolated local state, loopback-only Vite and server endpoints, Desktop IPC bootstrap, and direct SQLite fixture inspection.
---

# Test T3 App

Use this skill for the local Electron application. The supported authenticated development path is
the Desktop shell with its server bound to `127.0.0.1`; do not expose the server to another device.

## Start an isolated environment

1. Run commands from the repository root.
2. Use the worktree's ignored `.t3` directory for reusable state, or create a disposable directory
   with `mktemp -d /tmp/t3code-test.XXXXXX` and pass it with `--home-dir`.
3. Start the product with `vp run dev:desktop`. The Desktop process creates the bootstrap credential
   and sends it to the renderer over trusted IPC.
4. Keep the terminal session alive and read the selected loopback ports and base directory from the
   `[dev-runner]` output.

Never delete or seed shared `~/.t3` state. A linked worktree's local state deliberately outranks an
ambient `T3CODE_HOME`.

Ports can shift when occupied. Treat the current dev-runner output as authoritative. The Vite origin
and backend must remain loopback URLs; configuration rejects wildcard, LAN, and other non-loopback
hosts.

## Preserve the environment while iterating

- Keep the dev process, Desktop window, selected ports, and isolated base directory alive while the
  user may inspect the result or request follow-up changes.
- Reuse a healthy process and window across turns. If it exits, restart with the same base directory.
- Do not extract, print, or hand off the Desktop bootstrap credential. Authentication is owned by
  the Desktop IPC flow.

## Inspect or seed SQLite state

Read `references/sqlite-fixtures.md` before changing the database.

- Use `node apps/server/scripts/t3-sqlite-state.ts query` for schema discovery and read-only checks.
- Stop the dev server before using `node apps/server/scripts/t3-sqlite-state.ts exec`, then restart
  with the same isolated base directory.
- Seed projection tables only for disposable UI fixtures. Use application commands and APIs when
  testing behavior or projection correctness.
- Do not edit authentication tables directly.

The helper refuses to write to shared state by default and creates a database backup before each
mutation.

## Tear down

Tear down only when the user asks, confirms iteration is finished, or the task is genuinely complete
with no pending human review. Stop the dev process first, then remove only disposable paths created
for this test after verifying the exact target.

## Troubleshoot

- If the renderer is unauthenticated, confirm it was launched by `dev:desktop` and inspect the
  Desktop/backend IPC logs; do not create a network pairing credential.
- If the UI shows unexpected data, confirm every command uses the same isolated base directory.
- If ports move, use the latest dev-runner output rather than assuming fixed defaults.
