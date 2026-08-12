import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  DesktopOfficeWorkspaceBoundaryError,
  OFFICE_WORKSPACE_DIRECTORY,
  OFFICE_WELCOME_FILE,
  prepareDesktopOfficeWorkspace,
} from "./DesktopOfficeWorkspace.ts";

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

describe("DesktopOfficeWorkspace", () => {
  it.effect("creates a bounded workspace and never overwrites employee content", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-office-workspace-test-",
      });
      const layer = makeEnvironmentLayer(baseDir).pipe(Layer.provideMerge(NodeServices.layer));

      const firstRoot = yield* prepareDesktopOfficeWorkspace().pipe(Effect.provide(layer));
      const welcomePath = `${firstRoot}/${OFFICE_WELCOME_FILE}`;
      const canonicalStateDir = yield* fileSystem.realPath(`${baseDir}/userdata`);
      assert.equal(firstRoot, `${canonicalStateDir}/${OFFICE_WORKSPACE_DIRECTORY}`);
      assert.match(yield* fileSystem.readFileString(welcomePath), /Fangde AI Office Workspace/);

      yield* fileSystem.writeFileString(welcomePath, "employee content\n");
      const secondRoot = yield* prepareDesktopOfficeWorkspace().pipe(Effect.provide(layer));

      assert.equal(secondRoot, firstRoot);
      assert.equal(yield* fileSystem.readFileString(welcomePath), "employee content\n");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects an existing office workspace symlink", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-office-workspace-link-test-",
      });
      const outsideDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-office-workspace-outside-test-",
      });
      const layer = makeEnvironmentLayer(baseDir).pipe(Layer.provideMerge(NodeServices.layer));
      const stateDir = `${baseDir}/userdata`;
      yield* fileSystem.makeDirectory(stateDir, { recursive: true });
      const workspacePath = `${stateDir}/${OFFICE_WORKSPACE_DIRECTORY}`;
      yield* fileSystem.symlink(outsideDir, workspacePath);

      const error = yield* prepareDesktopOfficeWorkspace().pipe(Effect.provide(layer), Effect.flip);

      assert.instanceOf(error, DesktopOfficeWorkspaceBoundaryError);
      assert.equal(error.reason, "Symlink");
      assert.isFalse(yield* fileSystem.exists(`${outsideDir}/${OFFICE_WELCOME_FILE}`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a symlinked state directory before writing outside the app root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-office-state-link-test-",
      });
      const outsideDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-office-state-outside-test-",
      });
      const stateDir = `${baseDir}/userdata`;
      yield* fileSystem.symlink(outsideDir, stateDir);
      const layer = makeEnvironmentLayer(baseDir).pipe(Layer.provideMerge(NodeServices.layer));

      const error = yield* prepareDesktopOfficeWorkspace().pipe(Effect.provide(layer), Effect.flip);

      assert.instanceOf(error, DesktopOfficeWorkspaceBoundaryError);
      assert.equal(error.reason, "Symlink");
      assert.isFalse(
        yield* fileSystem.exists(
          `${outsideDir}/${OFFICE_WORKSPACE_DIRECTORY}/${OFFICE_WELCOME_FILE}`,
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
