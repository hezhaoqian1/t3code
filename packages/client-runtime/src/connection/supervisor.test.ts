import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("primary"),
  label: "Desktop",
  httpBaseUrl: "http://127.0.0.1:3777",
  wsBaseUrl: "ws://127.0.0.1:3777",
});
const ENTRY: ConnectionCatalogEntry = { target: TARGET };
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "ws://127.0.0.1:3777/ws?wsTicket=fresh",
  target: TARGET,
};

const transient = (detail: string) => new ConnectionTransientError({ reason: "transport", detail });

function awaitState(
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) {
  return SubscriptionRef.changes(state).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}

const makeHarness = Effect.fn("TestPrimarySupervisor.make")(function* (
  options: {
    readonly network?: NetworkStatus;
    /** Runs at the start of each connection attempt (1-based). */
    readonly beforeConnect?: (attempt: number) => Effect.Effect<void>;
    readonly probe?: Effect.Effect<void, ConnectionTransientError>;
  } = {},
) {
  const network = yield* SubscriptionRef.make<NetworkStatus>(options.network ?? "online");
  const attempts = yield* Ref.make(0);
  const releases = yield* Ref.make(0);
  const closed = yield* Ref.make<ReadonlyArray<Deferred.Deferred<never, ConnectionTransientError>>>(
    [],
  );
  const wakeups = yield* SubscriptionRef.make(0);
  const connectivity = Connectivity.Connectivity.of({
    status: SubscriptionRef.get(network),
    changes: SubscriptionRef.changes(network),
  });
  const driver = ConnectionDriver.ConnectionDriver.of({
    connect: (_entry, reportProgress) =>
      Effect.gen(function* () {
        const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1);
        if (options.beforeConnect) yield* options.beforeConnect(attempt);
        yield* reportProgress({ stage: "preparing" });
        yield* reportProgress({ stage: "opening", prepared: PREPARED });
        const sessionClosed = yield* Deferred.make<never, ConnectionTransientError>();
        yield* Ref.update(closed, (current) => [...current, sessionClosed]);
        const session = yield* Effect.acquireRelease(
          Effect.succeed({
            client: {} as WsRpcProtocolClient,
            initialConfig: Effect.never,
            ready: Effect.void,
            probe: options.probe ?? Effect.void,
            closed: Deferred.await(sessionClosed),
          } satisfies RpcSession),
          () => Ref.update(releases, (count) => count + 1),
        );
        yield* reportProgress({ stage: "synchronizing", prepared: PREPARED });
        expect(attempt).toBeGreaterThan(0);
        return { prepared: PREPARED, session };
      }),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(Connectivity.Connectivity, connectivity),
    Layer.succeed(ConnectionDriver.ConnectionDriver, driver),
    Layer.succeed(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({
        changes: SubscriptionRef.changes(wakeups).pipe(
          Stream.drop(1),
          Stream.map(() => "application-active" as const),
        ),
      }),
    ),
  );
  return {
    attempts,
    releases,
    dependencies,
    setNetwork: (status: NetworkStatus) => SubscriptionRef.set(network, status),
    closeLatest: Effect.gen(function* () {
      const latest = (yield* Ref.get(closed)).at(-1);
      if (latest !== undefined) yield* Deferred.fail(latest, transient("socket closed"));
    }),
  };
});

describe("EnvironmentSupervisor", () => {
  // The browser's navigator.onLine is often wrong behind corporate proxies and
  // VPNs, while the primary environment runs on loopback beside the app.
  it.effect("connects to the primary environment while the device reports offline", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ network: "offline" });
      const supervisor = yield* EnvironmentSupervisor.make(ENTRY, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );

      const settled = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" || state.phase === "offline",
      );

      expect(settled).toMatchObject({
        phase: "connected",
        network: "unknown",
        attempt: 1,
        lastFailure: null,
      });
      expect(yield* Ref.get(harness.attempts)).toBe(1);
    }),
  );

  it.effect(
    "keeps a primary attempt through an offline report and restarts it when the network returns",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          beforeConnect: (attempt) =>
            attempt === 1
              ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
        });
        const supervisor = yield* EnvironmentSupervisor.make(ENTRY, {
          initiallyDesired: true,
        }).pipe(Effect.provide(harness.dependencies));

        yield* Deferred.await(started);
        yield* harness.setNetwork("offline");
        yield* TestClock.adjust("1 second");
        expect(yield* Ref.get(harness.attempts)).toBe(1);
        expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("connecting");

        yield* harness.setNetwork("online");
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        expect(yield* Ref.get(harness.attempts)).toBe(2);
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps a healthy primary session through an offline report", () =>
    Effect.gen(function* () {
      const probed = yield* Deferred.make<void>();
      const harness = yield* makeHarness({ probe: Deferred.succeed(probed, undefined) });
      const supervisor = yield* EnvironmentSupervisor.make(ENTRY, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.setNetwork("offline");
      yield* Deferred.await(probed);
      yield* TestClock.adjust("5 seconds");

      expect(yield* SubscriptionRef.get(supervisor.state)).toMatchObject({
        phase: "connected",
        generation: 1,
      });
      expect(yield* Ref.get(harness.attempts)).toBe(1);
      expect(yield* Ref.get(harness.releases)).toBe(0);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "checks the primary session when the device reports offline and replaces a dead one",
    () =>
      Effect.gen(function* () {
        const probed = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          probe: Deferred.succeed(probed, undefined).pipe(Effect.andThen(Effect.never)),
        });
        const supervisor = yield* EnvironmentSupervisor.make(ENTRY, {
          initiallyDesired: true,
        }).pipe(Effect.provide(harness.dependencies));

        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        yield* harness.setNetwork("offline");
        yield* Deferred.await(probed);
        yield* TestClock.adjust("3 seconds");
        yield* awaitState(
          supervisor.state,
          (state) => state.phase === "connected" && state.generation === 2,
        );

        expect(yield* Ref.get(harness.attempts)).toBe(2);
        expect(yield* Ref.get(harness.releases)).toBe(1);
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reconnects the primary WebSocket after an involuntary close", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(ENTRY, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatest;
      yield* awaitState(supervisor.state, (state) => state.phase === "backoff");
      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );

      expect(yield* Ref.get(harness.attempts)).toBe(2);
      expect(yield* Ref.get(harness.releases)).toBe(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
