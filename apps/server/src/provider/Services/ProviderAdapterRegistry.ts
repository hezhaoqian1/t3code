/**
 * ProviderAdapterRegistry - Lookup boundary for provider adapter implementations.
 *
 * Maps a `ProviderInstanceId` to the concrete adapter service. It does not own
 * session lifecycle or routing rules; `ProviderService` uses this registry
 * together with `ProviderSessionDirectory`.
 *
 * @module ProviderAdapterRegistry
 */
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ProviderAdapterError, ProviderUnsupportedError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";
import type { ProviderContinuationIdentity } from "../ProviderDriver.ts";

export interface ProviderInstanceRoutingInfo {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly continuationIdentity: ProviderContinuationIdentity;
}

/**
 * ProviderAdapterRegistryShape - Service API for adapter lookup.
 */
export interface ProviderAdapterRegistryShape {
  /**
   * Resolve the adapter for a specific instance id. Returns
   * `ProviderUnsupportedError` if no such instance is currently registered
   * (which covers "never configured" *and* "configured but the driver is
   * unavailable in this build" — both surface the same failure to callers
   * that expect a working adapter).
   */
  readonly getByInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  readonly getInstanceInfo: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRoutingInfo, ProviderUnsupportedError>;

  /**
   * List all live instance ids. Excludes unavailable/shadow instances —
   * callers of this method want something they can pass to `getByInstance`.
   */
  readonly listInstances: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;

  /**
   * Change notification stream mirroring `ProviderInstanceRegistry.streamChanges`.
   * Emits one `void` tick whenever the set of live instances changes
   * (instance added, removed, or rebuilt after a settings edit). Consumers
   * that fan out `adapter.streamEvents` per instance — e.g. `ProviderService`'s
   * runtime event bus — re-pull `listInstances` on each tick and fork new
   * subscriptions for instances they haven't seen yet.
   */
  readonly streamChanges: Stream.Stream<void>;

  /**
   * Acquire a change subscription synchronously in the caller's current fiber.
   * Consumers that must avoid missing a publish between initial reconciliation
   * and watcher startup should use this, then fork `Stream.fromSubscription`.
   */
  readonly subscribeChanges: Effect.Effect<PubSub.Subscription<void>, never, Scope.Scope>;
}

/**
 * ProviderAdapterRegistry - Service tag for provider adapter lookup.
 */
export class ProviderAdapterRegistry extends Context.Service<
  ProviderAdapterRegistry,
  ProviderAdapterRegistryShape
>()("t3/provider/Services/ProviderAdapterRegistry") {}
