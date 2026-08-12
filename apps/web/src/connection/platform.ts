import {
  EnvironmentOwnedDataCleanup,
  PlatformConnectionSource,
  PrimaryEnvironmentAuth,
} from "@t3tools/client-runtime/platform";
import {
  ConnectionTransientError,
  Connectivity,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { EnvironmentRpcRequestObserver } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { clearComposerDraftsEnvironment } from "../composerDraftStore";
import {
  readDesktopPrimaryBearerToken,
  refreshDesktopPrimaryBearerToken,
} from "../environments/primary/desktopAuth";
import {
  readPrimaryEnvironmentDescriptor,
  refreshPrimaryEnvironmentDescriptor,
  resolveInitialPrimaryEnvironmentDescriptor,
  writePrimaryEnvironmentDescriptor,
} from "../environments/primary";
import {
  readPrimaryEnvironmentTarget,
  type PrimaryEnvironmentTarget,
} from "../environments/primary/target";
import { trackRpcRequestSent, acknowledgeRpcRequest } from "../rpc/requestLatencyState";
import { connectionStorageLayer } from "./storage";

let nextObservedRpcRequestId = 0;

function currentNetworkStatus(): "unknown" | "offline" | "online" {
  if (typeof navigator === "undefined") return "unknown";
  return navigator.onLine ? "online" : "offline";
}

const connectivityLayer = Connectivity.layer({
  status: Effect.sync(currentNetworkStatus),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const online = () => Queue.offerUnsafe(queue, "online");
        const offline = () => Queue.offerUnsafe(queue, "offline");
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        return { online, offline };
      }),
      ({ online, offline }) =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    ).pipe(Effect.asVoid),
  ),
});

const wakeupsLayer = Wakeups.layer({
  changes: Stream.callback<"application-active">((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          if (document.visibilityState === "visible")
            Queue.offerUnsafe(queue, "application-active");
        };
        document.addEventListener("visibilitychange", listener);
        return listener;
      }),
      (listener) => Effect.sync(() => document.removeEventListener("visibilitychange", listener)),
    ).pipe(Effect.asVoid),
  ),
});

const capabilitiesLayer = Layer.succeed(
  PrimaryEnvironmentAuth,
  PrimaryEnvironmentAuth.of({
    bearerToken: Effect.tryPromise({
      try: readDesktopPrimaryBearerToken,
      catch: (cause) =>
        new ConnectionTransientError({
          reason: "endpoint-unavailable",
          detail: `Could not load the Desktop primary credential: ${String(cause)}`,
        }),
    }).pipe(Effect.map(Option.fromNullishOr)),
    refreshBearerToken: Effect.tryPromise({
      try: refreshDesktopPrimaryBearerToken,
      catch: (cause) =>
        new ConnectionTransientError({
          reason: "endpoint-unavailable",
          detail: `Could not refresh the Desktop primary credential: ${String(cause)}`,
        }),
    }).pipe(Effect.map(Option.fromNullishOr)),
  }),
);

interface CachedPrimaryRegistration {
  readonly topologySignature: string;
  readonly identitySignature: string;
  readonly registration: PrimaryConnectionRegistration;
}

export function primaryEnvironmentTargetSignature(target: PrimaryEnvironmentTarget): string {
  return [
    target.source,
    target.generation,
    target.target.httpBaseUrl,
    target.target.wsBaseUrl,
  ].join("|");
}

export type PrimaryEnvironmentTargetRead =
  | { readonly _tag: "Success"; readonly target: PrimaryEnvironmentTarget | null }
  | { readonly _tag: "Failure"; readonly cause: unknown };

export function readPrimaryEnvironmentTargetResult(
  readTarget: () => PrimaryEnvironmentTarget | null = readPrimaryEnvironmentTarget,
): PrimaryEnvironmentTargetRead {
  try {
    return { _tag: "Success", target: readTarget() };
  } catch (cause) {
    return { _tag: "Failure", cause };
  }
}

export function primaryRegistrationToRetainAfterTopologyRead(
  previous: CachedPrimaryRegistration | undefined,
  topologyRead: PrimaryEnvironmentTargetRead,
): CachedPrimaryRegistration | undefined {
  return topologyRead._tag === "Failure" ? previous : undefined;
}

const loadPrimaryRegistration = Effect.fn("web.connectionPlatform.loadPrimary")(function* (
  resolved: PrimaryEnvironmentTarget,
  refreshDescriptor: boolean,
) {
  const descriptor = yield* Effect.tryPromise({
    try: () => {
      if (refreshDescriptor) return refreshPrimaryEnvironmentDescriptor();
      return Promise.resolve(
        readPrimaryEnvironmentDescriptor() ?? resolveInitialPrimaryEnvironmentDescriptor(),
      );
    },
    catch: (cause) =>
      new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail: `Could not discover the Desktop primary environment: ${String(cause)}`,
      }),
  });
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: resolved.target.httpBaseUrl,
      wsBaseUrl: resolved.target.wsBaseUrl,
    }),
  });
});

const platformConnectionSourceLayer = Layer.effect(
  PlatformConnectionSource,
  Effect.gen(function* () {
    const cache = yield* Ref.make<Option.Option<CachedPrimaryRegistration>>(Option.none());
    const registration = Stream.tick("3 seconds").pipe(
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          const previous = Option.getOrUndefined(yield* Ref.get(cache));
          const topology = readPrimaryEnvironmentTargetResult();
          if (topology._tag === "Failure") {
            yield* Effect.logWarning("Could not read the primary environment topology.", {
              cause: topology.cause,
            });
            return Option.fromNullishOr(previous?.registration);
          }
          if (topology.target === null) {
            yield* Ref.set(cache, Option.none());
            writePrimaryEnvironmentDescriptor(null);
            return Option.none();
          }
          const topologySignature = primaryEnvironmentTargetSignature(topology.target);
          if (previous?.topologySignature === topologySignature) {
            return Option.some(previous.registration);
          }
          const built = yield* loadPrimaryRegistration(
            topology.target,
            previous !== undefined,
          ).pipe(Effect.option);
          if (Option.isNone(built)) return Option.fromNullishOr(previous?.registration);
          const next = {
            topologySignature,
            identitySignature: [
              built.value.target.environmentId,
              built.value.target.httpBaseUrl,
              built.value.target.wsBaseUrl,
            ].join("|"),
            registration: built.value,
          };
          yield* Ref.set(cache, Option.some(next));
          return Option.some(next.registration);
        }),
      ),
    );
    return PlatformConnectionSource.of({ registration });
  }),
);

const environmentOwnedDataCleanupLayer = Layer.succeed(
  EnvironmentOwnedDataCleanup,
  EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) => Effect.sync(() => clearComposerDraftsEnvironment(environmentId)),
  }),
);

const rpcRequestObserverLayer = Layer.succeed(
  EnvironmentRpcRequestObserver,
  EnvironmentRpcRequestObserver.of({
    observe: ({ environmentId, method }) =>
      Effect.sync(() => {
        const requestId = `${environmentId}:${++nextObservedRpcRequestId}`;
        trackRpcRequestSent(requestId, method, `${method} · ${environmentId}`);
        return Effect.sync(() => acknowledgeRpcRequest(requestId));
      }),
  }),
);

export const connectionPlatformLayer = Layer.mergeAll(
  connectionStorageLayer,
  connectivityLayer,
  wakeupsLayer,
  capabilitiesLayer,
  platformConnectionSourceLayer,
  environmentOwnedDataCleanupLayer,
  rpcRequestObserverLayer,
);
