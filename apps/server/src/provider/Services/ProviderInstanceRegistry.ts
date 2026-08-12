/**
 * ProviderInstanceRegistry — the single Effect service in the new model.
 *
 * Owns the live `Map<ProviderInstanceId, ProviderInstance>` produced from the
 * fixed FD driver registration.
 *
 * What rest-of-server reads from here:
 *   - `getInstance(instanceId)` — for routing turn/session calls.
 *   - `listInstances` — for snapshot aggregation in `ProviderRegistry`.
 *   - `streamChanges` — coalesced "registry mutated" pings so consumers
 *     can re-pull lists or re-broadcast.
 *
 * @module provider/Services/ProviderInstanceRegistry
 */
import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ProviderInstance } from "../ProviderDriver.ts";

export interface ProviderInstanceRegistryShape {
  /**
   * Look up one instance by id. Returns `undefined` (not Option) when the
   * id is unknown — callers branch on falsy and emit
   * `ProviderInstanceNotFoundError`.
   */
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstance | undefined>;
  /**
   * Every available (driver-registered, successfully created) instance,
   * in stable settings-author order.
   */
  readonly listInstances: Effect.Effect<ReadonlyArray<ProviderInstance>>;
  /**
   * Push notification stream emitted whenever the registry's contents
   * change — instance added, removed, or rebuilt. The payload is `void`
   * because consumers always want to re-pull `listInstances`.
   *
   * NOTE: because `Stream.fromPubSub` defers `PubSub.subscribe` until the
   * stream starts running, forking a consumer via
   * `Stream.runForEach(...).pipe(Effect.forkScoped)` races the next
   * publish — the forked fiber may not have subscribed yet when the
   * publish lands. Hot-reload consumers that must not miss a publish
   * should use `subscribeChanges` below instead, which acquires the
   * subscription synchronously in the caller's fiber before the consumer
   * loop is forked.
   */
  readonly streamChanges: Stream.Stream<void>;
  /**
   * Acquire a subscription to the registry's change channel synchronously
   * in the caller's fiber. Returns a `PubSub.Subscription<void>` whose
   * lifetime is scoped to the provided `Scope` (the subscription is
   * released when the scope closes). Consumers typically `yield*` this
   * in the same fiber that forks their consumer loop, then drain with
   * `PubSub.take(subscription)` inside `Effect.forever`. Because the
   * subscription is registered with the PubSub before this `yield*`
   * returns, no subsequent publish can land in a gap.
   *
   * This exists because the `ProviderInstanceRegistry` publishes on a
   * PubSub and `Stream.fromPubSub` defers subscription until the stream
   * starts executing — a consumer that `forkScoped`s the stream
   * consumption can miss a publish that lands in the narrow window
   * between "fiber scheduled" and "fiber starts running".
   */
  readonly subscribeChanges: Effect.Effect<PubSub.Subscription<void>, never, Scope.Scope>;
}

export class ProviderInstanceRegistry extends Context.Service<
  ProviderInstanceRegistry,
  ProviderInstanceRegistryShape
>()("t3/provider/Services/ProviderInstanceRegistry") {}
