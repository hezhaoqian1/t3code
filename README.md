# Fangde AI Desktop

Fangde AI Desktop is the local employee workspace for daily office and project work. The Electron
app owns an authenticated loopback server, uses Codex App Server for ordinary Agent execution, and
connects to Fangde identity, usage policy, and enterprise FD Skills after sign-in.

## Employee Experience

- Start a task without choosing a workspace. Fangde AI creates a persistent task directory under
  `~/FangdeAI/Tasks` on first send.
- Open a local project when the task needs an existing code or document workspace.
- Use the managed `deepseek-v4-flash` runtime by default, or select the authorized
  `deepseek-v4-pro` model from the composer without choosing a provider or entering an API key.
- Select an authorized FD Skill for enterprise data workflows. Local Agent Skills remain available
  through the normal Skill invocation syntax.
- Connect Feishu with the bundled official CLI and Skills. The Feishu tenant administrator must
  authorize the CLI application before an employee can select a company account.
- On the desktop app, click your employee name in the lower-left corner to open the account menu
  for usage, settings, or sign out. The web app keeps these as separate sidebar entries.
- Download Windows x64 or macOS Apple Silicon installers from
  the [Fangde AI download page](https://ai-api.fdsure.com/api-access).

## Architecture

- T3-derived Desktop and Web code own the task, workspace, conversation, and local workbench UI.
- Codex App Server owns ordinary project and local-Skill Agent execution.
- Fangde identity owns login, short-lived runtime credentials, model policy, and AI-point usage.
- FD Enterprise Agent owns enterprise Skills, data authorization, audit, and enterprise history.

The runtime is local by construction: the bundled server binds to loopback only, and renderer/server
traffic is authenticated. The retired mobile, relay, public pairing, SSH, WSL, and third-party
provider surfaces are not part of Fangde AI Desktop.

## Development

Node.js 24 and Vite+ are required.

```bash
vp i
vp run dev:desktop
```

Use focused tests and typechecks for changed packages. See [AGENTS.md](./AGENTS.md),
[desktop release operations](./docs/operations/release.md), and the
[architecture plan](./docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md).
