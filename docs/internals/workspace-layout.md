# Workspace layout

> For maintainers. Using Fangde AI? See [docs/user](../user/).

A Desktop-only, 11-project pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). The root
package coordinates three apps, five shared packages, the scripts package, and the lint plugin. See
[scripts.md](./scripts.md) for the task commands.

## apps

- `apps/server` (`t3`): the private local execution runtime. Owns orchestration, provider
  drivers, checkpointing, VCS, terminals, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@t3tools/web`): React + Vite UI. Consumes the shared client runtime and adds routing,
  components, and web-specific platform layers.
- `apps/desktop` (`@t3tools/desktop`): Electron shell. Supervises a desktop-scoped `t3` backend,
  loads production web bundles from `fdai://app/` (and development bundles from
  `fdai-dev://app/`), and owns the local backend lifecycle.

## packages

- `packages/contracts` (`@t3tools/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@t3tools/shared`): framework-agnostic worker primitives, git and
  source-control helpers, schema utilities, semver, logging, observability, and development support.
- `packages/client-runtime` (`@t3tools/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state used by the web renderer and Desktop.
  See its [README](../../packages/client-runtime/README.md).

## Other top-level directories

- `scripts/` (`@t3tools/scripts`): workspace tooling run through `vp run`. Dev runner, desktop
  artifact builds, release helpers, brand application, and update-manifest merging.
- `assets/fd/`: the sole source for active Fangde AI app and web icon artwork. The deleted T3 Code
  `assets/dev`, `assets/nightly`, and `assets/prod` channel trees are not active sources.
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-t3code/` (`@t3tools/oxlint-plugin-t3code`): repo-specific lint rules.
- `experiments/`: throwaway prototypes. Not part of the shipped build.
- `docs/`: this documentation tree.

## Import conventions

`@t3tools/shared` and `@t3tools/client-runtime` use explicit subpath exports with no barrel index and
no root export. Import the narrow path (`@t3tools/shared/DrainableWorker`,
`@t3tools/client-runtime/state/threads`) rather than the package root. Files that are not exported
are implementation details. `@t3tools/contracts` exports its renderer-safe contracts from the
package root. The Electron-main-to-server fd6 credential schema is available only through the
explicit `@t3tools/contracts/fd/runtime-credentials` subpath.
