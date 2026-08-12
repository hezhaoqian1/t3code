import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ConnectionCatalogEntry, PrimaryConnectionRegistration } from "./catalog.ts";
import { connectionRegistrationCatalogEntry } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import type { NetworkStatus, SupervisorConnectionState } from "./model.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";

export class EnvironmentNotRegisteredError extends Schema.TaggedErrorClass<EnvironmentNotRegisteredError>()(
  "EnvironmentNotRegisteredError",
  { environmentId: EnvironmentId },
) {
  override get message(): string {
    return `Environment ${this.environmentId} is not registered.`;
  }
}

export class EnvironmentRegistry extends Context.Service<
  EnvironmentRegistry,
  {
    readonly entries: SubscriptionRef.SubscriptionRef<
      ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
    >;
    readonly networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>;
    readonly start: Effect.Effect<void>;
    readonly registerPlatform: (registration: PrimaryConnectionRegistration) => Effect.Effect<void>;
    readonly reconcilePlatform: (
      registration: Option.Option<PrimaryConnectionRegistration>,
    ) => Effect.Effect<void>;
    readonly retryNow: (environmentId: EnvironmentId) => Effect.Effect<void>;
    readonly state: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly stateChanges: (
      environmentId: EnvironmentId,
    ) => Stream.Stream<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly run: <A, E, R>(
      environmentId: EnvironmentId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<
      A,
      E | EnvironmentNotRegisteredError,
      Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
    >;
    readonly runStream: <A, E, R>(
      environmentId: EnvironmentId,
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<
      A,
      E | EnvironmentNotRegisteredError,
      Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
    >;
    readonly followStream: <A, E, R>(
      environmentId: EnvironmentId,
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<A, E, Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>>;
  }
>()("@t3tools/client-runtime/connection/registry/EnvironmentRegistry") {}

interface EnvironmentServiceScope {
  readonly entry: ConnectionCatalogEntry;
  readonly supervisor: EnvironmentSupervisor.EnvironmentSupervisor["Service"];
  readonly scope: Scope.Closeable;
}

export const make = Effect.gen(function* () {
  const connectivity = yield* Connectivity.Connectivity;
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups;
  const entries = yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
    new Map(),
  );
  const networkStatus = yield* SubscriptionRef.make(yield* connectivity.status);
  const serviceScopes = yield* Ref.make<ReadonlyMap<EnvironmentId, EnvironmentServiceScope>>(
    new Map(),
  );
  const started = yield* Ref.make(false);
  const mutationLock = yield* Semaphore.make(1);

  const getEntry = Effect.fn("EnvironmentRegistry.getEntry")(function* (
    environmentId: EnvironmentId,
  ) {
    const entry = (yield* SubscriptionRef.get(entries)).get(environmentId);
    if (entry === undefined) {
      return yield* new EnvironmentNotRegisteredError({ environmentId });
    }
    return entry;
  });

  const closeServiceScope = Effect.fn("EnvironmentRegistry.closeServiceScope")(function* (
    environmentId: EnvironmentId,
  ) {
    const current = yield* Ref.get(serviceScopes);
    const active = current.get(environmentId);
    if (active === undefined) return;
    const next = new Map(current);
    next.delete(environmentId);
    yield* Ref.set(serviceScopes, next);
    yield* Scope.close(active.scope, Exit.void);
  });

  const createServiceScope = Effect.fn("EnvironmentRegistry.createServiceScope")(function* (
    entry: ConnectionCatalogEntry,
  ) {
    const scope = yield* Scope.make();
    const supervisor = yield* EnvironmentSupervisor.make(entry, { initiallyDesired: true }).pipe(
      Effect.provideService(Connectivity.Connectivity, connectivity),
      Effect.provideService(ConnectionDriver.ConnectionDriver, driver),
      Effect.provideService(ConnectionWakeups.ConnectionWakeups, wakeups),
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    yield* Ref.update(serviceScopes, (current) =>
      new Map(current).set(entry.target.environmentId, { entry, supervisor, scope }),
    );
    return supervisor;
  });

  const installEntry = (entry: ConnectionCatalogEntry) =>
    mutationLock.withPermits(1)(
      Effect.gen(function* () {
        const environmentId = entry.target.environmentId;
        const currentEnvironmentIds = [...(yield* Ref.get(serviceScopes)).keys()];
        yield* Effect.forEach(
          currentEnvironmentIds,
          (currentEnvironmentId) =>
            currentEnvironmentId === environmentId
              ? Effect.void
              : closeServiceScope(currentEnvironmentId),
          { discard: true },
        );

        const active = (yield* Ref.get(serviceScopes)).get(environmentId);
        if (active !== undefined && Equal.equals(active.entry, entry)) {
          yield* SubscriptionRef.set(entries, new Map([[environmentId, entry]]));
          return active.supervisor;
        }
        yield* closeServiceScope(environmentId);
        yield* SubscriptionRef.set(entries, new Map([[environmentId, entry]]));
        return yield* createServiceScope(entry);
      }),
    );

  const acquireSupervisor = Effect.fn("EnvironmentRegistry.acquireSupervisor")(function* (
    environmentId: EnvironmentId,
  ) {
    const entry = yield* getEntry(environmentId);
    const active = (yield* Ref.get(serviceScopes)).get(environmentId);
    return active !== undefined && Equal.equals(active.entry, entry)
      ? active.supervisor
      : yield* installEntry(entry);
  });

  const reconcilePlatform = Effect.fn("EnvironmentRegistry.reconcilePlatform")(function* (
    registration: Option.Option<PrimaryConnectionRegistration>,
  ) {
    if (Option.isSome(registration)) {
      yield* installEntry(connectionRegistrationCatalogEntry(registration.value));
      return;
    }
    yield* mutationLock.withPermits(1)(
      Effect.gen(function* () {
        for (const environmentId of (yield* Ref.get(serviceScopes)).keys()) {
          yield* closeServiceScope(environmentId);
        }
        yield* SubscriptionRef.set(entries, new Map());
      }),
    );
  });

  const registerPlatform = (registration: PrimaryConnectionRegistration) =>
    reconcilePlatform(Option.some(registration));

  const start = Ref.getAndSet(started, true).pipe(Effect.asVoid);

  const state = (environmentId: EnvironmentId) =>
    acquireSupervisor(environmentId).pipe(
      Effect.flatMap((supervisor) => SubscriptionRef.get(supervisor.state)),
    );
  const stateChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      acquireSupervisor(environmentId).pipe(
        Effect.map((supervisor) => SubscriptionRef.changes(supervisor.state)),
      ),
    );
  const retryNow = (environmentId: EnvironmentId) =>
    acquireSupervisor(environmentId).pipe(
      Effect.flatMap((supervisor) => supervisor.retryNow),
      Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
    );

  const run: EnvironmentRegistry["Service"]["run"] = (environmentId, effect) =>
    acquireSupervisor(environmentId).pipe(
      Effect.flatMap((supervisor) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      ),
    );
  const runStream: EnvironmentRegistry["Service"]["runStream"] = (environmentId, stream) =>
    Stream.unwrap(
      acquireSupervisor(environmentId).pipe(
        Effect.map((supervisor) =>
          Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        ),
      ),
    );
  const followStream: EnvironmentRegistry["Service"]["followStream"] = (environmentId, stream) =>
    Stream.concat(
      Stream.fromEffect(SubscriptionRef.get(entries)),
      SubscriptionRef.changes(entries),
    ).pipe(
      Stream.map((current) => Option.fromUndefinedOr(current.get(environmentId))),
      Stream.changes,
      Stream.switchMap(
        Option.match({
          onNone: () => Stream.empty,
          onSome: () =>
            Stream.unwrap(
              acquireSupervisor(environmentId).pipe(
                Effect.match({
                  onFailure: () => Stream.empty,
                  onSuccess: (supervisor) =>
                    Stream.provideService(
                      stream,
                      EnvironmentSupervisor.EnvironmentSupervisor,
                      supervisor,
                    ),
                }),
              ),
            ),
        }),
      ),
    );

  yield* connectivity.changes.pipe(
    Stream.runForEach((status) => SubscriptionRef.set(networkStatus, status)),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() =>
    Ref.get(serviceScopes).pipe(
      Effect.flatMap((activeScopes) =>
        Effect.forEach(
          [...activeScopes.values()],
          (active) => Scope.close(active.scope, Exit.void),
          { discard: true },
        ),
      ),
    ),
  );

  return EnvironmentRegistry.of({
    entries,
    networkStatus,
    start,
    registerPlatform,
    reconcilePlatform,
    retryNow,
    state,
    stateChanges,
    run,
    runStream,
    followStream,
  });
});

export const layer = Layer.effect(EnvironmentRegistry, make);
