#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Release verification runs as a standalone Node CLI.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parseUpdateManifest } from "./lib/update-manifest.ts";

export function expectedDesktopReleaseAssets(version: string): ReadonlyArray<string> {
  return [
    "latest-mac.yml",
    "latest.yml",
    `FD-Enterprise-AI-${version}-mac-arm64.dmg`,
    `FD-Enterprise-AI-${version}-mac-arm64.zip`,
    `FD-Enterprise-AI-${version}-win-x64.exe`,
    `FD-Enterprise-AI-${version}-win-x64.exe.blockmap`,
  ];
}

async function sha512Base64(filePath: string): Promise<string> {
  return createHash("sha512")
    .update(await readFile(filePath))
    .digest("base64");
}

async function verifyManifest(
  assetRoot: string,
  manifestName: string,
  version: string,
  expectedNames: ReadonlyArray<string>,
): Promise<void> {
  const manifestPath = join(assetRoot, manifestName);
  const manifest = parseUpdateManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath,
    manifestName === "latest-mac.yml" ? "macOS" : "Windows",
  );
  if (manifest.version !== version) {
    throw new Error(`${manifestName} declares version ${manifest.version}, expected ${version}.`);
  }
  const entries = new Map(manifest.files.map((entry) => [entry.url, entry]));
  if (entries.size !== manifest.files.length) {
    throw new Error(`${manifestName} contains duplicate file URLs.`);
  }
  const actualNames = [...entries.keys()].toSorted();
  if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].toSorted())) {
    throw new Error(`${manifestName} does not reference the exact expected asset set.`);
  }
  for (const name of expectedNames) {
    if (basename(name) !== name) throw new Error(`Invalid release asset name: ${name}`);
    const entry = entries.get(name);
    if (!entry) throw new Error(`${manifestName} is missing ${name}.`);
    const assetPath = join(assetRoot, name);
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile() || entry.size !== assetStat.size) {
      throw new Error(`${manifestName} has an invalid size for ${name}.`);
    }
    if (entry.sha512 !== (await sha512Base64(assetPath))) {
      throw new Error(`${manifestName} has an invalid sha512 for ${name}.`);
    }
  }
}

export async function verifyDesktopReleaseBundle(assetRootArg: string, version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  const assetRoot = resolve(assetRootArg);
  const expected = expectedDesktopReleaseAssets(version);
  const actual = (await readdir(assetRoot)).toSorted();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].toSorted())) {
    throw new Error("Release directory does not contain the exact production asset set.");
  }
  await verifyManifest(assetRoot, "latest-mac.yml", version, [
    `FD-Enterprise-AI-${version}-mac-arm64.zip`,
    `FD-Enterprise-AI-${version}-mac-arm64.dmg`,
  ]);
  await verifyManifest(assetRoot, "latest.yml", version, [
    `FD-Enterprise-AI-${version}-win-x64.exe`,
    `FD-Enterprise-AI-${version}-win-x64.exe.blockmap`,
  ]);
}

if (import.meta.main) {
  const [assetRoot, version] = process.argv.slice(2);
  if (!assetRoot || !version)
    throw new Error("Usage: verify-desktop-release-bundle ASSET_ROOT VERSION");
  await verifyDesktopReleaseBundle(assetRoot, version);
}
