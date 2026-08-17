# Fangde AI Desktop Release

当前版本的功能范围和人工验收清单见
[`releases/0.2.7.md`](./releases/0.2.7.md)。通用构建、发布和回滚流程以本文为准。

`.github/workflows/fd-desktop-release.yml` builds one immutable internal release bundle for:

- macOS arm64: DMG and updater ZIP
- Windows x64: NSIS installer and blockmap

The workflow runs on native macOS and Windows runners, preserves `latest-mac.yml` and `latest.yml`,
and writes `SHA256SUMS`. The native runners also install the matching pinned Feishu CLI binary;
the 27 official `lark-*` Skills are bundled from the repository resources. Employee machines do
not need Node.js, npm, or WorkBuddy.

The company-internal channel is intentionally unsigned. Employees may see macOS Gatekeeper or
Windows SmartScreen prompts on first install. Windows supports the in-app download and install
handoff; macOS employees download the new DMG from the company website and replace the existing
application because this unsigned channel does not provide a reliable in-app macOS install path.

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

## Acceptance

After activation, verify `latest.json`, `latest-mac.yml`, `latest.yml`, both download buttons,
manual DMG replacement on a real Apple Silicon Mac, and application update check, download, visible
installation, and restart on a Windows x64 machine. Also verify that the bundled Codex App Server
answers a real task without a system-wide Codex install, and that Windows retains both desktop and
Start menu shortcuts. Keep the prior release until this check is complete; then remove the retired
release and confirm no old alias or backup remains.
