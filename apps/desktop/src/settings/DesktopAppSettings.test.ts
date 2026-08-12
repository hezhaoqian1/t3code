import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "./DesktopAppSettings.ts";

function makeEnvironmentLayer(baseDir: string, appVersion = "1.2.3") {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion,
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
}

const withSettings = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopAppSettings.DesktopAppSettings | DesktopEnvironment.DesktopEnvironment
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fd-desktop-settings-" });
    return yield* effect.pipe(
      Effect.provide(
        DesktopAppSettings.layer.pipe(
          Layer.provideMerge(makeEnvironmentLayer(baseDir)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("DesktopAppSettings", () => {
  it.effect("loads only local window, secret-store, and update settings", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          environment.desktopSettingsPath,
          '{"linuxPasswordStore":"gnome-libsecret","updateChannel":"nightly",' +
            '"updateChannelConfiguredByUser":true,"serverExposureMode":"network-accessible",' +
            '"tailscaleServeEnabled":true,"wslBackendEnabled":true,"wslDistro":"Ubuntu"}',
        );

        assert.deepEqual(yield* settings.load, {
          linuxPasswordStore: "gnome-libsecret",
          mainWindowBounds: null,
          mainWindowMaximized: false,
          updateChannel: "nightly",
          updateChannelConfiguredByUser: true,
        });
      }),
    ),
  );

  it.effect("persists semantic window and update changes", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* settings.load;
        const bounds = yield* settings.setMainWindowBounds(
          { x: 40, y: 50, width: 1200, height: 800 },
          true,
        );
        const update = yield* settings.setUpdateChannel("nightly");

        assert.isTrue(bounds.changed);
        assert.isTrue(update.changed);
        assert.deepEqual(yield* settings.get, {
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          mainWindowBounds: { x: 40, y: 50, width: 1200, height: 800 },
          mainWindowMaximized: true,
          updateChannel: "nightly",
          updateChannelConfiguredByUser: true,
        });
      }),
    ),
  );
});
