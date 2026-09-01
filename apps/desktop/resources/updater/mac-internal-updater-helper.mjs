import { constants as FsConstants } from "node:fs";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const EXPECTED_BUNDLE_ID = "com.fdsure.enterprise-ai";
const STARTUP_CONFIRMATION_TIMEOUT_MS = 120_000;
const transactionPath = process.argv[2];

function fail(message) {
  throw new Error(message);
}

async function writeNewFile(path, content, mode = 0o600) {
  const handle = await Fs.open(
    path,
    FsConstants.O_WRONLY | FsConstants.O_CREAT | FsConstants.O_EXCL | FsConstants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(
      `${command} failed (${String(result.status)}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

function assertPathShape(transaction) {
  const root = Path.resolve(transaction.transactionRoot);
  const staged = Path.resolve(transaction.stagedAppPath);
  const current = Path.resolve(transaction.currentAppPath);
  const parent = Path.dirname(current);
  const backup = Path.resolve(transaction.backupAppPath);
  const temporary = Path.resolve(transaction.temporaryAppPath);
  const readyMarker = Path.resolve(transaction.readyMarkerPath);
  const startedMarker = Path.resolve(transaction.startedMarkerPath);

  if (Path.dirname(transactionPath) !== root) fail("Transaction file escaped its root");
  if (Path.basename(root) !== `transaction-${transaction.id}`)
    fail("Transaction identifier is invalid");
  if (!/^[A-Za-z0-9_-]+$/.test(transaction.id)) fail("Transaction identifier is malformed");
  if (!staged.startsWith(`${root}${Path.sep}`) || !staged.endsWith(".app")) {
    fail("Staged application path is outside the transaction root");
  }
  if (!current.endsWith(".app") || Path.basename(current) !== transaction.appBundleName) {
    fail("Current application path is invalid");
  }
  if (Path.dirname(backup) !== parent || Path.dirname(temporary) !== parent) {
    fail("Replacement paths must stay beside the installed application");
  }
  if (backup !== `${current}.fd-backup-${transaction.id}`) fail("Backup path is invalid");
  if (temporary !== `${current}.fd-new-${transaction.id}`) fail("Temporary path is invalid");
  if (readyMarker !== Path.join(root, "authorized")) fail("Authorization marker path is invalid");
  if (startedMarker !== Path.join(root, "started")) fail("Startup marker path is invalid");
  if (!Number.isSafeInteger(transaction.parentPid) || transaction.parentPid <= 0) {
    fail("Parent process identifier is invalid");
  }
  if (typeof transaction.expectedVersion !== "string" || !transaction.expectedVersion.trim()) {
    fail("Expected version is invalid");
  }
  if (!["arm64", "x86_64"].includes(transaction.expectedArch)) {
    fail("Expected architecture is invalid");
  }
}

function plistValue(appPath, key) {
  return run("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    Path.join(appPath, "Contents", "Info.plist"),
  ]);
}

async function validateBundle(appPath, transaction) {
  const stat = await Fs.lstat(appPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Application bundle is not a directory");
  if (plistValue(appPath, "CFBundleIdentifier") !== EXPECTED_BUNDLE_ID) {
    fail("Application bundle identifier does not match");
  }
  if (plistValue(appPath, "CFBundleShortVersionString") !== transaction.expectedVersion) {
    fail("Application version does not match");
  }
  const executable = plistValue(appPath, "CFBundleExecutable");
  const architectures = run("/usr/bin/lipo", [
    "-archs",
    Path.join(appPath, "Contents", "MacOS", executable),
  ]).split(/\s+/);
  if (!architectures.includes(transaction.expectedArch))
    fail("Application architecture is invalid");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const signature = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  if (
    signature.status !== 0 ||
    !`${signature.stdout || ""}\n${signature.stderr || ""}`.includes("Signature=adhoc")
  ) {
    fail("Application is not an ad-hoc signed internal build");
  }
}

async function writeStatus(transaction, status, detail) {
  const next = {
    ...transaction,
    status,
    updatedAt: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  const temporaryPath = `${transactionPath}.tmp`;
  const transactionStat = await Fs.stat(transactionPath);
  await Fs.rm(temporaryPath, { force: true });
  await writeNewFile(temporaryPath, `${JSON.stringify(next)}\n`);
  if (typeof process.getuid === "function" && process.getuid() !== transactionStat.uid) {
    await Fs.chown(temporaryPath, transactionStat.uid, transactionStat.gid);
  }
  await Fs.rename(temporaryPath, transactionPath);
}

async function waitForParent(pid) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch {
      return;
    }
  }
  fail("Application did not exit before the update deadline");
}

function relaunch(appPath) {
  const child = spawn("/usr/bin/open", ["-n", appPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function waitForStartupConfirmation(markerPath) {
  const deadline = Date.now() + STARTUP_CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await Fs.access(markerPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  fail("Updated application did not confirm startup before the deadline");
}

async function rollback(transaction, detail) {
  await Fs.rm(transaction.temporaryAppPath, { recursive: true, force: true }).catch(() => {});
  const hasBackup = await Fs.access(transaction.backupAppPath).then(
    () => true,
    () => false,
  );
  if (hasBackup) {
    await Fs.rm(transaction.currentAppPath, { recursive: true, force: true }).catch(() => {});
    await Fs.rename(transaction.backupAppPath, transaction.currentAppPath);
  }
  await writeStatus(transaction, "rolled_back", detail).catch(() => {});
  relaunch(transaction.currentAppPath);
}

async function main() {
  if (!transactionPath || !Path.isAbsolute(transactionPath)) fail("Missing transaction path");
  const transactionFileStat = await Fs.lstat(transactionPath);
  if (!transactionFileStat.isFile() || transactionFileStat.isSymbolicLink()) {
    fail("Transaction record is not a regular file");
  }
  const transaction = JSON.parse(await Fs.readFile(transactionPath, "utf8"));
  assertPathShape(transaction);
  const [transactionRootStat, currentAppStat] = await Promise.all([
    Fs.lstat(transaction.transactionRoot),
    Fs.lstat(transaction.currentAppPath),
  ]);
  if (!transactionRootStat.isDirectory() || transactionRootStat.isSymbolicLink()) {
    fail("Transaction root is not a regular directory");
  }
  if (!currentAppStat.isDirectory() || currentAppStat.isSymbolicLink()) {
    fail("Installed application is not a regular directory");
  }
  await Fs.access(transaction.transactionRoot, FsConstants.R_OK | FsConstants.W_OK);
  await writeNewFile(transaction.readyMarkerPath, "ready\n");
  await writeStatus(transaction, "authorized");
  await waitForParent(transaction.parentPid);

  try {
    await Fs.rm(transaction.temporaryAppPath, { recursive: true, force: true });
    await Fs.rm(transaction.backupAppPath, { recursive: true, force: true });
    run("/usr/bin/ditto", [transaction.stagedAppPath, transaction.temporaryAppPath]);
    await validateBundle(transaction.temporaryAppPath, transaction);
    await Fs.rename(transaction.currentAppPath, transaction.backupAppPath);
    await Fs.rename(transaction.temporaryAppPath, transaction.currentAppPath);
    await validateBundle(transaction.currentAppPath, transaction);
    await writeStatus(transaction, "installed");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await rollback(transaction, detail);
    throw error;
  }

  relaunch(transaction.currentAppPath);
  try {
    await waitForStartupConfirmation(transaction.startedMarkerPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await rollback(transaction, detail);
    throw error;
  }

  try {
    await Fs.rm(transaction.backupAppPath, { recursive: true, force: true });
    await Fs.rm(transaction.transactionRoot, { recursive: true, force: true });
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    await Fs.appendFile(`${transactionPath}.log`, `${detail}\n`).catch(() => {});
  }
}

main().catch(async (error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  try {
    await Fs.appendFile(`${transactionPath || "/tmp/fangde-ai-update"}.log`, `${detail}\n`);
  } finally {
    process.exitCode = 1;
  }
});
