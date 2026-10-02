import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationCommand,
  ProviderDriverKind,
  type ProviderSendTurnInput,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderAdapterRequestError } from "./provider/Errors.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";

const providerInstanceId = ProviderInstanceId.make("fd-deepseek");
const provider = ProviderDriverKind.make("fd-deepseek");
const interruptedAt = "2026-10-01T08:00:00.000Z";
const interruptedAtMs = Date.parse(interruptedAt);

const makeThread = (
  id: string,
  status: "starting" | "running" | "ready" | "stopped" | "error",
  activeTurnId: TurnId | null = null,
  options: { readonly archivedAt?: string | null; readonly updatedAt?: string } = {},
) => ({
  id: ThreadId.make(id),
  archivedAt: options.archivedAt ?? null,
  deletedAt: null,
  interactionMode: "default" as const,
  updatedAt: options.updatedAt ?? interruptedAt,
  session: {
    threadId: ThreadId.make(id),
    status,
    providerName: "fd-deepseek" as const,
    providerInstanceId,
    runtimeMode: "full-access" as const,
    activeTurnId,
    lastError: null,
    updatedAt: options.updatedAt ?? interruptedAt,
  },
});
type TestThread = ReturnType<typeof makeThread>;

const makeBinding = (
  threadId: ThreadId,
  options: {
    readonly resumeCursor?: unknown;
    readonly runtimePayload?: Record<string, unknown>;
    readonly lastSeenAt?: string;
  } = {},
): ProviderSessionDirectory.ProviderRuntimeBindingWithMetadata => ({
  threadId,
  provider,
  providerInstanceId,
  status: "stopped",
  resumeCursor:
    "resumeCursor" in options ? options.resumeCursor : { threadId: `codex-${threadId}` },
  runtimePayload: { activeTurnId: null, ...options.runtimePayload },
  lastSeenAt: options.lastSeenAt ?? interruptedAt,
});

interface Harness {
  readonly dispatched: OrchestrationCommand[];
  readonly upserts: ProviderSessionDirectory.ProviderRuntimeBinding[];
  readonly sentTurns: ProviderSendTurnInput[];
}

const runReconciliation = (input: {
  readonly threads: ReadonlyArray<TestThread>;
  readonly bindings: ReadonlyArray<ProviderSessionDirectory.ProviderRuntimeBindingWithMetadata>;
  readonly liveThreadIds?: ReadonlyArray<ThreadId>;
  readonly continueAfterRestart?: boolean;
  readonly promptless?: boolean;
  readonly sendTurnFails?: boolean;
  readonly nowMs?: number;
  /** Continuations to wait for before the scope closes. */
  readonly awaitContinuations?: number;
}) =>
  Effect.gen(function* () {
    const harness: Harness = { dispatched: [], upserts: [], sentTurns: [] };
    const settled = yield* Deferred.make<void>();
    let pendingContinuations = input.awaitContinuations ?? 0;
    const continuationSettled = Effect.suspend(() => {
      pendingContinuations -= 1;
      return pendingContinuations <= 0 ? Deferred.succeed(settled, undefined) : Effect.void;
    });

    const providerService = {
      startSession: () => Effect.die("unused"),
      sendTurn: (turn: ProviderSendTurnInput) =>
        Effect.gen(function* () {
          harness.sentTurns.push(turn);
          if (input.sendTurnFails) {
            yield* continuationSettled;
            return yield* new ProviderAdapterRequestError({
              provider,
              method: "turn/start",
              detail: "resume failed",
            });
          }
          return { threadId: turn.threadId, turnId: TurnId.make(`resumed-${turn.threadId}`) };
        }),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      listSessions: () =>
        Effect.succeed((input.liveThreadIds ?? []).map((threadId) => ({ threadId }) as never)),
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session" as const,
          ...(input.promptless === false ? {} : { promptlessTurnContinuation: true }),
        }),
    } as unknown as ProviderService.ProviderService["Service"];

    const directory = {
      getBinding: (threadId: ThreadId) =>
        Effect.succeed(Option.fromNullishOr(input.bindings.find((b) => b.threadId === threadId))),
      upsert: (binding: ProviderSessionDirectory.ProviderRuntimeBinding) =>
        Effect.sync(() => {
          harness.upserts.push(binding);
        }),
      getProvider: () => Effect.die("unused"),
      listThreadIds: () => Effect.die("unused"),
      listBindings: () => Effect.succeed(input.bindings),
    } satisfies ProviderSessionDirectory.ProviderSessionDirectory["Service"];

    const dispatch: OrchestrationEngine.OrchestrationEngineService["Service"]["dispatch"] = (
      command,
    ) =>
      Effect.gen(function* () {
        harness.dispatched.push(command);
        const isActivity = command.type === "thread.activity.append";
        const isFailure =
          command.type === "thread.session.set" &&
          command.session.lastError === ServerRuntimeStartup.CONTINUATION_FAILED_ERROR;
        if (isActivity || isFailure) yield* continuationSettled;
        return { sequence: harness.dispatched.length };
      });

    yield* TestClock.setTime(input.nowMs ?? interruptedAtMs + 60_000);
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* ServerRuntimeStartup.reconcileProviderSessions;
        if ((input.awaitContinuations ?? 0) > 0) yield* Deferred.await(settled);
      }),
    ).pipe(
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.succeed({ threads: input.threads } as never),
      } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]),
      Effect.provideService(ProviderService.ProviderService, providerService),
      Effect.provideService(ProviderSessionDirectory.ProviderSessionDirectory, directory),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch,
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      } as unknown as OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({
            continueThreadsAfterServerUpdate: input.continueAfterRestart ?? true,
          }),
          NodeServices.layer,
        ),
      ),
    );
    return harness;
  });

