#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Release verification runs as a standalone Node CLI.

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { parseUpdateManifest, serializeUpdateManifest } from "./lib/update-manifest.ts";

async function sha512Base64(filePath: string): Promise<string> {
  return createHash("sha512")
    .update(await readFile(filePath))
    .digest("base64");
}

export async function finalizeUpdateManifest(
  manifestPathArg: string,
  version: string,
  assetNames: ReadonlyArray<string>,
): Promise<void> {
  const manifestPath = resolve(manifestPathArg);
  const source = parseUpdateManifest(await readFile(manifestPath, "utf8"), manifestPath, "desktop");
  if (source.version !== version) {
    throw new Error(
      `${basename(manifestPath)} declares version ${source.version}, expected ${version}.`,
    );
  }
  if (
    new Set(assetNames).size !== assetNames.length ||
    assetNames.some((name) => basename(name) !== name)
  ) {
    throw new Error("Update manifest assets must be unique base names.");
  }
  const assetRoot = dirname(manifestPath);
  const files = await Promise.all(
    assetNames.map(async (url) => {
      const assetPath = join(assetRoot, url);
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile()) throw new Error(`Update asset is not a file: ${url}`);
      return { url, sha512: await sha512Base64(assetPath), size: assetStat.size };
    }),
  );
  await writeFile(
    manifestPath,
    serializeUpdateManifest(
      { ...source, files },
      { platformLabel: basename(manifestPath) === "latest-mac.yml" ? "macOS" : "Windows" },
    ),
  );
}

if (import.meta.main) {
  const [manifestPath, version, ...assetNames] = process.argv.slice(2);
  if (!manifestPath || !version || assetNames.length === 0) {
    throw new Error("Usage: finalize-update-manifest MANIFEST VERSION ASSET...");
  }
  await finalizeUpdateManifest(manifestPath, version, assetNames);
}
