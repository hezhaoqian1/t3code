import type { ServerAuthDescriptor } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { resolveSessionCookieName } from "./utils.ts";

export class EnvironmentAuthPolicy extends Context.Service<
  EnvironmentAuthPolicy,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  }
>()("t3/auth/EnvironmentAuthPolicy") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] = config.desktopBootstrapToken
    ? ["desktop-bootstrap"]
    : [];

  const descriptor: ServerAuthDescriptor = {
    policy: "desktop-managed-local",
    bootstrapMethods,
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: resolveSessionCookieName({
      mode: config.mode,
      port: config.port,
      instanceKey: config.stateDir,
    }),
  };

  return EnvironmentAuthPolicy.of({
    getDescriptor: () =>
      Effect.succeed(descriptor).pipe(Effect.withSpan("EnvironmentAuthPolicy.getDescriptor")),
  });
});

export const layer = Layer.effect(EnvironmentAuthPolicy, make);
