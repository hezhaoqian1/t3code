import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";

function makeEnvironmentLayer(baseDir: string) {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
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

const withHarness = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopEnvironment.DesktopEnvironment
    | DesktopBackendConfiguration.DesktopBackendConfiguration
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "fd-desktop-backend-config-test-",
    });
    return yield* effect.pipe(
      Effect.provide(
        DesktopBackendConfiguration.layer.pipe(
          Layer.provideMerge(makeEnvironmentLayer(baseDir)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("DesktopBackendConfiguration", () => {
  it.effect("always resolves the primary backend on configured loopback", () =>
    withHarness(
      Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        yield* configuration.configurePort(4888);

        const first = yield* configuration.resolvePrimary;
        const second = yield* configuration.resolvePrimary;

        assert.equal(first.bootstrap.host, "127.0.0.1");
        assert.equal(first.bootstrap.port, 4888);
        assert.equal(first.httpBaseUrl.href, "http://127.0.0.1:4888/");
        assert.equal(first.bootstrap.mode, "desktop");
        assert.equal(first.bootstrap.noBrowser, true);
        assert.deepEqual(first.args.slice(-1), ["--auto-bootstrap-project-from-cwd"]);
        assert.match(first.cwd, /userdata\/office-workspace$/);
        assert.match(first.bootstrap.desktopBootstrapToken, /^[0-9a-f]{48}$/i);
        assert.equal(second.bootstrap.desktopBootstrapToken, first.bootstrap.desktopBootstrapToken);
        assert.isFalse("tailscaleServeEnabled" in first.bootstrap);
        assert.isFalse("tailscaleServePort" in first.bootstrap);
      }),
    ),
  );

  it.effect("clears inherited network exposure variables", () =>
    withHarness(
      Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        yield* configuration.configurePort(4999);
        const resolved = yield* configuration.resolvePrimary;

        assert.equal(resolved.extendEnv, true);
        assert.equal(resolved.env.ELECTRON_RUN_AS_NODE, "1");
        assert.isFalse("T3CODE_HOST" in resolved.env);
        for (const name of [
          "T3CODE_PORT",
          "T3CODE_DESKTOP_LAN_ACCESS",
          "T3CODE_DESKTOP_LAN_HOST",
          "T3CODE_DESKTOP_HTTPS_ENDPOINTS",
          "T3CODE_TAILSCALE_SERVE",
          "T3CODE_TAILSCALE_SERVE_PORT",
        ]) {
          assert.isUndefined(resolved.env[name]);
        }
      }),
    ),
  );
});