const sessionSets = (harness: Harness) =>
  harness.dispatched.flatMap((command) =>
    command.type === "thread.session.set"
      ? [
          {
            threadId: command.threadId,
            status: command.session.status,
            lastError: command.session.lastError,
          },
        ]
      : [],
  );

it.effect("settles orphaned turns when continuing after restart is off", () =>
  Effect.gen(function* () {
    const running = makeThread("thread-running", "running", TurnId.make("turn-1"));
    const starting = makeThread("thread-starting", "starting");
    const live = makeThread("thread-live", "running", TurnId.make("turn-live"));
    const idle = makeThread("thread-idle", "ready");
    const harness = yield* runReconciliation({
      threads: [running, starting, live, idle],
      bindings: [makeBinding(running.id), makeBinding(starting.id), makeBinding(live.id)],
      liveThreadIds: [live.id],
      continueAfterRestart: false,
    });

    assert.deepStrictEqual(sessionSets(harness), [
      {
        threadId: running.id,
        status: "error",
        lastError: ServerRuntimeStartup.INTERRUPTED_SESSION_ERROR,
      },
      {
        threadId: starting.id,
        status: "error",
        lastError: ServerRuntimeStartup.INTERRUPTED_SESSION_ERROR,
      },
    ]);
    assert.deepStrictEqual(
      harness.upserts.map((binding) => [binding.threadId, binding.status]),
      [
        [running.id, "stopped"],
        [starting.id, "stopped"],
      ],
    );
    assert.deepStrictEqual(harness.sentTurns, []);
  }),
);

it.effect("resumes a recently interrupted turn without a prompt", () =>
  Effect.gen(function* () {
    const running = makeThread("thread-running", "running", TurnId.make("turn-1"));
    const harness = yield* runReconciliation({
      threads: [running],
      bindings: [makeBinding(running.id)],
      awaitContinuations: 1,
    });

    // The marker is written before anything else so another restart can pick it up.
    assert.deepStrictEqual(harness.upserts[0], {
      threadId: running.id,
      provider,
      providerInstanceId,
      status: "starting",
      runtimePayload: {
        activeTurnId: null,
        [ServerRuntimeStartup.RESTART_CONTINUATION_KEY]: "turn-1",
      },
    });
    assert.deepStrictEqual(sessionSets(harness), [
      { threadId: running.id, status: "starting", lastError: null },
    ]);
    assert.deepStrictEqual(harness.sentTurns, [
      { threadId: running.id, continuation: true, interactionMode: "default" },
    ]);
    const activity = harness.dispatched.find(
      (command) => command.type === "thread.activity.append",
    );
    assert.ok(activity?.type === "thread.activity.append");
    assert.strictEqual(
      activity.activity.kind,
      ServerRuntimeStartup.RESTART_CONTINUATION_ACTIVITY_KIND,
    );
    assert.strictEqual(activity.activity.turnId, `resumed-${running.id}`);
    assert.strictEqual(activity.activity.summary, "应用重启后已自动继续任务");
  }),
);

