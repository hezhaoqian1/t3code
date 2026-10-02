import { CommandId, EventId, type ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { flushCompileCache } from "./compileCache.ts";

import * as ServerConfig from "./config.ts";
import { FD_DEEPSEEK_MODEL_SELECTION } from "./fd-agent/FdModelPolicy.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationReactor from "./orchestration/Services/OrchestrationReactor.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ProviderSessionReaper from "./provider/Services/ProviderSessionReaper.ts";
import { forkParked } from "./serverActivation.ts";

export class ServerRuntimeStartupError extends Schema.TaggedErrorClass<ServerRuntimeStartupError>()(
  "ServerRuntimeStartupError",
  {
    mode: ServerConfig.RuntimeMode,
    host: Schema.NullOr(Schema.String),
    port: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Server runtime startup failed before command readiness.";
  }
}

export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  {
    readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
    readonly markHttpListening: Effect.Effect<void>;
    readonly enqueueCommand: <A, E>(
      effect: Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
  }
>()("t3/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

export const makeCommandGate = Effect.gen(function* () {
  const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
  const commandQueue = yield* Queue.unbounded<QueuedCommand>();
  const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");

  const commandWorker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
  );
  yield* Effect.forkScoped(commandWorker);

  return {
    awaitCommandReady: Deferred.await(commandReady),
    signalCommandReady: Effect.gen(function* () {
      yield* Ref.set(commandReadinessState, "ready");
      yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
    }),
    failCommandReady: (error) =>
      Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, error);
        yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
      }),
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const readinessState = yield* Ref.get(commandReadinessState);
        if (readinessState === "ready") {
          return yield* effect;
        }
        if (readinessState !== "pending") {
          return yield* readinessState;
        }

        const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
        yield* Queue.offer(commandQueue, {
          run: Deferred.await(commandReady).pipe(
            Effect.flatMap(() => effect),
            Effect.exit,
            Effect.flatMap((exit) => settleQueuedCommand(result, exit)),
          ),
        });
        return yield* Deferred.await(result);
      }),
  } satisfies CommandGate;
});

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService.AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getCounts().pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup projection counts for telemetry", {
        cause,
      }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

export const launchStartupHeartbeat = recordStartupHeartbeat.pipe(
  Effect.annotateSpans({ "startup.phase": "heartbeat.record" }),
  Effect.withSpan("server.startup.heartbeat.record"),
  Effect.ignoreCause({ log: true }),
  Effect.forkScoped,
  Effect.asVoid,
);

export const getAutoBootstrapDefaultModelSelection = (): ModelSelection =>
  FD_DEEPSEEK_MODEL_SELECTION;

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

export const resolveAutoBootstrapWelcomeTargets = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const path = yield* Path.Path;

  let bootstrapProjectId: ProjectId | undefined;

  if (serverConfig.autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
        serverConfig.cwd,
      );
      let nextProjectId: ProjectId;

      if (Option.isNone(existingProject)) {
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        nextProjectId = ProjectId.make(yield* randomUUID);
        const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
        const nextProjectDefaultModelSelection = getAutoBootstrapDefaultModelSelection();
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(yield* randomUUID),
          projectId: nextProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: serverConfig.cwd,
          projectPurpose: "workspace",
          defaultModelSelection: nextProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        nextProjectId = existingProject.value.id;
      }

      bootstrapProjectId = nextProjectId;
    });
  }

  return {
    ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
  } as const;
});

export const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  if (serverConfig.devUrl && ServerConfig.isLoopbackHttpUrl(serverConfig.devUrl)) {
    return serverConfig.devUrl.toString();
  }
  return serverConfig.mode === "desktop"
    ? `http://${ServerConfig.LOOPBACK_HOST}:${serverConfig.port}`
    : undefined;
});

const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    if (serverConfig.noBrowser) {
      return;
    }
    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;

    yield* externalLauncher.launchBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("browser auto-open unavailable", {
          hint: `Open ${target} in your browser.`,
        }),
      ),
    );
  });

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

export const INTERRUPTED_SESSION_ERROR = "应用重启后，AI 会话已中断。发送新消息即可继续。";
export const CONTINUATION_FAILED_ERROR = "应用重启后未能自动继续这个任务。发送新消息即可继续。";
/** Marks a session whose cut-off turn is being resumed; survives another restart. */
export const RESTART_CONTINUATION_KEY = "continueAfterServerUpdate";
const RESTART_CONTINUATION_PROMPT = "应用刚刚重启，请从中断的地方继续完成上一个任务。";
export const RESTART_CONTINUATION_ACTIVITY_KIND = "session.continued-after-restart";
/**
 * An interruption older than this is not resumed: an employee reopening the
 * app days later should not find yesterday's task starting up again.
 */
