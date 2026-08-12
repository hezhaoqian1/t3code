import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "./config.ts";
import {
  formatTaskWorkspaceDirectoryName,
  prepareTaskWorkspace,
  removeEmptyTaskWorkspace,
} from "./taskWorkspace.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "fd-task-workspace-config-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("taskWorkspace", (it) => {
  describe("formatTaskWorkspaceDirectoryName", () => {
    it("uses a timestamp directory name and a stable collision suffix", () => {
      const timestamp = "2026-08-11T14:47:46";
      const directoryName = formatTaskWorkspaceDirectoryName(timestamp);

      expect(directoryName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
      expect(formatTaskWorkspaceDirectoryName(timestamp, 1)).toBe(`${directoryName}-2`);
    });
  });

  it.effect("allocates unique persistent directories under the configured task root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fd-task-workspace-" });
      const taskWorkspaceRoot = path.join(tempRoot, "FangdeAI", "Tasks");
      const taskConfig = ServerConfig.make({ ...config, taskWorkspaceRoot });
      const createdAt = "2026-08-11T14:47:46";
      const directoryName = formatTaskWorkspaceDirectoryName(createdAt);

      const first = yield* prepareTaskWorkspace(createdAt).pipe(
        Effect.provideService(ServerConfig.ServerConfig, taskConfig),
      );
      const second = yield* prepareTaskWorkspace(createdAt).pipe(
        Effect.provideService(ServerConfig.ServerConfig, taskConfig),
      );

      const canonicalTaskWorkspaceRoot = yield* fileSystem.realPath(taskWorkspaceRoot);
      expect(first).toBe(path.join(canonicalTaskWorkspaceRoot, directoryName));
      expect(second).toBe(path.join(canonicalTaskWorkspaceRoot, `${directoryName}-2`));
      expect(yield* fileSystem.exists(first)).toBe(true);
      expect(yield* fileSystem.exists(second)).toBe(true);
    }),
  );

  it.effect("removes only empty task directories during bootstrap cleanup", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fd-task-cleanup-" });
      const emptyDirectory = path.join(tempRoot, "empty");
      const nonEmptyDirectory = path.join(tempRoot, "non-empty");
      yield* fileSystem.makeDirectory(emptyDirectory);
      yield* fileSystem.makeDirectory(nonEmptyDirectory);
      yield* fileSystem.writeFileString(path.join(nonEmptyDirectory, "report.md"), "retained");

      yield* removeEmptyTaskWorkspace(emptyDirectory);
      yield* removeEmptyTaskWorkspace(nonEmptyDirectory);

      expect(yield* fileSystem.exists(emptyDirectory)).toBe(false);
      expect(yield* fileSystem.exists(nonEmptyDirectory)).toBe(true);
    }),
  );
});
