/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const DEFAULT_PORT = 3773;
export const LOOPBACK_HOST = "127.0.0.1" as const;
const LOOPBACK_HOSTNAMES = new Set([LOOPBACK_HOST, "::1", "localhost"]);

export const isLoopbackHostname = (hostname: string): boolean =>
  LOOPBACK_HOSTNAMES.has(
    hostname
      .trim()
      .toLowerCase()
      .replace(/^\[(.*)\]$/, "$1"),
  );

export const isLoopbackHttpUrl = (url: URL): boolean =>
  (url.protocol === "http:" || url.protocol === "https:") &&
  url.origin !== "null" &&
  isLoopbackHostname(url.hostname);

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly keybindingsConfigPath: string;
  readonly settingsPath: string;
  readonly providerStatusCacheDir: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  /** Provider-neutral root for read-only T3 workflow script inspection. */
  readonly workflowScriptsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  readonly secretsDir: string;
}

export interface DeriveServerPathsOptions {
  readonly baseDirIsExplicit?: boolean;
}

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends Context.Service<
  ServerConfig,
  ServerDerivedPaths & {
    readonly logLevel: LogLevel.LogLevel;
    readonly traceMinLevel: LogLevel.LogLevel;
    readonly traceTimingEnabled: boolean;
    readonly traceBatchWindowMs: number;
    readonly traceMaxBytes: number;
    readonly traceMaxFiles: number;
    readonly otlpTracesUrl: string | undefined;
    readonly otlpMetricsUrl: string | undefined;
    readonly otlpExportIntervalMs: number;
    readonly otlpServiceName: string;
    readonly mode: RuntimeMode;
    readonly port: number;
    readonly host: typeof LOOPBACK_HOST;
    readonly cwd: string;
    readonly baseDir: string;
    readonly staticDir: string | undefined;
    readonly devUrl: URL | undefined;
    readonly noBrowser: boolean;
    readonly desktopBootstrapToken: string | undefined;
    readonly developmentBootstrapToken?: string | undefined;
    readonly desktopTelemetryFd?: number | undefined;
    readonly desktopTelemetryControlFd?: number | undefined;
    readonly fdRuntimeCredentialFd?: number | undefined;
    readonly resourceMonitorPath?: string | undefined;
    readonly fdConnectorSkillsRoot?: string | undefined;
    readonly fdConnectorBinPath?: string | undefined;
    readonly fdConnectorConfigDir?: string | undefined;
    readonly fdConnectorStatePath?: string | undefined;
    readonly fdPresentationSkillRoot?: string | undefined;
    readonly autoBootstrapProjectFromCwd: boolean;
    readonly taskWorkspaceRoot?: string | undefined;
    readonly logWebSocketEvents: boolean;
  }
>()("t3/config/ServerConfig") {
  /** @deprecated Import and use `layerTest` from this module. */
  static readonly layerTest = (
    cwd: string,
    baseDirOrPrefix: string | { readonly prefix: string },
  ) => layerTest(cwd, baseDirOrPrefix);
}

export const make = (config: ServerConfig["Service"]) => ServerConfig.of(config);

export const layer = (config: ServerConfig["Service"]) => Layer.succeed(ServerConfig, make(config));

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfig["Service"]["baseDir"],
  devUrl: ServerConfig["Service"]["devUrl"],
  options: DeriveServerPathsOptions = {},
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(
    baseDir,
    devUrl !== undefined && !options.baseDirIsExplicit ? "dev" : "userdata",
  );
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const workflowScriptsDir = join(stateDir, "workflow-scripts");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  const providerStatusCacheDir = join(baseDir, "caches");
  return {
    stateDir,
    dbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    settingsPath: join(stateDir, "settings.json"),
    providerStatusCacheDir,
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    workflowScriptsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(stateDir, "environment-id"),
    secretsDir: join(stateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (derivedPaths: ServerDerivedPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Effect.all(
    [
      fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.workflowScriptsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
      fs.makeDirectory(derivedPaths.providerStatusCacheDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );
});

const makeTest = Effect.fn("ServerConfig.makeTest")(function* (
  cwd: string,
  baseDirOrPrefix: string | { readonly prefix: string },
) {
  const devUrl = undefined;
  const fs = yield* FileSystem.FileSystem;
  const baseDir =
    typeof baseDirOrPrefix === "string"
      ? baseDirOrPrefix
      : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
  const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
  yield* ensureServerDirectories(derivedPaths);

  return ServerConfig.of({
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server",
    cwd,
    baseDir,
    ...derivedPaths,
    mode: "web",
    autoBootstrapProjectFromCwd: false,
    taskWorkspaceRoot: undefined,
    logWebSocketEvents: false,
    port: 0,
    host: LOOPBACK_HOST,
    desktopBootstrapToken: undefined,
    developmentBootstrapToken: undefined,
    desktopTelemetryFd: undefined,
    desktopTelemetryControlFd: undefined,
    fdRuntimeCredentialFd: undefined,
    resourceMonitorPath: undefined,
    fdConnectorSkillsRoot: undefined,
    fdConnectorBinPath: undefined,
    fdConnectorConfigDir: undefined,
    fdConnectorStatePath: undefined,
    fdPresentationSkillRoot: undefined,
    staticDir: undefined,
    devUrl,
    noBrowser: false,
  });
});

export const layerTest = (cwd: string, baseDirOrPrefix: string | { readonly prefix: string }) =>
  Layer.effect(ServerConfig, makeTest(cwd, baseDirOrPrefix));

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;
  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});
