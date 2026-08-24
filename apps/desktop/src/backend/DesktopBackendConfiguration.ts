import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendManager from "./DesktopBackendManager.ts";
import { resolveFeishuConnectorResources } from "../connectors/FeishuConnectorResources.ts";
import {
  DesktopOfficeWorkspaceBoundaryError,
  prepareDesktopOfficeWorkspace,
} from "./DesktopOfficeWorkspace.ts";

const LOOPBACK_HOST = "127.0.0.1";
const RETIRED_NETWORK_ENV_NAMES = [
  "T3CODE_PORT",
  "T3CODE_MODE",
  "T3CODE_NO_BROWSER",
  "T3CODE_DESKTOP_WS_URL",
  "T3CODE_DESKTOP_LAN_ACCESS",
  "T3CODE_DESKTOP_LAN_HOST",
  "T3CODE_DESKTOP_HTTPS_ENDPOINTS",
  "T3CODE_TAILSCALE_SERVE",
  "T3CODE_TAILSCALE_SERVE_PORT",
] as const;

export class DesktopBackendObservabilitySettingsReadError extends Schema.TaggedErrorClass<DesktopBackendObservabilitySettingsReadError>()(
  "DesktopBackendObservabilitySettingsReadError",
  {
    settingsPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read persisted backend observability settings at ${this.settingsPath}.`;
  }
}

export class DesktopBackendConfiguration extends Context.Service<
  DesktopBackendConfiguration,
  {
    readonly configurePort: (port: number) => Effect.Effect<void>;
    readonly resolvePrimary: Effect.Effect<
      DesktopBackendManager.DesktopBackendStartConfig,
      PlatformError.PlatformError | DesktopOfficeWorkspaceBoundaryError
    >;
    readonly resolvePrimaryLabel: Effect.Effect<string>;
  }
>()("@t3tools/desktop/backend/DesktopBackendConfiguration") {}

interface BackendObservabilitySettings {
  readonly otlpTracesUrl: Option.Option<string>;
  readonly otlpMetricsUrl: Option.Option<string>;
}

const EMPTY_OBSERVABILITY_SETTINGS: BackendObservabilitySettings = {
  otlpTracesUrl: Option.none(),
  otlpMetricsUrl: Option.none(),
};

const childEnvPatch = (): Record<string, string | undefined> =>
  Object.fromEntries(RETIRED_NETWORK_ENV_NAMES.map((name) => [name, undefined]));

export function resolvePackagedBackendTraceEnv(input: {
  readonly isPackaged: boolean;
  readonly isDevelopment: boolean;
  readonly inheritedEnv: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const explicitTraceLevel = input.inheritedEnv.T3CODE_TRACE_MIN_LEVEL?.trim();
  if (!input.isPackaged || input.isDevelopment || explicitTraceLevel) return {};

  // Successful startup spans can produce several MB of writes while Windows
  // is also cold-reading the packaged app. Keep warnings and failures by
  // default; maintainers can still opt into Info/Debug/Trace explicitly.
  return { T3CODE_TRACE_MIN_LEVEL: "Warn" };
}

function resourceMonitorBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "t3-resource-monitor.exe" : "t3-resource-monitor";
}

function codexBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "codex.exe" : "codex";
}

const resolveBundledCodexBinaryPath = Effect.fn(
  "desktop.backendConfiguration.resolveBundledCodexBinaryPath",
)(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged) return Option.none<string>();

  return Option.some(
    environment.path.join(
      environment.resourcesPath,
      "codex",
      "bin",
      codexBinaryName(environment.platform),
    ),
  );
});

const resolveResourceMonitorPath = Effect.fn(
  "desktop.backendConfiguration.resolveResourceMonitorPath",
)(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const binaryName = resourceMonitorBinaryName(environment.platform);
  const candidates = environment.isDevelopment
    ? [
        environment.path.join(
          environment.rootDir,
          "native/resource-monitor/target/release",
          binaryName,
        ),
        environment.path.join(
          environment.rootDir,
          "native/resource-monitor/target/debug",
          binaryName,
        ),
      ]
    : environment.isPackaged
      ? [environment.path.join(environment.resourcesPath, "resource-monitor", binaryName)]
      : environment.resolveResourcePathCandidates(
          environment.path.join("resource-monitor", binaryName),
        );

  for (const candidate of candidates) {
    if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});

const readObservabilitySettings = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const raw = yield* fileSystem.readFileString(environment.serverSettingsPath).pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (cause) => {
        if (cause.reason._tag === "NotFound") return Effect.succeed(Option.none());
        const error = new DesktopBackendObservabilitySettingsReadError({
          settingsPath: environment.serverSettingsPath,
          cause,
        });
        return Effect.logWarning(error).pipe(
          Effect.annotateLogs({ component: "desktop-backend-configuration", error }),
          Effect.as(Option.none()),
        );
      },
    }),
  );
  if (Option.isNone(raw)) return EMPTY_OBSERVABILITY_SETTINGS;
  const parsed = parsePersistedServerObservabilitySettings(raw.value);
  return {
    otlpTracesUrl: Option.fromNullishOr(parsed.otlpTracesUrl),
    otlpMetricsUrl: Option.fromNullishOr(parsed.otlpMetricsUrl),
  };
});

const observabilityFragment = (settings: BackendObservabilitySettings) => ({
  ...Option.match(settings.otlpTracesUrl, {
    onNone: () => ({}),
    onSome: (otlpTracesUrl) => ({ otlpTracesUrl }),
  }),
  ...Option.match(settings.otlpMetricsUrl, {
    onNone: () => ({}),
    onSome: (otlpMetricsUrl) => ({ otlpMetricsUrl }),
  }),
});

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const portRef = yield* SynchronizedRef.make(Option.none<number>());
  const tokenRef = yield* SynchronizedRef.make(Option.none<string>());

  const getOrCreateBootstrapToken = SynchronizedRef.modifyEffect(tokenRef, (current) =>
    Option.match(current, {
      onSome: (token) => Effect.succeed([token, current] as const),
      onNone: () =>
        crypto.randomBytes(24).pipe(
          Effect.map((bytes) => {
            const token = Encoding.encodeHex(bytes);
            return [token, Option.some(token)] as const;
          }),
        ),
    }),
  );

  const resolvePrimary = Effect.gen(function* () {
    const port = Option.getOrThrowWith(
      yield* SynchronizedRef.get(portRef),
      () => new Error("Desktop backend port was not configured before start."),
    );
    const bootstrapToken = yield* getOrCreateBootstrapToken;
    const observabilitySettings = yield* readObservabilitySettings.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    );
    const resourceMonitorPath = yield* resolveResourceMonitorPath().pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    );
    const bundledCodexBinaryPath = yield* resolveBundledCodexBinaryPath().pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    );
    const officeWorkspaceRoot = yield* prepareDesktopOfficeWorkspace().pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    );
    const taskWorkspaceRoot = environment.path.join(environment.homeDirectory, "FangdeAI", "Tasks");
    const connectorRoot = environment.path.join(environment.stateDir, "connectors");
    const feishuConnectorRoot = environment.path.join(connectorRoot, "feishu");
    const feishuConnectorResources = resolveFeishuConnectorResources(environment);
    const feishuConnectorSkillsRoot = environment.path.join(
      connectorRoot,
      "skills",
      "connector-feishu",
    );
    const feishuConnectorBinPath = feishuConnectorResources.cliBinDir;
    const httpBaseUrl = new URL(`http://${LOOPBACK_HOST}:${String(port)}`);
    return {
      executablePath: process.execPath,
      args: [
        environment.backendEntryPath,
        "--bootstrap-fd",
        "3",
        "--auto-bootstrap-project-from-cwd",
      ],
      entryPath: environment.backendEntryPath,
      cwd: officeWorkspaceRoot,
      env: {
        ...childEnvPatch(),
        ...resolvePackagedBackendTraceEnv({
          isPackaged: environment.isPackaged,
          isDevelopment: environment.isDevelopment,
          inheritedEnv: process.env,
        }),
        ELECTRON_RUN_AS_NODE: "1",
        ...Option.match(bundledCodexBinaryPath, {
          onNone: () => ({}),
          onSome: (value) => ({ FD_CODEX_BINARY: value }),
        }),
      },
      extendEnv: true,
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port,
        t3Home: environment.baseDir,
        taskWorkspaceRoot,
        host: LOOPBACK_HOST,
        desktopBootstrapToken: bootstrapToken,
        desktopTelemetryFd: 4,
        desktopTelemetryControlFd: 5,
        fdRuntimeCredentialFd: 6,
        fdConnectorSkillsRoot: feishuConnectorSkillsRoot,
        fdConnectorBinPath: feishuConnectorBinPath,
        fdConnectorConfigDir: environment.path.join(feishuConnectorRoot, "config"),
        fdConnectorStatePath: environment.path.join(feishuConnectorRoot, "connector-state.json"),
        ...Option.match(resourceMonitorPath, {
          onNone: () => ({}),
          onSome: (value) => ({ resourceMonitorPath: value }),
        }),
        ...observabilityFragment(observabilitySettings),
      },
      bootstrapDelivery: "fd3",
      httpBaseUrl,
      captureOutput: true,
      preflightFailure: Option.none(),
    } satisfies DesktopBackendManager.DesktopBackendStartConfig;
  }).pipe(Effect.withSpan("desktop.backendConfiguration.resolvePrimary"));

  return DesktopBackendConfiguration.of({
    configurePort: (port) => SynchronizedRef.set(portRef, Option.some(port)),
    resolvePrimary,
    resolvePrimaryLabel: Effect.succeed("Local environment"),
  });
});

export const layer = Layer.effect(DesktopBackendConfiguration, make);
