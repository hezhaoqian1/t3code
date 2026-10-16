import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Test fixtures use temporary files directly.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Test fixtures use temporary files directly.
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import {
  expectedDesktopReleaseAssets,
  verifyDesktopReleaseBundle,
} from "./verify-desktop-release-bundle.ts";

const version = "1.2.3";

async function writeFixture(): Promise<string> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-release-bundle-"));
  const names = expectedDesktopReleaseAssets(version).filter((name) => !name.endsWith(".yml"));
  for (const name of names) await NodeFSP.writeFile(NodePath.join(root, name), name);
  const entry = (name: string) => {
    const content = Buffer.from(name);
    return `  - url: ${name}\n    sha512: ${NodeCrypto.createHash("sha512").update(content).digest("base64")}\n    size: ${content.length}`;
  };
  await NodeFSP.writeFile(
    NodePath.join(root, "latest-mac.yml"),
    `version: '${version}'\nfiles:\n${names
      .filter((name) => name.includes("-mac-"))
      .map(entry)
      .join("\n")}\nreleaseDate: '2026-08-12T00:00:00.000Z'\n`,
  );
  await NodeFSP.writeFile(
    NodePath.join(root, "latest.yml"),
    `version: '${version}'\nfiles:\n${names
      .filter((name) => name.includes("-win-"))
      .map(entry)
      .join("\n")}\nreleaseDate: '2026-08-12T00:00:00.000Z'\n`,
  );
  return root;
}

it("accepts an exact release bundle with matching updater metadata", async () => {
  await verifyDesktopReleaseBundle(await writeFixture(), version);
});

it("rejects extra files in the release bundle", async () => {
  const root = await writeFixture();
  await NodeFSP.writeFile(NodePath.join(root, "unexpected.txt"), "unexpected");
  let error: unknown;
  try {
    await verifyDesktopReleaseBundle(root, version);
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, Error);
  assert.match(error.message, /exact production asset set/);
});

it("rejects updater hashes that do not match the artifact", async () => {
  const root = await writeFixture();
  const name = `FD-Enterprise-AI-${version}-mac-arm64.zip`;
  await NodeFSP.writeFile(NodePath.join(root, name), "tampered");
  let error: unknown;
  try {
    await verifyDesktopReleaseBundle(root, version);
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, Error);
  assert.match(error.message, /invalid (size|sha512)/);
});
// @effect-diagnostics nodeBuiltinImport:off - Test fixtures use temporary files directly.
