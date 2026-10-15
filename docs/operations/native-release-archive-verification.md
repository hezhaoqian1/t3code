# Verify existing macOS release archives

`FD Desktop Native Archive Verification` verifies an existing successful
`FD Desktop Internal Release` run on a native macOS runner. It does not rebuild
or publish the application.

Run the workflow from `main`, supplying the release run ID, release version, and
the full source SHA recorded by that release run. The source must be an ancestor
of `main`; the release must have succeeded on this repository's `main` branch.

The workflow mounts the DMG read-only and extracts the updater ZIP. For both app
bundles it checks `codesign --verify --deep --strict`, the bundle identifier,
version, and arm64 architecture. It also compares the application executables
and verifies all release file SHA-256 hashes against the original bundle manifest.

The resulting `fd-desktop-native-verification-VERSION` artifact contains
`result.json` and the verified `SHA256SUMS`. Before publishing from another host,
match these hashes against the files on that host. Keep the successful workflow
URL and source SHA in the release record. The canonical publication and rollback
procedure remains the Gateway repository's `docs/operations/desktop-release.md`.

This verifies the packaged archives. It does not replace a real Mac's upgrade,
restart, and rollback acceptance test.
