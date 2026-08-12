import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as PrimaryAuthorization from "../authorization/service.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import { ConnectionBlockedError, PrimaryConnectionTarget } from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("primary"),
  label: "Desktop",
  httpBaseUrl: "http://127.0.0.1:3777",
  wsBaseUrl: "ws://127.0.0.1:3777",
});

const makeResolver = Effect.fn("TestConnectionResolver.make")(function* (
  bearerToken: Option.Option<string>,
) {
  const authorizationCalls = yield* Ref.make(0);
  const resolver = yield* ConnectionResolver.make.pipe(
    Effect.provideService(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({
        bearerToken: Effect.succeed(bearerToken),
        refreshBearerToken: Effect.succeed(bearerToken),
      }),
    ),
    Effect.provideService(
      PrimaryAuthorization.PrimaryEnvironmentAuthorization,
      PrimaryAuthorization.PrimaryEnvironmentAuthorization.of({
        authorize: (_target, token) =>
          Ref.update(authorizationCalls, (count) => count + 1).pipe(
            Effect.as(`ws://127.0.0.1:3777/ws?wsTicket=${token}`),
          ),
      }),
    ),
  );
  return { authorizationCalls, resolver };
});

describe("ConnectionResolver", () => {
  it.effect("prepares the cookie-authenticated primary target without an authorization call", () =>
    Effect.gen(function* () {
      const { authorizationCalls, resolver } = yield* makeResolver(Option.none());
      const prepared = yield* resolver.prepare({ target: TARGET });

      expect(prepared).toEqual({
        environmentId: TARGET.environmentId,
        label: TARGET.label,
        httpBaseUrl: TARGET.httpBaseUrl,
        socketUrl: "ws://127.0.0.1:3777/ws",
        target: TARGET,
      });
      expect(yield* Ref.get(authorizationCalls)).toBe(0);
    }),
  );

  it.effect("prepares the bearer-authenticated primary target with a fresh ticket", () =>
    Effect.gen(function* () {
      const { authorizationCalls, resolver } = yield* makeResolver(Option.some("primary-bearer"));
      const prepared = yield* resolver.prepare({ target: TARGET });

      expect(prepared.socketUrl).toBe("ws://127.0.0.1:3777/ws?wsTicket=primary-bearer");
      expect(yield* Ref.get(authorizationCalls)).toBe(1);
    }),
  );

  it.effect("refreshes once after a rejected bearer token", () =>
    Effect.gen(function* () {
      const refreshCalls = yield* Ref.make(0);
      const authorizationCalls = yield* Ref.make<ReadonlyArray<string>>([]);
      const resolver = yield* ConnectionResolver.make.pipe(
        Effect.provideService(
          ClientCapabilities.PrimaryEnvironmentAuth,
          ClientCapabilities.PrimaryEnvironmentAuth.of({
            bearerToken: Effect.succeed(Option.some("expired-token")),
            refreshBearerToken: Ref.update(refreshCalls, (count) => count + 1).pipe(
              Effect.as(Option.some("fresh-token")),
            ),
          }),
        ),
        Effect.provideService(
          PrimaryAuthorization.PrimaryEnvironmentAuthorization,
          PrimaryAuthorization.PrimaryEnvironmentAuthorization.of({
            authorize: (_target, token) =>
              Ref.update(authorizationCalls, (calls) => [...calls, token]).pipe(
                Effect.andThen(
                  token === "expired-token"
                    ? Effect.fail(
                        new ConnectionBlockedError({
                          reason: "authentication",
                          detail: "expired",
                        }),
                      )
                    : Effect.succeed("ws://127.0.0.1:3777/ws?wsTicket=fresh"),
                ),
              ),
          }),
        ),
      );

      const prepared = yield* resolver.prepare({ target: TARGET });

      expect(prepared.socketUrl).toBe("ws://127.0.0.1:3777/ws?wsTicket=fresh");
      expect(yield* Ref.get(refreshCalls)).toBe(1);
      expect(yield* Ref.get(authorizationCalls)).toEqual(["expired-token", "fresh-token"]);
    }),
  );
});