export const RESTART_CONTINUATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

class ProviderSessionContinuationError extends Schema.TaggedErrorClass<ProviderSessionContinuationError>()(
  "ProviderSessionContinuationError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Could not continue thread '${this.threadId}': the provider instance is missing.`;
  }
}

function readRuntimePayload(runtimePayload: unknown): Record<string, unknown> {
  return runtimePayload !== null &&
    typeof runtimePayload === "object" &&
    !Array.isArray(runtimePayload)
    ? (runtimePayload as Record<string, unknown>)
    : {};
}

function readRestartContinuationTurnId(runtimePayload: unknown): string | null {
  const value = readRuntimePayload(runtimePayload)[RESTART_CONTINUATION_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function latestTimestampMs(values: ReadonlyArray<string | undefined>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    if (value === undefined) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) continue;
    latest = latest === null ? parsed : Math.max(latest, parsed);
  }
  return latest;
}

/**
 * A provider process does not survive the local service stopping, so a turn
 * that was running when it stopped would spin forever. On startup each such
 * task either resumes (setting on, recent, resumable) or settles with an
 * error that tells the employee to send a new message.
 */
export const reconcileProviderSessions = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const providerService = yield* ProviderService.ProviderService;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const continueAfterRestart = yield* serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.continueThreadsAfterServerUpdate),
    Effect.catch((cause) =>
      Effect.logWarning("could not read restart continuation preference", { cause }).pipe(
        Effect.as(false),
      ),
    ),
  );
  const liveThreadIds = new Set(
    (yield* providerService.listSessions()).map((session) => session.threadId),
  );
  const bindings = new Map(
    (yield* directory
      .listBindings()
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to list provider session bindings", { cause }).pipe(
            Effect.as([]),
          ),
        ),
      )).map((binding) => [binding.threadId, binding] as const),
  );
  const { threads } = yield* query.getCommandReadModel();
  const nowMs = DateTime.toEpochMillis(yield* DateTime.now);

  const orphanedThreads = threads.filter(
    (thread) =>
      thread.session !== null &&
      !liveThreadIds.has(thread.id) &&
      (thread.session.status === "starting" ||
        thread.session.status === "running" ||
        thread.session.activeTurnId !== null),
  );

  for (const thread of orphanedThreads) {
    const session = thread.session;
    if (session === null) continue;
    const binding = bindings.get(thread.id);
    const pendingContinuationTurnId = binding
      ? readRestartContinuationTurnId(binding.runtimePayload)
      : null;
    const interruptedAtMs = latestTimestampMs([
      binding?.lastSeenAt,
      session.updatedAt,
      thread.updatedAt,
    ]);
    const recent =
      interruptedAtMs !== null && nowMs - interruptedAtMs <= RESTART_CONTINUATION_MAX_AGE_MS;
    // A running turn was cut off; a starting session with a marker is a
    // continuation that this process prepared but never got to send.
    const interruptedTurnId =
      session.status === "running" && session.activeTurnId !== null
        ? session.activeTurnId
        : session.status === "starting"
          ? pendingContinuationTurnId
          : null;
    const resumable =
      continueAfterRestart &&
      recent &&
      interruptedTurnId !== null &&
      binding !== undefined &&
      binding.resumeCursor != null &&
      thread.archivedAt === null &&
      thread.deletedAt === null;

    const settleAsError = (lastError: string) =>
      Effect.gen(function* () {
        if (binding) {
          yield* directory
            .upsert({
              threadId: binding.threadId,
              provider: binding.provider,
              ...(binding.providerInstanceId !== undefined
                ? { providerInstanceId: binding.providerInstanceId }
                : {}),
              status: "stopped",
              runtimePayload: { activeTurnId: null, [RESTART_CONTINUATION_KEY]: null },
            })
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                  ? Effect.failCause(cause)
                  : Effect.logWarning(
                      "failed to reconcile orphaned provider session directory binding",
                      { threadId: thread.id, cause },
                    ),
              ),
            );
        }
        yield* Effect.gen(function* () {
          const reconciledAt = DateTime.formatIso(yield* DateTime.now);
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
            threadId: thread.id,
            session: {
              ...session,
              status: "error",
              activeTurnId: null,
              lastError,
              updatedAt: reconciledAt,
            },
            createdAt: reconciledAt,
          });
        }).pipe(
          Effect.retry({ times: 1 }),
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("failed to settle orphaned provider session projection", {
                  threadId: thread.id,
                  cause,
                }),
          ),
        );
      });

    if (!resumable || binding === undefined || interruptedTurnId === null) {
      yield* settleAsError(INTERRUPTED_SESSION_ERROR);
      continue;
    }

    const prepared = yield* Effect.gen(function* () {
      // The marker keeps the continuation durable if this process also
      // stops before the provider accepts the resumed turn.
      yield* directory.upsert({
        threadId: binding.threadId,
        provider: binding.provider,
        ...(binding.providerInstanceId !== undefined
          ? { providerInstanceId: binding.providerInstanceId }
          : {}),
        status: "starting",
        runtimePayload: { activeTurnId: null, [RESTART_CONTINUATION_KEY]: interruptedTurnId },
      });
      const resumedAt = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrationEngine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make(yield* crypto.randomUUIDv4),
        threadId: thread.id,
        session: {
          ...session,
          status: "starting",
          activeTurnId: null,
          lastError: null,
          updatedAt: resumedAt,
        },
        createdAt: resumedAt,
      });
    }).pipe(Effect.retry({ times: 1 }), Effect.exit);
    if (Exit.isFailure(prepared)) {
      if (Cause.hasInterrupts(prepared.cause)) return yield* Effect.failCause(prepared.cause);
      yield* Effect.logWarning("failed to prepare provider session continuation", {
        threadId: thread.id,
        cause: prepared.cause,
      });
      yield* settleAsError(INTERRUPTED_SESSION_ERROR);
      continue;
    }

    // Parked until the server is ready, so ingestion sees the resumed turn.
    yield* forkParked(
      Effect.gen(function* () {
        const continuation = Effect.gen(function* () {
          const providerInstanceId = binding.providerInstanceId;
          if (providerInstanceId === undefined) {
            return yield* new ProviderSessionContinuationError({ threadId: thread.id });
          }
          const capabilities = yield* providerService.getCapabilities(providerInstanceId);
          return yield* providerService.sendTurn({
            threadId: thread.id,
            ...(capabilities.promptlessTurnContinuation === true
              ? { continuation: true }
              : { input: RESTART_CONTINUATION_PROMPT }),
            interactionMode: thread.interactionMode,
          });
        });
        const continuationExit = yield* Effect.exit(continuation);
        if (Exit.isSuccess(continuationExit)) {
          yield* Effect.logInfo("continued provider session after restart", {
            threadId: thread.id,
            interruptedTurnId,
            turnId: continuationExit.value.turnId,
          });
          const continuedAt = DateTime.formatIso(yield* DateTime.now);
          yield* orchestrationEngine
            .dispatch({
              type: "thread.activity.append",
              commandId: CommandId.make(yield* crypto.randomUUIDv4),
              threadId: thread.id,
              activity: {
                id: EventId.make(yield* crypto.randomUUIDv4),
                tone: "info",
                kind: RESTART_CONTINUATION_ACTIVITY_KIND,
                summary: "应用重启后已自动继续任务",
                payload: { interruptedTurnId },
                turnId: continuationExit.value.turnId,
                createdAt: continuedAt,
              },
              createdAt: continuedAt,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          return;
        }
        if (Cause.hasInterrupts(continuationExit.cause)) return;
        yield* Effect.logWarning("failed to continue provider session after restart", {
          threadId: thread.id,
          cause: continuationExit.cause,
        });
        yield* settleAsError(CONTINUATION_FAILED_ERROR).pipe(Effect.ignoreCause);
      }),
    );
  }
}).pipe(
  Effect.catchCause((cause) =>
    Cause.hasInterrupts(cause)
      ? Effect.failCause(cause)
      : Effect.logWarning("provider session startup reconciliation failed", { cause }),
  ),
);

