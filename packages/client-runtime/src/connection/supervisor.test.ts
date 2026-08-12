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
  initialNetwork: NetworkStatus = "online",
) {
  const network = yield* SubscriptionRef.make<NetworkStatus>(initialNetwork);
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
        yield* reportProgress({ stage: "preparing" });
        yield* reportProgress({ stage: "opening", prepared: PREPARED });
        const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1);
        const sessionClosed = yield* Deferred.make<never, ConnectionTransientError>();
        yield* Ref.update(closed, (current) => [...current, sessionClosed]);
        const session = yield* Effect.acquireRelease(
          Effect.succeed({
            client: {} as WsRpcProtocolClient,
            initialConfig: Effect.never,
            ready: Effect.void,
            probe: Effect.void,
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
  it.effect("does not contact the primary endpoint while the network is offline", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness("offline");
      const supervisor = yield* EnvironmentSupervisor.make(ENTRY, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );

      expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("offline");
      expect(yield* Ref.get(harness.attempts)).toBe(0);

      yield* harness.setNetwork("online");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.attempts)).toBe(1);
    }),
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
