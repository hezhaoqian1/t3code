import { bootstrapLocalBearerSession } from "@t3tools/client-runtime/authorization";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";

export class DesktopLocalEnvironmentAuthBackendNotConfiguredError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthBackendNotConfiguredError>()(
  "DesktopLocalEnvironmentAuthBackendNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Local backend is not configured.";
  }
}

export class DesktopLocalEnvironmentAuthSessionBootstrapError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthSessionBootstrapError>()(
  "DesktopLocalEnvironmentAuthSessionBootstrapError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the local desktop bearer session.";
  }
}

export const DesktopLocalEnvironmentAuthError = Schema.Union([
  DesktopLocalEnvironmentAuthBackendNotConfiguredError,
  DesktopLocalEnvironmentAuthSessionBootstrapError,
]);
export type DesktopLocalEnvironmentAuthError = typeof DesktopLocalEnvironmentAuthError.Type;

export class DesktopLocalEnvironmentAuth extends Context.Service<
  DesktopLocalEnvironmentAuth,
  {
    readonly getBearerToken: Effect.Effect<string, DesktopLocalEnvironmentAuthError>;
    readonly refreshBearerToken: Effect.Effect<string, DesktopLocalEnvironmentAuthError>;
  }
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuth") {}

const TOKEN_EXPIRY_SKEW_MS = 30_000;
interface CachedBearerToken {
  readonly value: string;
  readonly expiresAt: number;
}

interface RefreshFlight {
  readonly deferred: Deferred.Deferred<string, DesktopLocalEnvironmentAuthError>;
  readonly owner: boolean;
}

export const make = Effect.gen(function* () {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const httpClient = yield* HttpClient.HttpClient;
  const tokenRef = yield* Ref.make(Option.none<CachedBearerToken>());
  const mutex = yield* Semaphore.make(1);
  const refreshFlightRef = yield* Ref.make(
    Option.none<Deferred.Deferred<string, DesktopLocalEnvironmentAuthError>>(),
  );

  const exchangeBearerToken = Effect.gen(function* () {
    const instances = yield* pool.list;
    const primary = instances.find((instance) => instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID);
    const configOption = primary === undefined ? Option.none() : yield* primary.currentConfig;
    if (Option.isNone(configOption)) {
      return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
    }
    const config = configOption.value;
    const credential = config.bootstrap.desktopBootstrapToken;
    if (!credential) {
      return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
    }
    const session = yield* bootstrapLocalBearerSession({
      httpBaseUrl: config.httpBaseUrl.href,
      credential,
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.mapError(
        (cause) =>
          new DesktopLocalEnvironmentAuthSessionBootstrapError({
            cause,
          }),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    const expiresInMs = Math.max(0, session.expires_in * 1_000);
    yield* Ref.set(
      tokenRef,
      Option.some({
        value: session.access_token,
        expiresAt: now + Math.max(0, expiresInMs - TOKEN_EXPIRY_SKEW_MS),
      }),
    );
    return session.access_token;
  });

  const loadValidBearerToken = Effect.gen(function* () {
    const cached = yield* Ref.get(tokenRef);
    if (Option.isSome(cached) && cached.value.expiresAt > (yield* Clock.currentTimeMillis)) {
      return cached.value.value;
    }
    return yield* exchangeBearerToken;
  });

  const getBearerToken = mutex
    .withPermits(1)(loadValidBearerToken)
    .pipe(Effect.withSpan("desktop.localEnvironmentAuth.getBearerToken"));

  const refreshBearerToken = Effect.gen(function* () {
    const candidate = yield* Deferred.make<string, DesktopLocalEnvironmentAuthError>();
    const flight = yield* Ref.modify<
      Option.Option<Deferred.Deferred<string, DesktopLocalEnvironmentAuthError>>,
      RefreshFlight
    >(refreshFlightRef, (current) => {
      if (Option.isSome(current)) {
        return [{ deferred: current.value, owner: false }, current];
      }
      return [{ deferred: candidate, owner: true }, Option.some(candidate)];
    });
    if (!flight.owner) return yield* Deferred.await(flight.deferred);

    return yield* Effect.uninterruptibleMask((restore) =>
      mutex
        .withPermits(1)(
          Ref.set(tokenRef, Option.none()).pipe(Effect.andThen(restore(exchangeBearerToken))),
        )
        .pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Deferred.done(flight.deferred, exit).pipe(
              Effect.andThen(
                Ref.update(refreshFlightRef, (current) =>
                  Option.isSome(current) && current.value === flight.deferred
                    ? Option.none()
                    : current,
                ),
              ),
              Effect.andThen(
                Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause),
              ),
            ),
          ),
        ),
    );
  }).pipe(Effect.withSpan("desktop.localEnvironmentAuth.refreshBearerToken"));

  return DesktopLocalEnvironmentAuth.of({ getBearerToken, refreshBearerToken });
});

export const layer = Layer.effect(DesktopLocalEnvironmentAuth, make);