it.effect("asks with a prompt when the provider cannot resume without one", () =>
  Effect.gen(function* () {
    const running = makeThread("thread-running", "running", TurnId.make("turn-1"));
    const harness = yield* runReconciliation({
      threads: [running],
      bindings: [makeBinding(running.id)],
      promptless: false,
      awaitContinuations: 1,
    });

    assert.strictEqual(harness.sentTurns.length, 1);
    assert.strictEqual(harness.sentTurns[0]?.continuation, undefined);
    assert.include(harness.sentTurns[0]?.input ?? "", "继续");
  }),
);

it.effect("finishes a continuation that a previous restart prepared but never sent", () =>
  Effect.gen(function* () {
    const starting = makeThread("thread-starting", "starting");
    const harness = yield* runReconciliation({
      threads: [starting],
      bindings: [
        makeBinding(starting.id, {
          runtimePayload: { [ServerRuntimeStartup.RESTART_CONTINUATION_KEY]: "turn-1" },
        }),
      ],
      awaitContinuations: 1,
    });

    assert.deepStrictEqual(harness.sentTurns, [
      { threadId: starting.id, continuation: true, interactionMode: "default" },
    ]);
  }),
);

it.effect("does not resume an old, archived or unresumable interruption", () =>
  Effect.gen(function* () {
    const stale = makeThread("thread-stale", "running", TurnId.make("turn-stale"));
    const archived = makeThread("thread-archived", "running", TurnId.make("turn-archived"), {
      archivedAt: interruptedAt,
    });
    const noCursor = makeThread("thread-no-cursor", "running", TurnId.make("turn-no-cursor"));
    const harness = yield* runReconciliation({
      threads: [stale, archived, noCursor],
      bindings: [
        makeBinding(stale.id),
        makeBinding(archived.id),
        makeBinding(noCursor.id, { resumeCursor: null }),
      ],
      nowMs: interruptedAtMs + ServerRuntimeStartup.RESTART_CONTINUATION_MAX_AGE_MS + 1,
    });

    assert.deepStrictEqual(harness.sentTurns, []);
    assert.deepStrictEqual(
      sessionSets(harness).map((set) => set.status),
      ["error", "error", "error"],
    );
  }),
);

it.effect("measures the interruption from the latest sign of activity", () =>
  Effect.gen(function* () {
    // The turn started long ago but the service only stopped a minute ago.
    const longTurn = makeThread("thread-long", "running", TurnId.make("turn-long"), {
      updatedAt: "2026-09-30T08:00:00.000Z",
    });
    const nowMs = interruptedAtMs + 60_000;
    const harness = yield* runReconciliation({
      threads: [longTurn],
      bindings: [makeBinding(longTurn.id, { lastSeenAt: interruptedAt })],
      nowMs,
      awaitContinuations: 1,
    });

    assert.strictEqual(harness.sentTurns.length, 1);
  }),
);

it.effect("settles with an explanation when the continuation fails", () =>
  Effect.gen(function* () {
    const running = makeThread("thread-running", "running", TurnId.make("turn-1"));
    const harness = yield* runReconciliation({
      threads: [running],
      bindings: [makeBinding(running.id)],
      sendTurnFails: true,
      awaitContinuations: 2,
    });

    assert.deepStrictEqual(sessionSets(harness), [
      { threadId: running.id, status: "starting", lastError: null },
      {
        threadId: running.id,
        status: "error",
        lastError: ServerRuntimeStartup.CONTINUATION_FAILED_ERROR,
      },
    ]);
    const lastUpsert = harness.upserts.at(-1);
    assert.strictEqual(lastUpsert?.status, "stopped");
    assert.deepStrictEqual(lastUpsert?.runtimePayload, {
      activeTurnId: null,
      [ServerRuntimeStartup.RESTART_CONTINUATION_KEY]: null,
    });
  }),
);
