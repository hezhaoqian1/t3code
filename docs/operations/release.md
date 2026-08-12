# Fangde AI Desktop Release

`.github/workflows/fd-desktop-release.yml` builds one immutable, signed release bundle for:

- macOS arm64: DMG and updater ZIP
- macOS x64: DMG and updater ZIP
- Windows x64: NSIS installer and blockmap
- Windows arm64: NSIS installer and blockmap

The workflow merges both macOS manifests into `latest-mac.yml`, both Windows manifests into
`latest.yml`, and writes `SHA256SUMS`. It fails before building when any production signing secret
is absent; unsigned artifacts are never accepted as production releases.

## Required GitHub Secrets

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
2. Dispatch `FD Desktop Release` with a stable version higher than the active production version.
3. Download the `fd-desktop-release-<version>` workflow artifact.
4. Run the Gateway publisher from the FD Gateway repository:

```bash
scripts/publish-desktop-release.sh verify <version> <asset-directory>
scripts/publish-desktop-release.sh publish <version> <asset-directory>
```

The Gateway publisher verifies manifests, byte sizes, hashes, app identifiers, architectures,
macOS signing/notarization, and Windows publisher identity before atomically switching the public
`latest` link. It creates `latest.json` and stable legacy aliases used by the official download page.

## Acceptance

After activation, verify `latest.json`, `latest-mac.yml`, `latest.yml`, all four download buttons,
application update check, download, and restart/install. Keep the prior release until this check is
complete; then remove the retired release and confirm no old alias or backup remains.
