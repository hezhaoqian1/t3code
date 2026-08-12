import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import { makeFdLocalTools } from "./FdLocalTools.ts";

const unused = () => Effect.die("unused test service");

const makeTools = (
  overrides?: {
    readonly readFile?: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"];
    readonly processRun?: ProcessRunner.ProcessRunner["Service"]["run"];
    readonly vcsRun?: VcsProcess.VcsProcess["Service"]["run"];
  },
  profile: "project" | "office-read-only" = "project",
) =>
  makeFdLocalTools("/workspace/project", profile).pipe(
    Effect.provideService(
      WorkspaceFileSystem.WorkspaceFileSystem,
      WorkspaceFileSystem.WorkspaceFileSystem.of({
        readFile: overrides?.readFile ?? unused,
        writeFile: unused,
      }),
    ),
    Effect.provideService(
      WorkspaceEntries.WorkspaceEntries,
      WorkspaceEntries.WorkspaceEntries.of({
        browse: unused,
        list: unused,
        refresh: unused,
        search: unused,
        searchContents: unused,
      }),
    ),
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({ run: overrides?.processRun ?? unused }),
    ),
    Effect.provideService(
      VcsProcess.VcsProcess,
      VcsProcess.VcsProcess.of({ run: overrides?.vcsRun ?? unused }),
    ),
  );

describe("FdLocalTools", () => {
  it.effect("exposes the bounded project tool set with canonical approval classes", () =>
    Effect.gen(function* () {
      const tools = yield* makeTools();

      expect(tools.map((tool) => [tool.definition.name, tool.itemType, tool.approval])).toEqual([
        ["read_file", "dynamic_tool_call", "automatic"],
        ["list_files", "dynamic_tool_call", "automatic"],
        ["search_files", "dynamic_tool_call", "automatic"],
        ["search_contents", "dynamic_tool_call", "automatic"],
        ["write_file", "file_change", "permission-mode"],
        ["replace_in_file", "file_change", "permission-mode"],
        ["run_command", "command_execution", "permission-mode"],
        ["git_status", "command_execution", "automatic"],
        ["git_diff", "command_execution", "automatic"],
      ]);
      expect(
        tools.every(
          (tool) =>
            tool.definition.parameters.type === "object" &&
            tool.definition.parameters.additionalProperties === false,
        ),
      ).toBe(true);
    }),
  );

  it.effect("limits the office workspace to bounded read and search tools", () =>
    Effect.gen(function* () {
      const tools = yield* makeTools(undefined, "office-read-only");

      expect(tools.map((tool) => tool.definition.name)).toEqual([
        "read_file",
        "list_files",
        "search_files",
        "search_contents",
      ]);
      expect(
        tools.every(
          (tool) => tool.itemType === "dynamic_tool_call" && tool.approval === "automatic",
        ),
      ).toBe(true);
    }),
  );

  it.effect("uses workspace and process owners without constructing a shell command", () =>
    Effect.gen(function* () {
      const readFile = vi.fn((input) =>
        Effect.succeed({
          relativePath: input.relativePath,
          contents: "contents",
          byteLength: 8,
          truncated: false,
        }),
      );
      const processRun = vi.fn((input) =>
        Effect.succeed({
          stdout: input.args.join(" "),
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      );
      const tools = yield* makeTools({ readFile, processRun });
      const signal = new AbortController().signal;

      const readResult = yield* Effect.promise(() =>
        tools
          .find((tool) => tool.definition.name === "read_file")!
          .execute({ path: "src/main.ts" }, signal),
      );
      const commandResult = yield* Effect.promise(() =>
        tools
          .find((tool) => tool.definition.name === "run_command")!
          .execute({ command: "pnpm", args: ["test", "--run"] }, signal),
      );

      expect(readResult.ok).toBe(true);
      expect(readFile).toHaveBeenCalledWith({
        cwd: "/workspace/project",
        relativePath: "src/main.ts",
      });
      expect(commandResult.ok).toBe(true);
      expect(processRun).toHaveBeenCalledWith({
        command: "pnpm",
        args: ["test", "--run"],
        cwd: "/workspace/project",
        timeout: "2 minutes",
        maxOutputBytes: 256 * 1_024,
        outputMode: "truncate",
      });
    }),
  );

  it.effect("routes read-only Git operations through the bounded VCS process owner", () =>
    Effect.gen(function* () {
      const vcsRun = vi.fn((input) =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: input.args.join(" "),
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      );
      const tools = yield* makeTools({ vcsRun });
      const signal = new AbortController().signal;

      yield* Effect.promise(() =>
        tools.find((tool) => tool.definition.name === "git_status")!.execute({}, signal),
      );
      yield* Effect.promise(() =>
        tools
          .find((tool) => tool.definition.name === "git_diff")!
          .execute({ staged: true }, signal),
      );

      expect(vcsRun).toHaveBeenNthCalledWith(1, {
        operation: "fd-agent.git-status",
        command: "git",
        args: ["status", "--short", "--branch"],
        cwd: "/workspace/project",
        maxOutputBytes: 256 * 1_024,
      });
      expect(vcsRun).toHaveBeenNthCalledWith(2, {
        operation: "fd-agent.git-diff",
        command: "git",
        args: ["diff", "--cached"],
        cwd: "/workspace/project",
        maxOutputBytes: 256 * 1_024,
      });
    }),
  );

  it.effect("returns a sanitized typed failure without leaking owner errors", () =>
    Effect.gen(function* () {
      const privateDetail = "private workspace detail";
      const tools = yield* makeTools({
        readFile: () =>
          Effect.fail(
            new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
              workspaceRoot: "/workspace/project",
              relativePath: "secret.txt",
              resolvedPath: "/workspace/project/secret.txt",
              operationPath: privateDetail,
              operation: "read",
              cause: new Error(privateDetail),
            }),
          ),
      });
      const result = yield* Effect.promise(() =>
        tools
          .find((tool) => tool.definition.name === "read_file")!
          .execute({ path: "secret.txt" }, new AbortController().signal),
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "tool_failed", message: "The local tool operation failed." },
      });
      expect(result.error?.message).not.toContain(privateDetail);
    }),
  );
});
