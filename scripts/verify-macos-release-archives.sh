#!/bin/bash
# Run on a native Mac against the exact, already-built release assets.
set -euo pipefail
assets=$(cd "$1" && pwd)
version=$2
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$(uname -s)" = Darwin ]]
scratch=$(mktemp -d)
mounted=0
cleanup() {
  if [ "$mounted" = 1 ]; then hdiutil detach "$scratch/dmg" >/dev/null || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
verify_app() {
  local app=$1
  codesign --verify --deep --strict --verbose=2 "$app"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = com.fdsure.enterprise-ai ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$version" ]]
  local executable
  executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
  [[ "$executable" != */* && -n "$executable" ]]
  [[ "$(lipo -archs "$app/Contents/MacOS/$executable")" = arm64 ]]
  shasum -a 256 "$app/Contents/MacOS/$executable" | awk '{print $1}'
}
mkdir "$scratch/dmg" "$scratch/zip"
hdiutil attach -nobrowse -readonly -mountpoint "$scratch/dmg" "$assets/FD-Enterprise-AI-$version-mac-arm64.dmg" >/dev/null
mounted=1
dmg_sha=$(verify_app "$scratch/dmg/Fangde AI.app")
hdiutil detach "$scratch/dmg" >/dev/null
mounted=0
ditto -x -k "$assets/FD-Enterprise-AI-$version-mac-arm64.zip" "$scratch/zip"
zip_sha=$(verify_app "$scratch/zip/Fangde AI.app")
[[ "$dmg_sha" = "$zip_sha" ]]
# Bind the successful native checks to the bytes the publishing host receives.
(cd "$assets" && shasum -a 256 -c SHA256SUMS)
printf 'Native DMG and ZIP verification passed: version=%s arch=arm64 executable_sha256=%s\n' "$version" "$zip_sha"
