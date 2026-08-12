import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./DesktopLocalEnvironmentAuth.ts";

const config = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: {},
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "desktop-bootstrap-token",
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
  list: Effect.succeed([
    {
      id: PRIMARY_LOCAL_ENVIRONMENT_ID,
      label: Effect.succeed("Windows"),
      currentConfig: Effect.succeed(Option.some(config)),
    },
  ]),
} as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);

function tokenResponse(
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  token: string,
  expiresIn: number,
) {
  return HttpClientResponse.fromWeb(
    request,
    new Response(
      JSON.stringify({
        access_token: token,
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: expiresIn,
        scope: "orchestration:read",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

function makeTestLayer(httpClientLayer: Layer.Layer<HttpClient.HttpClient>) {
  return DesktopLocalEnvironmentAuth.layer.pipe(
    Layer.provide(Layer.mergeAll(poolLayer, httpClientLayer)),
  );
}

describe("DesktopLocalEnvironmentAuth", () => {
  it.effect("exchanges the desktop bootstrap credential only once", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(
            Effect.as(tokenResponse(request, "desktop-bearer-token", 3600)),
          ),
        ),
      );
      const testLayer = makeTestLayer(httpClientLayer);

      const [first, second] = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* Effect.all([auth.getBearerToken, auth.getBearerToken], {
          concurrency: "unbounded",
        });
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(first, "desktop-bearer-token");
      assert.strictEqual(second, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("refreshes the cached token after its expiry safety window", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
            Effect.map((count) => tokenResponse(request, `desktop-token-${count}`, 31)),
          ),
        ),
      );
      const result = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        const first = yield* auth.getBearerToken;
        yield* TestClock.adjust("2 seconds");
        const second = yield* auth.getBearerToken;
        return { first, second };
      }).pipe(Effect.provide(makeTestLayer(httpClientLayer)));

      assert.deepStrictEqual(result, {
        first: "desktop-token-1",
        second: "desktop-token-2",
      });
      assert.strictEqual(yield* Ref.get(requestCount), 2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("coalesces concurrent explicit refresh requests", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
            Effect.map((count) => tokenResponse(request, `desktop-token-${count}`, 3600)),
          ),
        ),
      );
      const refreshed = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        yield* auth.getBearerToken;
        return yield* Effect.all([auth.refreshBearerToken, auth.refreshBearerToken], {
          concurrency: "unbounded",
        });
      }).pipe(Effect.provide(makeTestLayer(httpClientLayer)));

      assert.deepStrictEqual(refreshed, ["desktop-token-2", "desktop-token-2"]);
      assert.strictEqual(yield* Ref.get(requestCount), 2);
    }),
  );

  it.effect("shares a failed refresh across concurrent callers and permits a later retry", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const firstRequestStarted = yield* Deferred.make<void>();
      const releaseFirstRequest = yield* Deferred.make<void>();
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.succeed(firstRequestStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseFirstRequest)),
                    Effect.as(
                      HttpClientResponse.fromWeb(request, new Response(null, { status: 500 })),
                    ),
                  )
                : Effect.succeed(tokenResponse(request, "desktop-token-after-failure", 3600)),
            ),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        const first = yield* Effect.forkChild(auth.refreshBearerToken.pipe(Effect.exit));
        yield* Deferred.await(firstRequestStarted);
        const second = yield* Effect.forkChild(auth.refreshBearerToken.pipe(Effect.exit));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releaseFirstRequest, undefined);
        const concurrent = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
        const retry = yield* auth.refreshBearerToken;
        return { concurrent, retry };
      }).pipe(Effect.provide(makeTestLayer(httpClientLayer)));

      assert.isTrue(result.concurrent.every(Exit.isFailure));
      assert.strictEqual(result.retry, "desktop-token-after-failure");
      assert.strictEqual(yield* Ref.get(requestCount), 2);
    }),
  );
});
