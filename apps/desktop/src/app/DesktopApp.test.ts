import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as NetService from "@t3tools/shared/Net";

import { resolveDesktopBackendPort } from "./DesktopApp.ts";

function netLayer(reserveLoopbackPort: NetService.NetServiceShape["reserveLoopbackPort"]) {
  return Layer.succeed(NetService.NetService, {
    canListenOnHost: () => Effect.die("unexpected listener probe"),
    isPortAvailableOnLoopback: () => Effect.die("unexpected port probe"),
    reserveLoopbackPort,
    findAvailablePort: () => Effect.die("unexpected port search"),
  });
}

describe("resolveDesktopBackendPort", () => {
  it.effect("uses a configured port only in development", () =>
    Effect.gen(function* () {
      const port = yield* resolveDesktopBackendPort({
        isDevelopment: true,
        configuredPort: Option.some(4949),
      });
      assert.equal(port, 4949);
    }).pipe(
      Effect.provide(
        netLayer(() => Effect.die("development should not reserve an ephemeral port")),
      ),
    ),
  );

  it.effect("always reserves an IPv4 loopback port for packaged builds", () => {
    let observedHost: string | undefined;
    return Effect.gen(function* () {
      const port = yield* resolveDesktopBackendPort({
        isDevelopment: false,
        configuredPort: Option.some(4949),
      });
      assert.equal(port, 5777);
      assert.equal(observedHost, "127.0.0.1");
    }).pipe(
      Effect.provide(
        netLayer((host) =>
          Effect.sync(() => {
            observedHost = host;
            return 5777;
          }),
        ),
      ),
    );
  });
});
