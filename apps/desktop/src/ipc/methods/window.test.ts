import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { getLocalEnvironmentBootstraps, getWindowFullscreenState } from "./window.ts";

const readyPrimary: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
  label: Effect.succeed("Local environment"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(
    Option.some({
      executablePath: process.execPath,
      args: ["/app/bin.mjs"],
      entryPath: "/app/bin.mjs",
      cwd: "/app",
      env: {},
      extendEnv: true,
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: 3774,
        t3Home: "/tmp/t3",
        host: "127.0.0.1",
        desktopBootstrapToken: "bootstrap-token",
      },
      bootstrapDelivery: "fd3",
      httpBaseUrl: new URL("http://127.0.0.1:3774"),
      captureOutput: true,
      preflightFailure: Option.none(),
    }),
  ),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("publishes only the primary loopback environment", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* getLocalEnvironmentBootstraps.handler(), [
        {
          id: "primary",
          label: "Local environment",
          generation: "pid:123",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([readyPrimary]))),
  );
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the current native window state", () => {
    const window = { isFullScreen: () => true } as Electron.BrowserWindow;
    return Effect.gen(function* () {
      assert.isTrue(yield* getWindowFullscreenState.handler());
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          currentMainOrFirst: Effect.succeed(Option.some(window)),
        }),
      ),
    );
  });
});
