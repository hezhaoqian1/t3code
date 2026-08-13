# Fangde AI Desktop Release

`.github/workflows/fd-desktop-release.yml` builds one immutable internal release bundle for:

- macOS arm64: DMG and updater ZIP
- Windows x64: NSIS installer and blockmap

The workflow runs on native macOS and Windows runners, preserves `latest-mac.yml` and `latest.yml`,
and writes `SHA256SUMS`. The native runners also install the matching pinned Feishu CLI binary;
the 27 official `lark-*` Skills are bundled from the repository resources. Employee machines do
not need Node.js, npm, or WorkBuddy.

The current workflow produces internal unsigned packages. macOS Gatekeeper and Windows SmartScreen
may show trust prompts. A production-signed channel must pass `--signed` and configure the signing
secrets below before it can be described as signed.

## Production Signing Secrets

macOS signing and notarization:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Windows Azure Trusted Signing:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

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
application update check, download, and restart/install on a real Apple Silicon Mac and a Windows
x64 machine. Keep the prior release until this check is complete; then remove the retired release
and confirm no old alias or backup remains.
