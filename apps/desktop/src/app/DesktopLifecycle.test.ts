import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

const { requestSingleInstanceLockMock } = vi.hoisted(() => ({
  requestSingleInstanceLockMock: vi.fn(() => true),
}));

vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: requestSingleInstanceLockMock,
  },
}));

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

function makeTestLayer(input: {
  readonly platform: NodeJS.Platform;
  readonly appListeners: Map<string, (...args: readonly unknown[]) => void>;
  readonly quit?: () => void;
  readonly activate?: () => void;
}) {
  const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("T3 Code"),
    whenReady: Effect.void,
    quit: Effect.sync(input.quit ?? (() => undefined)),
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: () => Effect.void,
    setAboutPanelOptions: () => Effect.void,
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    isDefaultProtocolClient: () => Effect.succeed(false),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          input.appListeners.set("before-quit-for-update", listener);
        }),
        () =>
          Effect.sync(() => {
            input.appListeners.delete("before-quit-for-update");
          }),
      ).pipe(Effect.asVoid),
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          input.appListeners.set(
            eventName,
            listener as unknown as (...args: readonly unknown[]) => void,
          );
        }),
        () =>
          Effect.sync(() => {
            input.appListeners.delete(eventName);
          }),
      ).pipe(Effect.asVoid),
  } satisfies ElectronApp.ElectronApp["Service"]);

  const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
    shouldUseDarkColors: Effect.succeed(false),
    setSource: () => Effect.void,
    onUpdated: () => Effect.void,
  });

  const desktopWindowLayer = Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected window creation"),
    ensureMain: Effect.die("unexpected window creation"),
    revealOrCreateMain: Effect.die("unexpected window creation"),
    activate: Effect.sync(input.activate ?? (() => undefined)),
    createMainIfBackendReady: Effect.void,
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    flushMainWindowBounds: Effect.void,
    dispatchMenuAction: () => Effect.void,
    zoomMain: () => Effect.void,
    syncAppearance: Effect.void,
  });

  const environmentLayer = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
    platform: input.platform,
    isDevelopment: false,
  } as DesktopEnvironment.DesktopEnvironment["Service"]);

  return DesktopLifecycle.layer.pipe(
    Layer.provideMerge(electronAppLayer),
    Layer.provideMerge(electronThemeLayer),
    Layer.provideMerge(desktopWindowLayer),
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(DesktopShutdown.layer),
    Layer.provideMerge(DesktopState.layer),
  );
}

describe("DesktopLifecycle", () => {
  beforeEach(() => {
    requestSingleInstanceLockMock.mockReset();
    requestSingleInstanceLockMock.mockReturnValue(true);
  });

  it.effect("registers a primary instance and activates it on later launches", () => {
    const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
    const activate = vi.fn();
    const layer = makeTestLayer({ platform: "win32", appListeners, activate });

    return Effect.scoped(
      Effect.gen(function* () {
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        yield* lifecycle.register;

        assert.equal(requestSingleInstanceLockMock.mock.calls.length, 1);
        appListeners.get("second-instance")?.();
        yield* Effect.promise(() => Promise.resolve());
        assert.equal(activate.mock.calls.length, 1);
      }),
    ).pipe(Effect.provide(layer));
  });

  it.effect("quits and interrupts startup in a secondary instance", () => {
    requestSingleInstanceLockMock.mockReturnValue(false);
    const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
    const quit = vi.fn();
    const layer = makeTestLayer({ platform: "win32", appListeners, quit });

    return Effect.gen(function* () {
      const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
      const exit = yield* Effect.exit(Effect.scoped(lifecycle.register));

      assert.isTrue(Exit.hasInterrupts(exit));
      assert.equal(quit.mock.calls.length, 1);
      assert.isFalse(appListeners.has("second-instance"));
      assert.isFalse(appListeners.has("before-quit"));
    }).pipe(Effect.provide(layer));
  });

  for (const platform of ["darwin", "win32", "linux"] satisfies ReadonlyArray<NodeJS.Platform>) {
    it.effect(`lets the updater's quit event proceed on ${platform}`, () => {
      const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
      const layer = makeTestLayer({ platform, appListeners });

      return Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          yield* lifecycle.register;

          appListeners.get("before-quit-for-update")?.();

          let prevented = false;
          const event = {
            preventDefault: () => {
              prevented = true;
            },
          } as Electron.Event;
          appListeners.get("before-quit")?.(event);

          assert.isFalse(
            prevented,
            "cancelling this event prevents the updater from completing its relaunch",
          );

          const state = yield* DesktopState.DesktopState;
          assert.isTrue(yield* Ref.get(state.quitting));
        }),
      ).pipe(Effect.provide(layer));
    });
  }
});
