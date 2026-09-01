// @effect-diagnostics nodeBuiltinImport:off - This adapter must outlive Electron and use detached native processes.
// @effect-diagnostics globalDate:off globalDateInEffect:off globalTimers:off - Authorization readiness is coordinated outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const EXPECTED_BUNDLE_ID = "com.fdsure.enterprise-ai";
const HELPER_NAME = "mac-internal-updater-helper.mjs";
const ELEVATED_SCRIPT_NAME = "mac-internal-updater-elevated.applescript";
const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

const UpdateTransactionSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["prepared", "authorized", "installed", "rolled_back"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  parentPid: Schema.Number,
  expectedVersion: Schema.String,
  expectedArch: Schema.Literals(["arm64", "x86_64"]),
  appBundleName: Schema.String,
  transactionRoot: Schema.String,
  currentAppPath: Schema.String,
  stagedAppPath: Schema.String,
  backupAppPath: Schema.String,
  temporaryAppPath: Schema.String,
  readyMarkerPath: Schema.String,
  startedMarkerPath: Schema.String,
  detail: Schema.optional(Schema.String),
});
export type UpdateTransaction = typeof UpdateTransactionSchema.Type;

const decodeUpdateTransaction = Schema.decodeUnknownSync(UpdateTransactionSchema);
const STALE_TRANSACTION_AGE_MS = 10 * 60 * 1_000;

