# Scripts

> For maintainers. Using T3 Code? See [docs/user](../user/).

## First checkout

T3 Code uses [Vite+](https://viteplus.dev/guide/). Install the global `vp` command, install
dependencies, then start the dev stack:

```bash
curl -fsSL https://vite.plus | bash   # Windows: irm https://vite.plus/ps1 | iex
vp i
vp run dev
```

Node 24 is required. Bun is not: the server picks Bun adapters when it detects Bun and falls back to
Node otherwise, and nothing in contributor setup needs it.

Use `vp run dev:desktop` for the authenticated product experience. Electron starts the local server
on loopback and delivers its bootstrap credential to the renderer over trusted IPC.

## Dev

- `vp run dev`: Starts contracts, server, and web in watch mode.
- `vp run dev --browser`: Auto-opens a browser. Off by default. The dev runner writes
  `T3CODE_NO_BROWSER` itself from this flag, so setting `T3CODE_NO_BROWSER=0` in your environment has
  no effect; use `--browser`.
- `vp run dev:server`: Starts just the server. It runs on Node (`node --watch src/bin.ts`), so
  without Bun present it selects `NodePtyAdapter` and `NodeHttpServer`.
- `vp run dev:web`: Starts just the Vite dev server for the web app.
- `vp run dev:desktop`: Starts the Electron shell against the dev server.
- `vp run dev:marketing`: Starts the Astro marketing site.
- Pass dev-runner flags directly after the root task name, for example:
  `vp run dev --home-dir /tmp/t3code-dev`

### Dev state directories

- Dev commands run from a linked **git worktree** default to that worktree's gitignored `.t3`, even
  when `T3CODE_HOME` is set, storing state in `<worktree>/.t3/userdata`. Pass `--home-dir <path>` to
  choose another isolated directory explicitly. Submodules are not worktrees and keep the normal
  precedence.
- From the **main checkout**, dev commands implicitly use `~/.t3/dev`, keeping development state
  separate from `~/.t3/userdata`. An explicit `--home-dir <path>` stores state under
  `<path>/userdata`; the base directory remains available for caches, worktrees, and other shared
  data.

## Build, check, test

- `vp run build`: Fans out over `apps/*`, `packages/*`, `oxlint-plugin-t3code`, and `scripts`.
  Workspaces that define a build task run one: desktop, marketing, server (which depends on web), and
  web. Shared packages are consumed and bundled transitively rather than built separately.
- `vp run build:desktop`: Builds the desktop pipeline (desktop plus server).
- `vp run start`: Runs the production server (serves the built web app as static files).
- `vp check`: Vite+ format, lint, and type checks. This repo sets `typeCheck: false` in its lint
  options, so workspace type checking runs separately.
- `vp run typecheck`: Strict TypeScript checks for all packages.
- `vp run test`: Runs workspace tests.
- `vp run lint:mobile`: Mobile native static analysis (`scripts/mobile-native-static-check.ts`).
- `node apps/server/scripts/t3-sqlite-state.ts <query|exec> --base-dir <path> ...`: Inspects or seeds
  an isolated T3 SQLite database; writes create a private backup first.

## Desktop artifacts

- `vp run dist:desktop:artifact --platform <mac|linux|win> --target <target> --arch <arch>`: Builds a desktop artifact for a specific platform/target/arch.
- `vp run dist:desktop:dmg`: Builds a shareable macOS `.dmg` into `./release`. Architecture defaults
  to the host, so this produces an arm64 DMG on Apple Silicon. Use `dist:desktop:dmg:arm64` or
  `dist:desktop:dmg:x64`, or pass `--arch <arm64|x64|universal>`, to force one.
- `vp run dist:desktop:linux`: Builds a Linux AppImage into `./release`.
- `vp run dist:desktop:win`: Builds a Windows NSIS installer into `./release`. `:arm64` and `:x64`
  variants exist.

### Desktop `.dmg` packaging notes

- Default local and CI builds are unsigned/not notarized for company-internal distribution.
- The DMG build uses `assets/fd/fangde-ai-1024.png` as the Fangde AI app icon source.
- Desktop production windows load the bundled UI from the `fdai://app/` root URL (not a
  `127.0.0.1` document URL, and not an explicit `index.html` path).
- Desktop packaging includes `apps/server/dist` (the `t3` backend) and starts it on loopback with an
  auth token for WebSocket/API traffic.
- Desktop packaging includes a pinned, platform-native Codex runtime under Electron resources. The
  FD provider uses its absolute path, so employees do not install Codex separately.
- Your tester can still open it on macOS by right-clicking the app and choosing **Open** on first
  launch.
- To keep staging files for debugging package contents, run: `vp run dist:desktop:dmg --keep-stage`
- Windows internal builds can use the in-app updater, with a visible installer and automatic
  relaunch. macOS internal builds use manual DMG replacement because the native updater requires a
  signed application.
- The optional `--signed` build path remains available if the company later adopts platform signing.

## Browser development

`dev` and `dev:web` leave `VITE_HTTP_URL` and `VITE_WS_URL` unset so the browser resolves the backend
from `window.location.origin`. Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known` to the
loopback server. Non-loopback Vite origins are rejected by server configuration.

## Running multiple dev instances

Worktrees derive a preferred port offset from their path.

- Default ports: server `13773`, web `5733`
- Shifted ports: `base + offset`
- Example: `T3CODE_DEV_INSTANCE=branch-a vp run dev:desktop`

Offset resolution, in order:

1. `T3CODE_PORT_OFFSET`, which must be a non-negative integer. Negative values are rejected.
2. `T3CODE_DEV_INSTANCE`. An all-digit value is used directly as the offset; any other non-empty
   value is hashed into one.
3. The worktree path hash.

Collision scanning depends on the mode. `dev:web` scans only the web port and shifts only the web
offset. `dev:server` scans only the server port. `dev` and `dev:desktop` scan both and shift them
together as one shared offset. Explicit server or dev-URL overrides remove the corresponding port
from the availability check. Treat the `[dev-runner]` output as authoritative.
