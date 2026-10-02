import type { ServerProvider } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ServerProviderShape {
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
  /**
   * Rescans what the provider reads from disk or its catalog service (skills,
   * slash commands) and resolves once `getSnapshot` reflects the result.
   * Providers whose snapshot cannot go stale omit it.
   */
  readonly refresh?: Effect.Effect<void>;
}
