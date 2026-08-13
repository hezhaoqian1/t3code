import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as FeishuConnector from "./FeishuConnector.ts";

it.layer(NodeServices.layer)("FeishuConnector", (it) => {
  it.effect("uses bundled resources and clears stale errors for an authenticated account", () =>
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
          `#!/bin/sh\nprintf '%s|%s\\n' "$LARKSUITE_CLI_CONFIG_DIR" "$*" >> '${commandLog}'\nif [ "$1" = "--version" ]; then echo 'lark-cli version 1.0.86'; exit 0; fi\nif [ "$1 $2" = "config show" ]; then exit 0; fi\nif [ "$1 $2 $3" = "auth status --json" ]; then echo '{"identities":{"user":{"status":"ready"}}}'; exit 0; fi\nexit 9\n`,
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
      assert.notInclude(commands, "auth login");
      assert.deepEqual(backendActions, ["stop", "start"]);
      assert.equal(
        yield* fileSystem.readFileString(
          path.join(stateDir, "connectors", "feishu", "config", "config.json"),
        ),
        '{"app_id":"legacy-app"}',
      );

      const disabled = yield* connector.setEnabled(false);
      assert.equal(disabled.state.enabled, false);
      assert.deepEqual(backendActions, ["stop", "start", "stop", "start"]);
    }).pipe(Effect.scoped),
  );
});
