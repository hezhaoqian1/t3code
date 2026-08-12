// @effect-diagnostics nodeBuiltinImport:off
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadFdEnterpriseConfig } from "./EnterpriseConfig.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("FD enterprise config", () => {
  it("loads strict packaged public endpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-enterprise-config-"));
    roots.push(root);
    await writeFile(join(root, "enterprise-config.json"), JSON.stringify(config()));
    await expect(
      loadFdEnterpriseConfig({ isPackaged: true, resourcesPath: root, rootDir: root }),
    ).resolves.toEqual({
      newApiOrigin: "https://ai-api.fdsure.com",
      updateManifestUrl: "https://ai-api.fdsure.com/downloads/desktop/latest/latest.json",
    });
  });

  it("allows only loopback HTTP or HTTPS development overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-enterprise-config-dev-"));
    roots.push(root);
    const resources = join(root, "apps", "desktop", "resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "enterprise-config.json"), JSON.stringify(config()));
    await expect(
      loadFdEnterpriseConfig({
        isPackaged: false,
        resourcesPath: root,
        rootDir: root,
        env: { FD_NEW_API_ORIGIN: "http://127.0.0.1:3001" },
      }),
    ).resolves.toMatchObject({ newApiOrigin: "http://127.0.0.1:3001" });
    await expect(
      loadFdEnterpriseConfig({
        isPackaged: false,
        resourcesPath: root,
        rootDir: root,
        env: { FD_NEW_API_ORIGIN: "http://api.example.com" },
      }),
    ).rejects.toThrow("invalid");
    await expect(
      loadFdEnterpriseConfig({
        isPackaged: false,
        resourcesPath: root,
        rootDir: root,
        env: { FD_NEW_API_ORIGIN: "https://api.example.com" },
      }),
    ).rejects.toThrow("invalid");
  });

  it("rejects symlinks, oversized files, and mutable packaged endpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-enterprise-config-invalid-"));
    roots.push(root);
    const path = join(root, "enterprise-config.json");
    const target = join(root, "target.json");
    await writeFile(target, JSON.stringify(config()));
    await symlink(target, path);
    await expect(
      loadFdEnterpriseConfig({ isPackaged: true, resourcesPath: root, rootDir: root }),
    ).rejects.toThrow("invalid");

    await rm(path);
    await writeFile(path, Buffer.alloc(4 * 1_024 + 1));
    await expect(
      loadFdEnterpriseConfig({ isPackaged: true, resourcesPath: root, rootDir: root }),
    ).rejects.toThrow("invalid");

    await writeFile(
      path,
      JSON.stringify({
        ...config(),
        newApiOrigin: "https://other.example.com",
      }),
    );
    await expect(
      loadFdEnterpriseConfig({ isPackaged: true, resourcesPath: root, rootDir: root }),
    ).rejects.toThrow("immutable");
  });
});

function config() {
  return {
    schemaVersion: 1,
    distribution: "internal",
    newApiOrigin: "https://ai-api.fdsure.com",
    updateManifestUrl: "https://ai-api.fdsure.com/downloads/desktop/latest/latest.json",
  };
}
