// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { FdConnectorActionResult, FdConnectorState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { resolveFeishuConnectorResources } from "./FeishuConnectorResources.ts";

const CONNECTOR_ID = "feishu" as const;
const DISPLAY_NAME = "飞书" as const;
const STATE_VERSION = 1;

interface PersistedFeishuConnectorState {
  readonly version: 1;
  readonly enabled: boolean;
  readonly lastError: string | null;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CliError {
  readonly type?: string;
  readonly subtype?: string;
  readonly message?: string;
  readonly hint?: string;
}

export class FeishuConnector extends Context.Service<
  FeishuConnector,
  {
    readonly paths: {
      readonly root: string;
      readonly skillsRoot: string;
      readonly binDir: string;
    };
    readonly getState: Effect.Effect<FdConnectorState>;
    readonly refresh: Effect.Effect<FdConnectorActionResult>;
    readonly connect: Effect.Effect<FdConnectorActionResult>;
    readonly disconnect: Effect.Effect<FdConnectorActionResult>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<FdConnectorActionResult>;
    readonly subscribe: (
      listener: (state: FdConnectorState) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/connectors/FeishuConnector") {}

function emptyState(input: {
  readonly enabled: boolean;
  readonly lastError: string | null;
  readonly message?: string | null;
  readonly busy?: boolean;
}): FdConnectorState {
  return {
    id: CONNECTOR_ID,
    displayName: DISPLAY_NAME,
    enabled: input.enabled,
    busy: input.busy ?? false,
    installState: "not_installed",
    authState: "unknown",
    cliVersion: null,
    installedCliPath: null,
    skillsRoot: null,
    skillCount: 0,
    installedSkillNames: [],
    lastError: input.lastError,
    message: input.message ?? null,
    authAction: null,
  };
}

function sanitizeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return (
    raw
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 760) || "Unknown error"
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPersistedState(path: string): Promise<PersistedFeishuConnectorState> {
  try {
    const parsed = JSON.parse(
      await NodeFSP.readFile(path, "utf8"),
    ) as Partial<PersistedFeishuConnectorState>;
    return {
      version: STATE_VERSION,
      enabled: parsed.enabled !== false,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError.slice(0, 760) : null,
    };
  } catch {
    return { version: STATE_VERSION, enabled: false, lastError: null };
  }
}

async function writePersistedState(
  path: string,
  state: PersistedFeishuConnectorState,
): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  await NodeFSP.writeFile(path, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;
    const child = NodeChildProcess.spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.on("error", (error) => {
      reject(signal.aborted ? new Error(`${command} timed out`) : error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errorChunks).toString("utf8"),
      });
    });
  });
}

async function runCommandWithOutputTap(
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
    readonly onOutput: (chunk: string) => void | Promise<void>;
  },
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;
    const child = NodeChildProcess.spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    const tap = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      void Promise.resolve(options.onOutput(text)).catch(() => undefined);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      tap(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk);
      tap(chunk);
    });
    child.on("error", (error) => {
      reject(signal.aborted ? new Error(`${command} timed out`) : error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errorChunks).toString("utf8"),
      });
    });
  });
}

function parseJsonObject(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseCliError(result: CommandResult): CliError | null {
  const parsed = parseJsonObject(result.stdout) ?? parseJsonObject(result.stderr);
  const error = parsed?.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  return error as CliError;
}

function cliFailureMessage(result: CommandResult, fallback: string): string {
  const error = parseCliError(result);
  if (error?.message) return error.message;
  if (error?.hint) return error.hint;
  if (result.stderr.trim()) return result.stderr.trim();
  if (result.stdout.trim()) return result.stdout.trim();
  return fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted|cancelled/i.test(error.message))
  );
}

function firstHttpUrl(output: string): string | null {
  return output.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
}

