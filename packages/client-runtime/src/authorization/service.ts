import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";

import type { ConnectionAttemptError, PrimaryConnectionTarget } from "../connection/model.ts";
import { ConnectionBlockedError, ConnectionTransientError } from "../connection/model.ts";
import { resolveLocalWebSocketConnectionUrl } from "./local.ts";

export class PrimaryEnvironmentAuthorization extends Context.Service<
  PrimaryEnvironmentAuthorization,
  {
    readonly authorize: (
      target: PrimaryConnectionTarget,
      bearerToken: string,
    ) => Effect.Effect<string, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/authorization/service/PrimaryEnvironmentAuthorization") {}

function mapAuthorizationError(error: { readonly _tag: string; readonly message?: string }) {
  switch (error._tag) {
    case "EnvironmentAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: "The local Desktop credential is invalid.",
      });
    case "EnvironmentScopeRequiredError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The local Desktop credential is missing a required scope.",
      });
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The local Desktop authentication request was rejected.",
      });
    case "LocalEnvironmentRequestTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message ?? "The local Desktop authentication request timed out.",
      });
    default:
      return new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail:
          error.message ?? "The local Desktop environment could not authorize the connection.",
      });
  }
}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const authorize = Effect.fn("clientRuntime.connection.primary.authorize")(
    (target: PrimaryConnectionTarget, bearerToken: string) =>
      resolveLocalWebSocketConnectionUrl({
        wsBaseUrl: target.wsBaseUrl,
        httpBaseUrl: target.httpBaseUrl,
        bearerToken,
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(mapAuthorizationError),
      ),
  );
  return PrimaryEnvironmentAuthorization.of({ authorize });
});

export const layer = Layer.effect(PrimaryEnvironmentAuthorization, make);
