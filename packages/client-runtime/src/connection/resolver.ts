import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PrimaryAuthorization from "../authorization/service.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import { ConnectionBlockedError } from "./model.ts";
import type { ConnectionAttemptError, PreparedConnection } from "./model.ts";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

export class ConnectionResolver extends Context.Service<
  ConnectionResolver,
  {
    readonly prepare: (
      entry: ConnectionCatalogEntry,
    ) => Effect.Effect<PreparedConnection, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/connection/resolver/ConnectionResolver") {}

function primarySocketUrl(wsBaseUrl: string): string {
  const url = new URL(wsBaseUrl);
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/ws";
  }
  return url.toString();
}

export const make = Effect.gen(function* () {
  const platformAuth = yield* ClientCapabilities.PrimaryEnvironmentAuth;
  const authorization = yield* PrimaryAuthorization.PrimaryEnvironmentAuthorization;

  const prepare = Effect.fn("clientRuntime.connection.primary.prepare")(function* (
    entry: ConnectionCatalogEntry,
  ) {
    const target = entry.target;
    let bearerToken = yield* platformAuth.bearerToken;
    let socketUrl = primarySocketUrl(target.wsBaseUrl);
    if (Option.isSome(bearerToken)) {
      const authorize = (token: string) => authorization.authorize(target, token);
      socketUrl = yield* authorize(bearerToken.value).pipe(
        Effect.catchIf(
          (error) => isConnectionBlockedError(error) && error.reason === "authentication",
          () =>
            Effect.gen(function* () {
              bearerToken = yield* platformAuth.refreshBearerToken;
              if (Option.isNone(bearerToken)) {
                return yield* new ConnectionBlockedError({
                  reason: "authentication",
                  detail: "The local Desktop credential is unavailable.",
                });
              }
              return yield* authorize(bearerToken.value);
            }),
        ),
      );
    }
    return {
      environmentId: target.environmentId,
      label: target.label,
      httpBaseUrl: target.httpBaseUrl,
      socketUrl,
      target,
    } satisfies PreparedConnection;
  });

  return ConnectionResolver.of({ prepare });
});

export const layer = Layer.effect(ConnectionResolver, make);
