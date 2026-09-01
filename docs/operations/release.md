# Fangde AI Desktop Release

各版本的人工验收清单见 [`releases/`](./releases/)。通用构建、发布和回滚流程以本文为准。

`.github/workflows/fd-desktop-release.yml` builds one immutable internal release bundle for:

- macOS arm64: DMG and updater ZIP
- Windows x64: NSIS installer and blockmap

The workflow runs on native macOS and Windows runners, preserves `latest-mac.yml` and `latest.yml`,
and writes `SHA256SUMS`. The native runners also install the matching pinned Feishu CLI binary;
the 27 official `lark-*` Skills are bundled from the repository resources. Employee machines do
not need Node.js, npm, or WorkBuddy.

The company-internal channel uses ad-hoc sealing on macOS and remains unsigned on Windows.
Employees may see Gatekeeper or SmartScreen prompts on first install. Subsequent macOS updates use
the existing electron-updater manifest download and SHA-512 verification, then a bundled internal
installer validates bundle ID, version, architecture, and the code seal before replacement. It
keeps the old bundle until the new version starts and rolls back if replacement validation fails.
An administrator prompt is used only when the installed app directory is not writable.

This internal macOS installer is a temporary distribution adapter. Remove it only after Developer
ID signing and notarization have passed two consecutive production upgrades through the native
electron-updater install path. Until then, retain the DMG as a failure/cancellation fallback.

Each artifact bundles the pinned native Codex App Server runtime for its platform. Employee machines
do not need a global Codex installation or a PATH entry. The build verifies the staged runtime and
then executes `codex --version` again from the final unpacked Electron application before accepting
the release artifact.

## Build And Publish

1. Merge verified source to `main`.
2. Dispatch `FD Desktop Internal Release` with a stable version higher than the active version.
3. Download the `fd-desktop-release-<version>` workflow artifact.
4. Run the Gateway publisher from the FD Gateway repository:

```bash
FD_DESKTOP_RELEASE_MODE=internal-unsigned scripts/publish-desktop-release.sh verify <version> <asset-directory>
FD_DESKTOP_RELEASE_MODE=internal-unsigned scripts/publish-desktop-release.sh publish <version> <asset-directory>
```

The Gateway publisher verifies manifests, byte sizes, hashes, app identifiers, architectures,
manifest byte sizes and hashes before atomically switching the public
`latest` link. It creates `latest.json` and stable legacy aliases used by the official download page.

## Upstream API Verification

Before changing the connector lifecycle, verify the implementation against the upstream contracts
instead of inferring API behavior from existing code:

- React context providers and Effect cleanup:
  [`createContext`](https://react.dev/reference/react/createContext) and
  [`useEffect`](https://react.dev/reference/react/useEffect)
- Electron renderer IPC listener wrapping and removal:
  [`ipcRenderer`](https://www.electronjs.org/docs/latest/api/ipc-renderer)
- Feishu CLI commands and flags: the pinned `@larksuite/cli` README plus the exact binary help

Run the bundled CLI help from the repository version used by the release:

```bash
apps/desktop/node_modules/@larksuite/cli/bin/lark-cli --version
apps/desktop/node_modules/@larksuite/cli/bin/lark-cli config show --help
apps/desktop/node_modules/@larksuite/cli/bin/lark-cli auth status --help
apps/desktop/node_modules/@larksuite/cli/bin/lark-cli auth login --help
apps/desktop/node_modules/@larksuite/cli/bin/lark-cli auth logout --help
```

For `0.2.11`, the pinned binary is `1.0.86`. Its official help confirms `config show`,
`auth status --json --verify`, `auth login --recommend --no-wait --json`,
`auth login --device-code`, and `auth logout --json`.

## Acceptance

After activation, verify `latest.json`, `latest-mac.yml`, `latest.yml`, both download buttons,
an in-app update from the previous macOS version on a real Apple Silicon Mac, rollback against an
invalid candidate, and application update check, download, visible installation, and restart on a
Windows x64 machine. Also verify that the bundled Codex App Server
answers a real task without a system-wide Codex install, and that Windows retains both desktop and
Start menu shortcuts. Keep the prior release until this check is complete; then remove the retired
release and confirm no old alias or backup remains.