interface StartupOptions {
  readonly activate?: Effect.Effect<void>;
  readonly awaitAuxiliaryParked?: Effect.Effect<void>;
  readonly abort?: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
}

export const make = (options?: StartupOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const keybindings = yield* Keybindings.Keybindings;
    const orchestrationReactor = yield* OrchestrationReactor.OrchestrationReactor;
    const providerSessionReaper = yield* ProviderSessionReaper.ProviderSessionReaper;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const crypto = yield* Crypto.Crypto;

    const commandGate = yield* makeCommandGate;
    const httpListening = yield* Deferred.make<void>();
    const reactorScope = yield* Scope.make("sequential");

    yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

    const startup = Effect.gen(function* () {
      yield* Effect.logDebug("startup phase: starting keybindings runtime");
      yield* runStartupPhase(
        "keybindings.start",
        keybindings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start keybindings runtime", {
              path: error.configPath,
              detail: error.detail,
              cause: error.cause,
            }),
          ),
        ),
      );

      yield* Effect.logDebug("startup phase: starting server settings runtime");
      yield* runStartupPhase(
        "settings.start",
        serverSettings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start server settings runtime", {
              path: error.settingsPath,
              operation: error.operation,
              providerInstanceId: error.providerInstanceId,
              environmentVariable: error.environmentVariable,
              cause: error.cause,
            }),
          ),
        ),
      );

      yield* Effect.logDebug("startup phase: parking orchestration roots at activation");
      yield* runStartupPhase(
        "reactors.start",
        Effect.gen(function* () {
          yield* orchestrationReactor.start().pipe(Scope.provide(reactorScope));
          yield* providerSessionReaper.start().pipe(Scope.provide(reactorScope));
        }),
      );

      yield* runStartupPhase("provider-sessions.reconcile", reconcileProviderSessions);

      const welcomeBase = yield* resolveWelcomeBase;
      const environment = yield* serverEnvironment.getDescriptor;
      yield* Effect.logDebug("startup phase: preparing welcome payload");

      if (serverConfig.autoBootstrapProjectFromCwd) {
        yield* forkParked(
          runStartupPhase(
            "welcome.autobootstrap",
            Effect.gen(function* () {
              const bootstrapTargets = yield* resolveAutoBootstrapWelcomeTargets.pipe(
                Effect.provideService(Crypto.Crypto, crypto),
              );
              if (!bootstrapTargets.bootstrapProjectId) {
                return;
              }

              yield* Effect.logDebug("startup phase: publishing bootstrapped welcome event", {
                environmentId: environment.environmentId,
                cwd: welcomeBase.cwd,
                projectName: welcomeBase.projectName,
                bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
              });
              yield* lifecycleEvents.publish({
                version: 1,
                type: "welcome",
                payload: {
                  environment,
                  ...welcomeBase,
                  ...bootstrapTargets,
                },
              });
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("startup auto-bootstrap welcome failed", {
                  cause,
                }),
              ),
            ),
          ),
        );
      }

      yield* forkParked(
        Effect.gen(function* () {
          yield* Effect.logDebug("startup phase: recording startup heartbeat");
          yield* recordStartupHeartbeat.pipe(
            Effect.annotateSpans({ "startup.phase": "heartbeat.record" }),
            Effect.withSpan("server.startup.heartbeat.record"),
            Effect.ignoreCause({ log: true }),
          );
          const startupBrowserTarget = yield* resolveStartupBrowserTarget;
          if (startupBrowserTarget) {
            yield* runStartupPhase("browser.open", maybeOpenBrowser(startupBrowserTarget));
          }
        }),
      );

      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* runStartupPhase(
        "auxiliary-roots.parked",
        options?.awaitAuxiliaryParked ?? Effect.void,
      );

      // This is the prepared boundary. Every dependency has been acquired and
      // every runtime root has confirmed that it is parked before this request.
      yield* runStartupPhase(
        "welcome.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "welcome",
          payload: { environment, ...welcomeBase },
        }),
      );
      yield* options?.activate ?? Effect.void;

      yield* Effect.logDebug("Accepting commands");
      yield* commandGate.signalCommandReady;
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: DateTime.formatIso(yield* DateTime.now),
            environment,
          },
        }),
      );
      yield* flushCompileCache;
      yield* Effect.logDebug("startup phase: complete");
    }).pipe(
      Effect.annotateSpans({
        "server.mode": serverConfig.mode,
        "server.port": serverConfig.port,
        "server.host": serverConfig.host,
      }),
      Effect.withSpan("server.startup", { kind: "server", root: true }),
    );

    yield* Effect.forkScoped(
      Effect.exit(startup).pipe(
        Effect.flatMap((startupExit) => {
          if (Exit.isSuccess(startupExit)) return Effect.void;
          const error = new ServerRuntimeStartupError({
            mode: serverConfig.mode,
            host: serverConfig.host,
            port: serverConfig.port,
            cause: startupExit.cause,
          });
          return Effect.logError("server runtime startup failed", {
            cause: startupExit.cause,
          }).pipe(
            Effect.andThen(commandGate.failCommandReady(error)),
            Effect.andThen(options?.abort?.(error) ?? Effect.void),
          );
        }),
      ),
    );

    return {
      awaitCommandReady: commandGate.awaitCommandReady,
      markHttpListening: Deferred.succeed(httpListening, undefined),
      enqueueCommand: commandGate.enqueueCommand,
    } satisfies ServerRuntimeStartup["Service"];
  });

export const layerWithOptions = (options?: StartupOptions) =>
  Layer.effect(ServerRuntimeStartup, make(options));

export const layer = layerWithOptions();
