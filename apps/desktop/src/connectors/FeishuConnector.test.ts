import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as FeishuConnector from "./FeishuConnector.ts";

it.layer(NodeServices.layer)("FeishuConnector", (it) => {
  it.effect("switches authenticated accounts and cancels pending authorization", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-feishu-connector-test-",
      });
      const stateDir = path.join(root, "state");
      const cliPath = path.join(
        root,
        "apps",
        "desktop",
        "node_modules",
        "@larksuite",
        "cli",
        "bin",
        "lark-cli",
      );
      const skillRoot = path.join(
        root,
        "apps",
        "desktop",
        "resources",
        "connectors",
        "feishu",
        "skills",
        "lark-test",
      );
      const commandLog = path.join(root, "commands.log");
      const readyMarker = path.join(root, "account-ready");
      const blockLoginMarker = path.join(root, "block-device-login");
      const logoutFailureMarker = path.join(root, "logout-reports-failure");
      const notConfiguredMarker = path.join(root, "not-configured");
      const blockConfigMarker = path.join(root, "block-config-init");
      const connectorStatePath = path.join(
        stateDir,
        "connectors",
        "feishu",
        "connector-state.json",
      );
      const legacyConfigPath = path.join(root, ".lark-cli", "config.json");

      yield* Effect.all(
        [
          path.dirname(cliPath),
          skillRoot,
          path.dirname(connectorStatePath),
          path.dirname(legacyConfigPath),
        ].map((directory) => fileSystem.makeDirectory(directory, { recursive: true })),
      );
      yield* Effect.all([
        fileSystem.writeFileString(
          cliPath,
          `#!/bin/sh\nprintf '%s|%s\\n' "$LARKSUITE_CLI_CONFIG_DIR" "$*" >> '${commandLog}'\nif [ "$1" = "--version" ]; then echo 'lark-cli version 1.0.86'; exit 0; fi\nif [ "$1 $2" = "config show" ] && [ -f '${notConfiguredMarker}' ]; then exit 3; fi\nif [ "$1 $2" = "config show" ]; then exit 0; fi\nif [ "$1 $2" = "config init" ]; then echo 'https://open.feishu.cn/configure'; if [ -f '${blockConfigMarker}' ]; then exec sleep 30; fi; exit 0; fi\nif [ "$1 $2" = "auth logout" ]; then rm -f '${readyMarker}'; touch '${commandLog}.logout'; if [ -f '${logoutFailureMarker}' ]; then exit 7; fi; exit 0; fi\nif [ "$1 $2 $3" = "auth status --json" ] && [ -f '${readyMarker}' ]; then echo '{"identities":{"user":{"status":"ready"}}}'; exit 0; fi\nif [ "$1 $2 $3" = "auth status --json" ] && [ -f '${commandLog}.logout' ]; then echo '{"ok":false,"error":{"type":"auth","subtype":"not_authenticated","message":"not authenticated"}}'; exit 3; fi\nif [ "$1 $2 $3" = "auth status --json" ]; then echo '{"identities":{"user":{"status":"ready"}}}'; exit 0; fi\nif [ "$1 $2 $3 $4" = "auth login --recommend --no-wait" ]; then echo '{"verification_url":"https://open.feishu.cn/device","device_code":"device-code"}'; exit 0; fi\nif [ "$1 $2 $3" = "auth login --device-code" ]; then if [ -f '${blockLoginMarker}' ]; then exec sleep 30; fi; touch '${readyMarker}'; exit 0; fi\nexit 9\n`,
        ),
        fileSystem.writeFileString(path.join(skillRoot, "SKILL.md"), "---\nname: lark-test\n---\n"),
        fileSystem.writeFileString(
          connectorStatePath,
          '{"version":1,"enabled":true,"lastError":"旧的错误输出"}',
        ),
        fileSystem.writeFileString(legacyConfigPath, '{"app_id":"legacy-app"}'),
      ]);
      yield* fileSystem.chmod(cliPath, 0o755);

      const environment = DesktopEnvironment.DesktopEnvironment.of({
        path,
        platform: "darwin",
        isPackaged: false,
        appPath: path.join(root, "app.asar"),
        resourcesPath: path.join(root, "resources"),
        rootDir: root,
        stateDir,
        homeDirectory: root,
      } as DesktopEnvironment.DesktopEnvironment["Service"]);
      const shell = ElectronShell.ElectronShell.of({
        openExternal: () => Effect.succeed(true),
        openPath: () => Effect.succeed(true),
        copyText: () => Effect.void,
      });
      const backendActions: string[] = [];
      const backend = {
        id: DesktopBackendPool.PRIMARY_INSTANCE_ID,
        label: Effect.succeed("Local"),
        start: Effect.sync(() => backendActions.push("start")).pipe(Effect.asVoid),
        stop: () => Effect.sync(() => backendActions.push("stop")).pipe(Effect.asVoid),
        currentConfig: Effect.succeed(Option.none()),
        snapshot: Effect.succeed({
          desiredRunning: true,
          ready: true,
          activePid: Option.none(),
          restartAttempt: 0,
          restartScheduled: false,
        }),
        waitForReady: () => Effect.succeed(true),
      } satisfies DesktopBackendPool.DesktopBackendInstance;
      const backendPool = DesktopBackendPool.DesktopBackendPool.of({
        primary: Effect.succeed(backend),
        list: Effect.succeed([backend]),
      });
      const connector = yield* FeishuConnector.make().pipe(
        Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        Effect.provideService(DesktopBackendPool.DesktopBackendPool, backendPool),
        Effect.provideService(ElectronShell.ElectronShell, shell),
      );

      const result = yield* connector.connect;
      const commands = yield* fileSystem.readFileString(commandLog);

      assert.equal(result.state.authState, "authenticated");
      assert.equal(result.state.lastError, null);
      assert.equal(result.state.skillCount, 1);
      assert.include(
        commands,
        `${path.join(stateDir, "connectors", "feishu", "config")}|auth status --json`,
      );
      assert.notInclude(commands, "config init");
      assert.include(commands, "auth logout --json");
      assert.include(commands, "auth login --recommend --no-wait --json");
      assert.include(commands, "auth login --device-code device-code");
      assert.isBelow(
        commands.indexOf("auth logout --json"),
        commands.indexOf("auth login --recommend"),
      );
      assert.deepEqual(backendActions, ["stop", "start"]);
      assert.equal(
        yield* fileSystem.readFileString(
          path.join(stateDir, "connectors", "feishu", "config", "config.json"),
        ),
        '{"app_id":"legacy-app"}',
      );

      yield* fileSystem.writeFileString(logoutFailureMarker, "fail after logout");
      yield* fileSystem.writeFileString(blockLoginMarker, "block");
      const authStarted = yield* Deferred.make<void>();
      yield* connector.subscribe((state) =>
        state.authAction?.verificationUrl
          ? Deferred.succeed(authStarted, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      const pendingConnect = yield* connector.connect.pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(authStarted);

      const disconnected = yield* connector.disconnect;
      assert.equal(disconnected.state.enabled, false);
      assert.equal(disconnected.state.authState, "not_authenticated");
      const cancelledConnect = yield* Fiber.join(pendingConnect);
      assert.equal(cancelledConnect._tag, "Success");
      if (cancelledConnect._tag === "Success") {
        assert.equal(cancelledConnect.value.state.enabled, false);
        assert.equal(cancelledConnect.value.state.lastError, null);
      }

      yield* fileSystem.writeFileString(notConfiguredMarker, "not configured");
      yield* fileSystem.writeFileString(blockConfigMarker, "block");
      const configStarted = yield* Deferred.make<void>();
      yield* connector.subscribe((state) =>
        state.authAction?.verificationUrl === "https://open.feishu.cn/configure"
          ? Deferred.succeed(configStarted, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      const pendingConfig = yield* connector.connect.pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(configStarted);

      const configCancelled = yield* connector.disconnect;
      assert.equal(configCancelled.state.enabled, false);
      assert.equal(configCancelled.state.authState, "not_configured");
      const cancelledConfig = yield* Fiber.join(pendingConfig);
      assert.equal(cancelledConfig._tag, "Success");
      if (cancelledConfig._tag === "Success") {
        assert.equal(cancelledConfig.value.state.enabled, false);
        assert.equal(cancelledConfig.value.state.lastError, null);
      }
      assert.include(yield* fileSystem.readFileString(commandLog), "config init --new --lang zh");

      const disabled = yield* connector.setEnabled(false);
      assert.equal(disabled.state.enabled, false);
      assert.deepEqual(backendActions, [
        "stop",
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);
    }).pipe(Effect.scoped),
  );
});