async function listSkillNames(skillsRoot: string): Promise<ReadonlyArray<string>> {
  try {
    const entries = await NodeFSP.readdir(skillsRoot, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("lark-")) continue;
      if (await fileExists(NodePath.join(skillsRoot, entry.name, "SKILL.md"))) {
        names.push(entry.name);
      }
    }
    return names.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function syncBundledOfficialSkills(input: {
  readonly sourceRoot: string;
  readonly skillsRoot: string;
}): Promise<void> {
  const names = await listSkillNames(input.sourceRoot);
  if (names.length === 0) throw new Error("安装包缺少飞书官方 Skills，请重新安装 FD AI。");
  await NodeFSP.mkdir(input.skillsRoot, { recursive: true, mode: 0o700 });
  for (const name of names) {
    await NodeFSP.cp(NodePath.join(input.sourceRoot, name), NodePath.join(input.skillsRoot, name), {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }
}

async function migrateLegacyConfigIfNeeded(input: {
  readonly homeDirectory: string;
  readonly configDir: string;
}): Promise<void> {
  const target = NodePath.join(input.configDir, "config.json");
  if (await fileExists(target)) return;
  const source = NodePath.join(input.homeDirectory, ".lark-cli", "config.json");
  if (!(await fileExists(source))) return;
  await NodeFSP.mkdir(input.configDir, { recursive: true, mode: 0o700 });
  await NodeFSP.cp(source, target, { force: false, errorOnExist: false });
}

export const make = Effect.fn("feishuConnector.make")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
  const primaryBackend = yield* backendPool.primary;
  const shell = yield* ElectronShell.ElectronShell;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const root = environment.path.join(environment.stateDir, "connectors", "feishu");
  const statePath = environment.path.join(root, "connector-state.json");
  const configDir = environment.path.join(root, "config");
  const skillsRoot = environment.path.join(
    environment.stateDir,
    "connectors",
    "skills",
    "connector-feishu",
  );
  const resources = resolveFeishuConnectorResources(environment);
  const binDir = resources.cliBinDir;
  const commandEnvironment = {
    ...process.env,
    LARKSUITE_CLI_CONFIG_DIR: configDir,
  };
  const listeners = new Set<(state: FdConnectorState) => Effect.Effect<void>>();
  let busy = false;
  let busyMessage: string | null = null;
  let authAction: FdConnectorState["authAction"] = null;
  let activeCommandController: AbortController | null = null;
  let activeOperation: Promise<void> | null = null;
  let cancelRequested = false;

  const persisted = () => readPersistedState(statePath);
  const persistPatch = async (patch: Partial<PersistedFeishuConnectorState>) => {
    const current = await persisted();
    await writePersistedState(statePath, { ...current, ...patch, version: STATE_VERSION });
  };

  const restartAgentRuntime = async () => {
    await Effect.runPromiseWith(context)(
      primaryBackend.stop().pipe(Effect.andThen(primaryBackend.start)),
    );
  };

  const larkCliPath = async () =>
    (await fileExists(resources.cliPath)) ? resources.cliPath : null;

  const readCliVersion = async (cliPath: string): Promise<string | null> => {
    const result = await runCommand(cliPath, ["--version"], {
      cwd: root,
      env: commandEnvironment,
      timeoutMs: 10_000,
    });
    if (result.code !== 0) return null;
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    return combined.length > 0
      ? (combined.split(/\s+/).at(-1)?.slice(0, 128) ?? combined.slice(0, 128))
      : null;
  };

  const readAuthState = async (cliPath: string): Promise<FdConnectorState["authState"]> => {
    const config = await runCommand(cliPath, ["config", "show"], {
      cwd: root,
      env: commandEnvironment,
      timeoutMs: 10_000,
    });
    if (config.code !== 0) return "not_configured";
    const statusResult = await runCommand(cliPath, ["auth", "status", "--json", "--verify"], {
      cwd: root,
      env: commandEnvironment,
      timeoutMs: 15_000,
    });
    if (statusResult.code !== 0) {
      const error = parseCliError(statusResult);
      if (
        error?.subtype === "not_configured" ||
        /not configured|not authenticated|not logged in/i.test(cliFailureMessage(statusResult, ""))
      ) {
        return "not_authenticated";
      }
      return "failed";
    }
    const parsed = parseJsonObject(statusResult.stdout);
    const identities = parsed?.identities;
    if (typeof identities !== "object" || identities === null) return "not_authenticated";
    const user = (identities as { user?: { status?: unknown; available?: unknown } }).user;
    if (user?.status === "ready" || user?.status === "needs_refresh" || user?.available === true) {
      return "authenticated";
    }
    return "not_authenticated";
  };

  const computeState = async (): Promise<FdConnectorState> => {
    const persistedState = await persisted();
    const cliPath = await larkCliPath();
    const skillNames = await listSkillNames(skillsRoot);
    if (!cliPath) {
      return emptyState({
        enabled: persistedState.enabled,
        lastError: persistedState.lastError,
        busy,
        message: busyMessage,
      });
    }
    const cliVersion = await readCliVersion(cliPath).catch(() => null);
    const authState = await readAuthState(cliPath).catch(() => "unknown" as const);
    return {
      id: CONNECTOR_ID,
      displayName: DISPLAY_NAME,
      enabled: persistedState.enabled,
      busy,
      installState: busy ? "installing" : "installed",
      authState: busy && busyMessage?.includes("授权") ? "authenticating" : authState,
      cliVersion,
      installedCliPath: cliPath,
      skillsRoot: skillNames.length > 0 ? skillsRoot : null,
      skillCount: skillNames.length,
      installedSkillNames: skillNames,
      lastError: authState === "authenticated" ? null : persistedState.lastError,
      message: busyMessage,
      authAction,
    };
  };

  const publish = async () => {
    const state = await computeState();
    for (const listener of listeners) runFork(listener(state));
    return state;
  };

  const withBusy = async <A>(message: string, operation: () => Promise<A>): Promise<A> => {
    if (busy) throw new Error("飞书连接器正在处理中，请稍后再试。");
    busy = true;
    busyMessage = message;
    authAction = null;
    let completeOperation!: () => void;
    const operationCompletion = new Promise<void>((resolve) => {
      completeOperation = resolve;
    });
    activeOperation = operationCompletion;
    const operationPromise = operation();
    try {
      await publish();
      return await operationPromise;
    } finally {
      busy = false;
      busyMessage = null;
      try {
        await publish();
      } finally {
        completeOperation();
        if (activeOperation === operationCompletion) activeOperation = null;
      }
    }
  };

  const ensureInstalled = async (): Promise<string> => {
    await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
    await NodeFSP.mkdir(configDir, { recursive: true, mode: 0o700 });
    await migrateLegacyConfigIfNeeded({
      homeDirectory: environment.homeDirectory,
      configDir,
    });
    await syncBundledOfficialSkills({
      sourceRoot: resources.skillsSourceRoot,
      skillsRoot,
    });
    const cliPath = await larkCliPath();
    if (!cliPath) throw new Error("安装包缺少飞书 CLI，请重新安装 FD AI。");
    return cliPath;
  };

  const logoutUser = async (cliPath: string): Promise<void> => {
    const logout = await runCommand(cliPath, ["auth", "logout", "--json"], {
      cwd: root,
      env: commandEnvironment,
      timeoutMs: 30_000,
    });
    if (logout.code === 0) return;

    const authState = await readAuthState(cliPath);
    if (
      authState !== "not_authenticated" &&
      authState !== "not_configured" &&
      authState !== "unknown"
    ) {
      throw new Error(cliFailureMessage(logout, "飞书账号断开失败，请稍后重试。"));
    }
  };

  const connect = async () =>
    withBusy("正在准备飞书 CLI 和官方 Skills…", async () => {
      const commandController = new AbortController();
      activeCommandController = commandController;
      cancelRequested = false;
      try {
        const cliPath = await ensureInstalled();
        await persistPatch({ enabled: true, lastError: null });
        const initialAuthState = await readAuthState(cliPath);
        if (initialAuthState === "authenticated") {
          busyMessage = "正在退出当前飞书账号…";
          await publish();
          await logoutUser(cliPath);
        }
        if (initialAuthState === "not_configured") {
          busyMessage = "正在打开飞书应用配置页面…";
          await publish();
          let openedConfigUrl: string | null = null;
          const configured = await runCommandWithOutputTap(
            cliPath,
            ["config", "init", "--new", "--lang", "zh"],
            {
              cwd: root,
              env: commandEnvironment,
              timeoutMs: 600_000,
              signal: commandController.signal,
              onOutput: async (chunk) => {
                if (openedConfigUrl) return;
                const url = firstHttpUrl(chunk);
                if (!url) return;
                openedConfigUrl = url;
                authAction = { verificationUrl: url, userCode: null };
                await shell.openExternal(url).pipe(Effect.runPromise);
                await publish();
              },
            },
          );
          if (configured.code !== 0) {
            throw new Error(configured.stderr || configured.stdout || "飞书应用配置未完成。");
          }
        }
        busyMessage = "正在发起飞书授权…";
        await publish();
        const login = await runCommand(
          cliPath,
          ["auth", "login", "--recommend", "--no-wait", "--json"],
          {
            cwd: root,
            env: commandEnvironment,
            timeoutMs: 30_000,
            signal: commandController.signal,
          },
        );
        const parsed = parseJsonObject(login.stdout);
        const verificationUrl =
          typeof parsed?.verification_url === "string"
            ? parsed.verification_url
            : typeof parsed?.verificationUrl === "string"
              ? parsed.verificationUrl
              : null;
        const deviceCode =
          typeof parsed?.device_code === "string"
            ? parsed.device_code
            : typeof parsed?.deviceCode === "string"
              ? parsed.deviceCode
              : null;
        if (verificationUrl) {
          authAction = {
            verificationUrl,
            userCode:
              typeof parsed?.user_code === "string"
                ? parsed.user_code
                : typeof parsed?.userCode === "string"
                  ? parsed.userCode
                  : null,
          };
          await shell.openExternal(verificationUrl).pipe(Effect.runPromise);
          await publish();
        }
        if (deviceCode) {
          busyMessage =
            "请在浏览器完成飞书授权；若页面提示没有 CLI 使用权限，请切换到已授权的企业账号或联系管理员。";
          await publish();
          const completed = await runCommand(
            cliPath,
            ["auth", "login", "--device-code", deviceCode],
            {
              cwd: root,
              env: commandEnvironment,
              timeoutMs: 600_000,
              signal: commandController.signal,
            },
          );
          if (completed.code !== 0)
            throw new Error(cliFailureMessage(completed, "飞书授权未完成。"));
        } else if (login.code !== 0) {
          throw new Error(cliFailureMessage(login, "飞书授权启动失败。"));
        }
        authAction = null;
        const finalAuthState = await readAuthState(cliPath);
        if (finalAuthState !== "authenticated") {
          throw new Error("飞书授权尚未完成，请在浏览器完成授权后重试。");
        }
        busyMessage = "飞书账号已连接。";
        await persistPatch({ enabled: true, lastError: null });
        await restartAgentRuntime();
        return { state: await computeState() };
      } catch (error) {
        authAction = null;
        if (cancelRequested || commandController.signal.aborted || isAbortError(error)) {
          await persistPatch({ enabled: false, lastError: null });
          return { state: await computeState() };
        }

        await persistPatch({ lastError: sanitizeMessage(error) });
        throw error;
      } finally {
        if (activeCommandController === commandController) activeCommandController = null;
      }
    });

  const disconnect = async () => {
    if (busy) {
      cancelRequested = true;
      activeCommandController?.abort();
      const operation = activeOperation;
      if (operation) {
        try {
          await operation;
        } catch {
          // The cancelled connect operation is intentionally discarded.
        }
      }
    }
    return withBusy("正在断开飞书连接…", async () => {
      const cliPath = await larkCliPath();
      if (cliPath) {
        await logoutUser(cliPath);
      }
      authAction = null;
      await persistPatch({ enabled: false, lastError: null });
      await restartAgentRuntime();
      return { state: await computeState() };
    });
  };

  return FeishuConnector.of({
    paths: { root, skillsRoot, binDir },
    getState: Effect.tryPromise(() => computeState()).pipe(Effect.orDie),
    refresh: Effect.tryPromise(async () => {
      await syncBundledOfficialSkills({
        sourceRoot: resources.skillsSourceRoot,
        skillsRoot,
      });
      await restartAgentRuntime();
      return { state: await publish() };
    }).pipe(Effect.orDie),
    connect: Effect.tryPromise(() => connect()).pipe(Effect.orDie),
    disconnect: Effect.tryPromise(() => disconnect()).pipe(Effect.orDie),
    setEnabled: (enabled) =>
      Effect.tryPromise(async () => {
        await persistPatch({ enabled, lastError: null });
        await restartAgentRuntime();
        return { state: await publish() };
      }).pipe(Effect.orDie),
    subscribe: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          listeners.add(listener);
          void publish();
          return () => listeners.delete(listener);
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(FeishuConnector, make());
