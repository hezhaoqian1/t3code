import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeModule from "node:module";
import { beforeEach, vi } from "vite-plus/test";

const { setProxyMock, fromPartitionMock } = vi.hoisted(() => {
  const setProxyMock = vi.fn((_config: unknown) => Promise.resolve());
  return {
    setProxyMock,
    fromPartitionMock: vi.fn((_partition: string, _options?: unknown) => ({
      setProxy: setProxyMock,
    })),
  };
});

vi.mock("electron", () => ({
  session: { fromPartition: fromPartitionMock },
}));

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    disableDifferentialDownload: false,
    fullChangelog: false,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe("ElectronUpdater", () => {
  beforeEach(() => {
    autoUpdaterMock.allowDowngrade = false;
    autoUpdaterMock.allowPrerelease = false;
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = true;
    autoUpdaterMock.channel = "latest";
    autoUpdaterMock.disableDifferentialDownload = false;
    autoUpdaterMock.fullChangelog = false;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => Promise.resolve(null));
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.downloadUpdate.mockImplementation(() => Promise.resolve([]));
    autoUpdaterMock.on.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();
    autoUpdaterMock.removeListener.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
    fromPartitionMock.mockClear();
    setProxyMock.mockClear();
    setProxyMock.mockImplementation(() => Promise.resolve());
  });

  it("targets the same session partition electron-updater downloads through", () => {
    const executor = NodeModule.createRequire(import.meta.url)(
      "electron-updater/out/electronHttpExecutor.js",
    ) as { readonly NET_SESSION_NAME: string };
    assert.equal(ElectronUpdater.ELECTRON_UPDATER_SESSION_PARTITION, executor.NET_SESSION_NAME);
  });

  it.effect("switches the updater download session to a direct connection", () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;
      yield* updater.connectDirectly;

      assert.deepEqual(fromPartitionMock.mock.calls, [["electron-updater", { cache: false }]]);
      assert.deepEqual(setProxyMock.mock.calls, [[{ mode: "direct" }]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("reports a failed direct-connection switch as a typed error", () =>
    Effect.gen(function* () {
      const cause = new Error("session unavailable");
      setProxyMock.mockImplementationOnce(() => Promise.reject(cause));
      const updater = yield* ElectronUpdater.ElectronUpdater;

      const error = yield* updater.connectDirectly.pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterConnectDirectlyError);
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("scopes updater event listeners", () =>
    Effect.gen(function* () {
      const listener = vi.fn();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const updater = yield* ElectronUpdater.ElectronUpdater;
          yield* updater.on("update-available", listener);
        }),
      );

      assert.deepEqual(autoUpdaterMock.on.mock.calls, [["update-available", listener]]);
      assert.deepEqual(autoUpdaterMock.removeListener.mock.calls, [["update-available", listener]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("wraps rejected update checks in the method-specific typed error", () =>
    Effect.gen(function* () {
      const cause = new Error("network unavailable");
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(() => Promise.reject(cause));
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "beta";

      const error = yield* updater.checkForUpdates.pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterCheckForUpdatesError);
      assert.isTrue(ElectronUpdater.isElectronUpdaterError(error));
      assert.equal(error.channel, "beta");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, "Electron updater failed to check for updates on channel beta.");
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("preserves the execution-time channel on download failures", () =>
    Effect.gen(function* () {
      const cause = new Error("download unavailable");
      autoUpdaterMock.downloadUpdate.mockImplementationOnce(() => Promise.reject(cause));
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "nightly";

      const error = yield* updater.downloadUpdate.pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterDownloadUpdateError);
      assert.isTrue(ElectronUpdater.isElectronUpdaterError(error));
      assert.equal(error.channel, "nightly");
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Electron updater failed to download the update on channel nightly.",
      );
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("sets full changelog mode", () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;

      yield* updater.setFullChangelog(true);
      assert.equal(autoUpdaterMock.fullChangelog, true);

      yield* updater.setFullChangelog(false);
      assert.equal(autoUpdaterMock.fullChangelog, false);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("preserves quit-and-install flags and the execution-time channel", () =>
    Effect.gen(function* () {
      const cause = new Error("quit and install failed");
      autoUpdaterMock.quitAndInstall.mockImplementationOnce(() => {
        throw cause;
      });
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "alpha";

      const error = yield* updater
        .quitAndInstall({ isSilent: true, isForceRunAfter: false })
        .pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterQuitAndInstallError);
      assert.isTrue(ElectronUpdater.isElectronUpdaterError(error));
      assert.equal(error.channel, "alpha");
      assert.equal(error.isSilent, true);
      assert.equal(error.isForceRunAfter, false);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Electron updater failed to quit and install the update on channel alpha (silent: true, force run after: false).",
      );
      assert.notInclude(error.message, cause.message);
      assert.deepEqual(autoUpdaterMock.quitAndInstall.mock.calls, [[true, false]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
});
