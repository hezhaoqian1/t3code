import type { ServerProvider } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ServerProviderShape {
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
}
