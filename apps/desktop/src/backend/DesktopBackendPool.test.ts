import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import type { DesktopBackendSnapshot, DesktopBackendStartConfig } from "./DesktopBackendManager.ts";

function makeStubInstance(label: string): DesktopBackendPool.DesktopBackendInstance {
  const snapshot: DesktopBackendSnapshot = {
    desiredRunning: false,
    ready: false,
    activePid: Option.none(),
    restartAttempt: 0,
    restartScheduled: false,
  };
  return {
    id: DesktopBackendPool.PRIMARY_INSTANCE_ID,
    label: Effect.succeed(label),
    start: Effect.void,
    stop: () => Effect.void,
    currentConfig: Effect.succeed(Option.none<DesktopBackendStartConfig>()),
    snapshot: Effect.succeed(snapshot),
    waitForReady: (_timeout: Duration.Duration) => Effect.succeed(false),
  };
}

describe("DesktopBackendPool", () => {
  it.effect("exposes exactly one primary instance", () => {
    const primary = makeStubInstance("Local environment");
    return Effect.gen(function* () {
      const pool = yield* DesktopBackendPool.DesktopBackendPool;
      assert.strictEqual(yield* pool.primary, primary);
      assert.deepEqual(yield* pool.list, [primary]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([primary])));
  });

  it.effect("rejects a test pool without a primary", () =>
    Effect.exit(
      DesktopBackendPool.DesktopBackendPool.pipe(Effect.provide(DesktopBackendPool.layerTest([]))),
    ).pipe(Effect.map((exit) => assert.equal(exit._tag, "Failure"))),
  );
});
