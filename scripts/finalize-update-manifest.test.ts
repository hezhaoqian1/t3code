import { createHash } from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Test fixtures use temporary files directly.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Test fixtures use temporary files directly.
import { join } from "node:path";

import { assert, it } from "@effect/vitest";

import { finalizeUpdateManifest } from "./finalize-update-manifest.ts";
import { parseUpdateManifest } from "./lib/update-manifest.ts";

it("rebuilds the updater file list from final assets including blockmaps", async () => {
  const root = await mkdtemp(join(tmpdir(), "fd-finalize-manifest-"));
  const manifestPath = join(root, "latest.yml");
  const installer = "FD-Enterprise-AI-1.2.3-win-x64.exe";
  const blockmap = `${installer}.blockmap`;
  await writeFile(join(root, installer), "installer");
  await writeFile(join(root, blockmap), "blockmap");
  await writeFile(
    manifestPath,
    "version: '1.2.3'\nfiles:\n  - url: old.exe\n    sha512: old\n    size: 1\nreleaseDate: '2026-08-12T00:00:00.000Z'\n",
  );

  await finalizeUpdateManifest(manifestPath, "1.2.3", [installer, blockmap]);

  const manifest = parseUpdateManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath,
    "Windows",
  );
  assert.deepStrictEqual(
    manifest.files.map((file) => file.url),
    [installer, blockmap],
  );
  assert.equal(manifest.files[1]?.sha512, createHash("sha512").update("blockmap").digest("base64"));
  assert.equal(manifest.files[1]?.size, 8);
});

it("rejects a manifest from another version", async () => {
  const root = await mkdtemp(join(tmpdir(), "fd-finalize-manifest-version-"));
  const manifestPath = join(root, "latest.yml");
  await writeFile(
    manifestPath,
    "version: '1.2.2'\nfiles:\n  - url: old.exe\n    sha512: old\n    size: 1\nreleaseDate: '2026-08-12T00:00:00.000Z'\n",
  );
  let error: unknown;
  try {
    await finalizeUpdateManifest(manifestPath, "1.2.3", ["missing.exe"]);
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, Error);
  assert.match(error.message, /expected 1.2.3/);
});
// @effect-diagnostics nodeBuiltinImport:off - Test fixtures use temporary files directly.
