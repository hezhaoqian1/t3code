// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The tests create native filesystem fixtures for the detached macOS helper.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  confirmMacInstalledStartup,
  isSafeMacUpdateTransactionPaths,
  resolveMacAppBundlePath,
} from "./MacInternalUpdater.ts";

describe("resolveMacAppBundlePath", () => {
  it("resolves the installed app from its Resources directory", () => {
    expect(resolveMacAppBundlePath("/Applications/Fangde AI.app/Contents/Resources")).toBe(
      "/Applications/Fangde AI.app",
    );
  });

  it("rejects paths that are not inside an app bundle", () => {
    expect(resolveMacAppBundlePath("/repo/apps/desktop/resources")).toBeNull();
  });

  it("rejects recovery records that can delete paths outside their transaction", () => {
    const transactionRoot =
      "/Users/employee/Library/Application Support/Fangde AI/desktop-updates/transaction-safe";
    const currentAppPath = "/Applications/Fangde AI.app";
    const transaction = {
      id: "safe",
      status: "installed" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      parentPid: 123,
      expectedVersion: "0.2.15",
      expectedArch: "arm64" as const,
      appBundleName: "Fangde AI.app",
      transactionRoot,
      currentAppPath,
      stagedAppPath: `${transactionRoot}/extracted/Fangde AI.app`,
      backupAppPath: "/Users/employee/Documents",
      temporaryAppPath: `${currentAppPath}.fd-new-safe`,
      readyMarkerPath: `${transactionRoot}/authorized`,
      startedMarkerPath: `${transactionRoot}/started`,
    };

    expect(isSafeMacUpdateTransactionPaths(transaction, transactionRoot, currentAppPath)).toBe(
      false,
    );
    expect(
      isSafeMacUpdateTransactionPaths(
        { ...transaction, backupAppPath: `${currentAppPath}.fd-backup-safe` },
        transactionRoot,
        currentAppPath,
      ),
    ).toBe(true);
  });

  it("confirms startup only for the installed current version", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-mac-confirm-"));
    const updatesRoot = NodePath.join(root, "desktop-updates");
    const transactionRoot = NodePath.join(updatesRoot, "transaction-confirm");
    const currentAppPath = NodePath.join(root, "Fangde AI.app");
    await NodeFSP.mkdir(NodePath.join(transactionRoot, "extracted", "Fangde AI.app"), {
      recursive: true,
    });
    await NodeFSP.mkdir(currentAppPath);
    await NodeFSP.mkdir(NodePath.join(currentAppPath, "Contents"));
    await NodeFSP.writeFile(
      NodePath.join(currentAppPath, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.2.15</string></dict></plist>`,
    );
    const transaction = {
      id: "confirm",
      status: "installed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentPid: 123,
      expectedVersion: "0.2.15",
      expectedArch: "arm64",
      appBundleName: "Fangde AI.app",
      transactionRoot,
      currentAppPath,
      stagedAppPath: NodePath.join(transactionRoot, "extracted", "Fangde AI.app"),
      backupAppPath: `${currentAppPath}.fd-backup-confirm`,
      temporaryAppPath: `${currentAppPath}.fd-new-confirm`,
      readyMarkerPath: NodePath.join(transactionRoot, "authorized"),
      startedMarkerPath: NodePath.join(transactionRoot, "started"),
    } as const;
    await NodeFSP.writeFile(
      NodePath.join(transactionRoot, "transaction.json"),
      JSON.stringify(transaction),
    );

    await confirmMacInstalledStartup(updatesRoot, "0.2.14", currentAppPath);
    await expect(NodeFSP.access(transaction.startedMarkerPath)).rejects.toThrow();

    await confirmMacInstalledStartup(updatesRoot, "0.2.15", currentAppPath);
    await expect(NodeFSP.readFile(transaction.startedMarkerPath, "utf8")).resolves.toBe(
      "started\n",
    );

    await NodeFSP.rm(root, { recursive: true, force: true });
  });
});
