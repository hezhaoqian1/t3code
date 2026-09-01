// @effect-diagnostics nodeBuiltinImport:off - This macOS integration test exercises the detached native helper.
// @effect-diagnostics globalDate:off - Transaction fixtures use wall-clock ISO timestamps outside Effect code.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { afterEach, describe, expect, it } from "vite-plus/test";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const helperPath = NodeURL.fileURLToPath(
  new URL("../../resources/updater/mac-internal-updater-helper.mjs", import.meta.url),
);
const temporaryRoots: string[] = [];

async function command(file: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(file, [...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function makeApp(root: string, name: string, version: string): Promise<string> {
  const appPath = NodePath.join(root, `${name}.app`);
  const contents = NodePath.join(appPath, "Contents");
  const executableDirectory = NodePath.join(contents, "MacOS");
  await NodeFSP.mkdir(executableDirectory, { recursive: true });
  await NodeFSP.copyFile("/bin/echo", NodePath.join(executableDirectory, name));
  await NodeFSP.chmod(NodePath.join(executableDirectory, name), 0o755);
  await NodeFSP.writeFile(
    NodePath.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.fdsure.enterprise-ai</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleExecutable</key><string>${name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  );
  await command("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
  return appPath;
}

async function plistVersion(appPath: string): Promise<string> {
  return command("/usr/bin/plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    NodePath.join(appPath, "Contents", "Info.plist"),
  ]);
}

async function makeTransaction(input: {
  readonly root: string;
  readonly currentAppPath: string;
  readonly stagedAppPath: string;
  readonly expectedVersion: string;
}) {
  const id = "integration";
  const transactionPath = NodePath.join(input.root, "transaction.json");
  const architectures = (
    await command("/usr/bin/lipo", [
      "-archs",
      NodePath.join(input.stagedAppPath, "Contents", "MacOS", "Fangde AI"),
    ])
  ).split(/\s+/);
  const transaction = {
    id,
    status: "prepared",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parentPid: 2_147_483_647,
    expectedVersion: input.expectedVersion,
    expectedArch: architectures.includes("arm64") ? "arm64" : "x86_64",
    appBundleName: "Fangde AI.app",
    transactionRoot: input.root,
    currentAppPath: input.currentAppPath,
    stagedAppPath: input.stagedAppPath,
    backupAppPath: `${input.currentAppPath}.fd-backup-${id}`,
    temporaryAppPath: `${input.currentAppPath}.fd-new-${id}`,
    readyMarkerPath: NodePath.join(input.root, "authorized"),
    startedMarkerPath: NodePath.join(input.root, "started"),
  } as const;
  await NodeFSP.writeFile(transactionPath, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
  return { transaction, transactionPath };
}

describe.skipIf(NodeProcess.platform !== "darwin")("mac internal updater helper", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
    );
  });

  it("replaces the app after startup confirmation and removes the previous bundle", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-mac-updater-success-"));
    temporaryRoots.push(root);
    const installRoot = NodePath.join(root, "Applications");
    const transactionRoot = NodePath.join(root, "transaction-integration");
    await NodeFSP.mkdir(installRoot);
    await NodeFSP.mkdir(transactionRoot);
    const currentAppPath = await makeApp(installRoot, "Fangde AI", "1.0.0");
    const stagedAppPath = await makeApp(transactionRoot, "Fangde AI", "1.1.0");
    const { transaction, transactionPath } = await makeTransaction({
      root: transactionRoot,
      currentAppPath,
      stagedAppPath,
      expectedVersion: "1.1.0",
    });
    await NodeFSP.writeFile(transaction.startedMarkerPath, "started\n");

    await command(NodeProcess.execPath, [helperPath, transactionPath]);

    expect(await plistVersion(currentAppPath)).toBe("1.1.0");
    await expect(NodeFSP.access(transaction.backupAppPath)).rejects.toThrow();
    await expect(NodeFSP.access(transactionPath)).rejects.toThrow();
  });

  it("leaves the installed app untouched when the staged bundle fails validation", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-mac-updater-failure-"));
    temporaryRoots.push(root);
    const installRoot = NodePath.join(root, "Applications");
    const transactionRoot = NodePath.join(root, "transaction-integration");
    await NodeFSP.mkdir(installRoot);
    await NodeFSP.mkdir(transactionRoot);
    const currentAppPath = await makeApp(installRoot, "Fangde AI", "1.0.0");
    const stagedAppPath = await makeApp(transactionRoot, "Fangde AI", "9.9.9");
    const { transactionPath } = await makeTransaction({
      root: transactionRoot,
      currentAppPath,
      stagedAppPath,
      expectedVersion: "1.1.0",
    });

    await expect(command(NodeProcess.execPath, [helperPath, transactionPath])).rejects.toThrow();

    expect(await plistVersion(currentAppPath)).toBe("1.0.0");
    expect(JSON.parse(await NodeFSP.readFile(transactionPath, "utf8"))).toMatchObject({
      status: "rolled_back",
    });
  });
});