export class MacInternalUpdateError extends Schema.TaggedErrorClass<MacInternalUpdateError>()(
  "MacInternalUpdateError",
  {
    stage: Schema.Literals(["prepare", "extract", "validate", "authorize", "recover"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `macOS internal update failed during ${this.stage}.`;
  }
}

export class MacInternalUpdater extends Context.Service<
  MacInternalUpdater,
  {
    readonly recover: Effect.Effect<void>;
    readonly confirmStartup: Effect.Effect<void>;
    readonly install: (input: {
      readonly archivePath: string;
      readonly expectedVersion: string;
    }) => Effect.Effect<void, MacInternalUpdateError>;
  }
>()("@t3tools/desktop/updates/MacInternalUpdater") {}

export function resolveMacAppBundlePath(resourcesPath: string): string | null {
  const contentsPath = NodePath.dirname(resourcesPath);
  const appPath = NodePath.dirname(contentsPath);
  return NodePath.extname(appPath) === ".app" ? appPath : null;
}

async function command(
  command: string,
  args: readonly string[],
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
}> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function plistValue(appPath: string, key: string): Promise<string> {
  const result = await command("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    NodePath.join(appPath, "Contents", "Info.plist"),
  ]);
  return result.stdout.trim();
}

async function validateBundle(input: {
  readonly appPath: string;
  readonly expectedVersion: string;
  readonly expectedArch: "arm64" | "x86_64";
  readonly requireAdHoc: boolean;
}): Promise<void> {
  const stat = await NodeFSP.lstat(input.appPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid app bundle type");
  if ((await plistValue(input.appPath, "CFBundleIdentifier")) !== EXPECTED_BUNDLE_ID) {
    throw new Error("Unexpected app bundle identifier");
  }
  if ((await plistValue(input.appPath, "CFBundleShortVersionString")) !== input.expectedVersion) {
    throw new Error("Unexpected app bundle version");
  }
  const executable = await plistValue(input.appPath, "CFBundleExecutable");
  const architectures = (
    await command("/usr/bin/lipo", [
      "-archs",
      NodePath.join(input.appPath, "Contents", "MacOS", executable),
    ])
  ).stdout
    .trim()
    .split(/\s+/);
  if (!architectures.includes(input.expectedArch)) throw new Error("Unexpected app architecture");
  await command("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    input.appPath,
  ]);
  if (input.requireAdHoc) {
    const detail = await command("/usr/bin/codesign", ["-dv", "--verbose=4", input.appPath]);
    if (!`${detail.stdout}\n${detail.stderr}`.includes("Signature=adhoc")) {
      throw new Error("Expected an ad-hoc signed internal build");
    }
  }
}

async function findExtractedApp(extractedRoot: string): Promise<string> {
  const entries = await NodeFSP.readdir(extractedRoot, { withFileTypes: true });
  const apps = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (apps.length !== 1) throw new Error("Update archive must contain exactly one app bundle");
  return NodePath.join(extractedRoot, apps[0]!.name);
}

async function canReplaceDirectly(currentAppPath: string): Promise<boolean> {
  try {
    await NodeFSP.access(NodePath.dirname(currentAppPath), NodeFS.constants.W_OK);
    await NodeFSP.access(currentAppPath, NodeFS.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function waitForReady(
  child: NodeChildProcess.ChildProcess,
  readyMarkerPath: string,
  timeoutMs = 120_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (code: number | null) =>
      finish(new Error(`Updater helper exited before authorization (${String(code)})`));
    child.once("exit", onExit);
    const interval = setInterval(() => {
      void NodeFSP.access(readyMarkerPath)
        .then(() => finish())
        .catch(() => {
          if (Date.now() - startedAt >= timeoutMs) {
            finish(new Error("Timed out waiting for updater authorization"));
          }
        });
    }, 200);
  });
}

async function writeTransaction(path: string, transaction: UpdateTransaction): Promise<void> {
  await NodeFSP.writeFile(path, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
}

async function readTransaction(path: string): Promise<UpdateTransaction> {
  return decodeUpdateTransaction(JSON.parse(await NodeFSP.readFile(path, "utf8")));
}

export function isSafeMacUpdateTransactionPaths(
  transaction: UpdateTransaction,
  transactionRoot: string,
  currentAppPath: string,
): boolean {
  const root = NodePath.resolve(transactionRoot);
  const current = NodePath.resolve(currentAppPath);
  const staged = NodePath.resolve(transaction.stagedAppPath);
  const backup = NodePath.resolve(transaction.backupAppPath);
  const temporary = NodePath.resolve(transaction.temporaryAppPath);
  const readyMarker = NodePath.resolve(transaction.readyMarkerPath);
  const startedMarker = NodePath.resolve(transaction.startedMarkerPath);

  return (
    NodePath.resolve(transaction.transactionRoot) === root &&
    NodePath.basename(root) === `transaction-${transaction.id}` &&
    NodePath.resolve(transaction.currentAppPath) === current &&
    transaction.appBundleName === NodePath.basename(current) &&
    staged.startsWith(`${root}${NodePath.sep}`) &&
    staged.endsWith(".app") &&
    backup === `${current}.fd-backup-${transaction.id}` &&
    temporary === `${current}.fd-new-${transaction.id}` &&
    readyMarker === NodePath.join(root, "authorized") &&
    startedMarker === NodePath.join(root, "started")
  );
}

async function recoverTransactions(
  updatesRoot: string,
  currentVersion: string,
  currentAppPath: string | null,
): Promise<void> {
  const entries = await NodeFSP.readdir(updatesRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("transaction-")) continue;
    const root = NodePath.join(updatesRoot, entry.name);
    const transactionPath = NodePath.join(root, "transaction.json");
    try {
      const transaction = await readTransaction(transactionPath);
      if (!currentAppPath || !isSafeMacUpdateTransactionPaths(transaction, root, currentAppPath)) {
        continue;
      }
      const installedCurrentVersion =
        transaction.currentAppPath === currentAppPath
          ? await plistValue(currentAppPath, "CFBundleShortVersionString").catch(() => null)
          : null;
      if (
        transaction.status === "installed" &&
        transaction.expectedVersion === currentVersion &&
        installedCurrentVersion === currentVersion
      ) {
        const createdAt = Date.parse(transaction.createdAt);
        if (Number.isFinite(createdAt) && Date.now() - createdAt >= STALE_TRANSACTION_AGE_MS) {
          await NodeFSP.rm(transaction.backupAppPath, { recursive: true, force: true });
          await NodeFSP.rm(root, { recursive: true, force: true });
        }
        continue;
      }
      if (transaction.status === "rolled_back") {
        await NodeFSP.rm(transaction.temporaryAppPath, { recursive: true, force: true });
        await NodeFSP.rm(root, { recursive: true, force: true });
        continue;
      }
      const createdAt = Date.parse(transaction.createdAt);
      if (
        (transaction.status === "prepared" || transaction.status === "authorized") &&
        Number.isFinite(createdAt) &&
        Date.now() - createdAt >= STALE_TRANSACTION_AGE_MS
      ) {
        await NodeFSP.rm(transaction.temporaryAppPath, { recursive: true, force: true });
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    } catch {
      // A malformed record is retained for support inspection instead of deleting unknown paths.
    }
  }
}

export async function confirmMacInstalledStartup(
  updatesRoot: string,
  currentVersion: string,
  currentAppPath: string | null,
): Promise<void> {
  if (!currentAppPath) return;
  const entries = await NodeFSP.readdir(updatesRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || !entry.name.startsWith("transaction-")) return;
      const root = NodePath.join(updatesRoot, entry.name);
      try {
        const transaction = await readTransaction(NodePath.join(root, "transaction.json"));
        if (
          transaction.status === "installed" &&
          transaction.expectedVersion === currentVersion &&
          transaction.currentAppPath === currentAppPath &&
          isSafeMacUpdateTransactionPaths(transaction, root, currentAppPath)
        ) {
          await NodeFSP.writeFile(transaction.startedMarkerPath, "started\n", { mode: 0o600 });
        }
      } catch {
        // Startup confirmation is best effort; the helper retains the backup on failure.
      }
    }),
  );
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const updatesRoot = NodePath.join(environment.stateDir, "desktop-updates");
  const currentAppPath = resolveMacAppBundlePath(environment.resourcesPath);

  return MacInternalUpdater.of({
    recover:
      environment.platform === "darwin" && environment.isPackaged
        ? Effect.promise(() =>
            recoverTransactions(updatesRoot, environment.appVersion, currentAppPath),
          ).pipe(Effect.ignore)
        : Effect.void,
    confirmStartup:
      environment.platform === "darwin" && environment.isPackaged
        ? Effect.promise(() =>
            confirmMacInstalledStartup(updatesRoot, environment.appVersion, currentAppPath),
          ).pipe(Effect.ignore)
        : Effect.void,
    install: ({ archivePath, expectedVersion }) =>
      Effect.tryPromise({
        try: async () => {
          if (environment.platform !== "darwin" || !environment.isPackaged || !currentAppPath) {
            throw new Error("Internal macOS updater requires a packaged app bundle");
          }
          if (!NodePath.isAbsolute(archivePath) || NodePath.extname(archivePath) !== ".zip") {
            throw new Error("Downloaded update is not an absolute ZIP path");
          }
          const expectedArch = environment.runtimeInfo.hostArch === "arm64" ? "arm64" : "x86_64";
          await NodeFSP.mkdir(updatesRoot, { recursive: true, mode: 0o700 });
          const transactionRoot = await NodeFSP.mkdtemp(NodePath.join(updatesRoot, "transaction-"));
          await NodeFSP.chmod(transactionRoot, 0o700);
          const id = NodePath.basename(transactionRoot).slice("transaction-".length);
          const extractedRoot = NodePath.join(transactionRoot, "extracted");
          await NodeFSP.mkdir(extractedRoot, { mode: 0o700 });
          await command("/usr/bin/ditto", ["-x", "-k", archivePath, extractedRoot]);
          const stagedAppPath = await findExtractedApp(extractedRoot);
          await validateBundle({
            appPath: stagedAppPath,
            expectedVersion,
            expectedArch,
            requireAdHoc: true,
          });

          const transactionPath = NodePath.join(transactionRoot, "transaction.json");
          const readyMarkerPath = NodePath.join(transactionRoot, "authorized");
          const startedMarkerPath = NodePath.join(transactionRoot, "started");
          const transaction: UpdateTransaction = {
            id,
            status: "prepared",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            parentPid: NodeProcess.pid,
            expectedVersion,
            expectedArch,
            appBundleName: NodePath.basename(currentAppPath),
            transactionRoot,
            currentAppPath,
            stagedAppPath,
            backupAppPath: `${currentAppPath}.fd-backup-${id}`,
            temporaryAppPath: `${currentAppPath}.fd-new-${id}`,
            readyMarkerPath,
            startedMarkerPath,
          };
          await writeTransaction(transactionPath, transaction);

          const helperPath = NodePath.join(environment.resourcesPath, "updater", HELPER_NAME);
          const elevatedScriptPath = NodePath.join(
            environment.resourcesPath,
            "updater",
            ELEVATED_SCRIPT_NAME,
          );
          await Promise.all([NodeFSP.access(helperPath), NodeFSP.access(elevatedScriptPath)]);
          const direct = await canReplaceDirectly(currentAppPath);
          const child = direct
            ? NodeChildProcess.spawn(NodeProcess.execPath, [helperPath, transactionPath], {
                detached: true,
                stdio: "ignore",
                env: { ...NodeProcess.env, ELECTRON_RUN_AS_NODE: "1" },
              })
            : NodeChildProcess.spawn(
                "/usr/bin/osascript",
                [elevatedScriptPath, NodeProcess.execPath, helperPath, transactionPath],
                { detached: true, stdio: "ignore" },
              );
          await waitForReady(child, readyMarkerPath);
          child.unref();
        },
        catch: (cause) =>
          new MacInternalUpdateError({
            stage:
              cause instanceof Error && cause.message.includes("authorization")
                ? "authorize"
                : cause instanceof Error && cause.message.includes("archive")
                  ? "extract"
                  : "validate",
            cause,
          }),
      }),
  });
});

export const layer = Layer.effect(MacInternalUpdater, make);
