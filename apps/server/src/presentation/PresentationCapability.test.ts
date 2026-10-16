// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import {
  resolvePresentationCapability,
  validatePresentationManifest,
} from "./PresentationCapability.ts";

describe("PresentationCapability", () => {
  it("accepts the packaged capability and verifies its pinned hash", async () => {
    const packagedRoot = NodePath.resolve(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "../../../../apps/desktop/resources/presentation",
    );
    const resolved = await resolvePresentationCapability({ packagedRoot });
    expect(resolved.id).toBe("fd-presentation-studio");
    expect(resolved.source).toBe("packaged");
    expect(resolved.skillPath.endsWith(NodePath.join("fd-presentation-studio", "SKILL.md"))).toBe(
      true,
    );
  });

  it("rejects path traversal and malformed signatures", () => {
    expect(() =>
      validatePresentationManifest({
        id: "fd-presentation-studio",
        version: "1.0.0",
        skillRoot: "../outside",
        sha256: "",
        maxPackageBytes: 1024,
      }),
    ).toThrow("presentation-manifest-path-invalid");
    expect(() =>
      validatePresentationManifest({
        id: "fd-presentation-studio",
        version: "1.0.0",
        skillRoot: "fd-presentation-studio",
        sha256: "",
        maxPackageBytes: 1024,
        signature: "abc",
      }),
    ).toThrow("presentation-manifest-signature-incomplete");
  });

  it("falls back to a valid cache package when the packaged root is unavailable", async () => {
    const cacheRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "fd-presentation-cache-"),
    );
    const packagedRoot = NodePath.join(cacheRoot, "missing");
    const sourceRoot = NodePath.resolve(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "../../../../apps/desktop/resources/presentation",
    );
    const target = NodePath.join(cacheRoot, "cached");
    await NodeFSP.cp(sourceRoot, target, { recursive: true });
    const resolved = await resolvePresentationCapability({ packagedRoot, cacheRoot: target });
    expect(resolved.source).toBe("cache");
    await NodeFSP.rm(cacheRoot, { recursive: true, force: true });
  });

  it("rejects changed bytes in a cached package", async () => {
    const cacheRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "fd-presentation-tamper-"),
    );
    try {
      const sourceRoot = NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "../../../../apps/desktop/resources/presentation",
      );
      await NodeFSP.cp(sourceRoot, cacheRoot, { recursive: true });
      await NodeFSP.appendFile(
        NodePath.join(cacheRoot, "fd-presentation-studio", "SKILL.md"),
        "\nmodified",
      );
      await expect(resolvePresentationCapability({ cacheRoot })).rejects.toThrow(
        "presentation-package-hash-mismatch",
      );
    } finally {
      await NodeFSP.rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
