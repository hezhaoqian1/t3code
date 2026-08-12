import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import type { FdAgentTool, FdAgentToolResult } from "./FdAgentKernel.ts";

const objectSchema = (
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
) => ({
  type: "object" as const,
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const stringSchema = { type: "string" as const };

class FdReplaceTargetError extends Data.TaggedError("FdReplaceTargetError") {}

function safeError(): FdAgentToolResult {
  return {
    ok: false,
    error: { code: "tool_failed", message: "The local tool operation failed." },
  };
}

function runTool<A, E>(
  effect: Effect.Effect<A, E>,
  signal: AbortSignal,
): Promise<FdAgentToolResult> {
  return Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: safeError,
        onSuccess: (value) => ({ ok: true, value }) satisfies FdAgentToolResult,
      }),
    ),
    { signal },
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown, name: string): string | undefined {
  const candidate = record(value)?.[name];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function stringArrayField(value: unknown, name: string): ReadonlyArray<string> | undefined {
  const candidate = record(value)?.[name];
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string")
    ? candidate
    : undefined;
}

export type FdLocalToolProfile = "project" | "office-read-only";

export const makeFdLocalTools = Effect.fn("makeFdLocalTools")(function* (
  cwd: string | undefined,
  profile: FdLocalToolProfile = "project",
) {
  if (!cwd) return [] as ReadonlyArray<FdAgentTool>;

  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const vcsProcess = yield* VcsProcess.VcsProcess;

  const tools: ReadonlyArray<FdAgentTool> = [
    {
      definition: {
        name: "read_file",
        description: "Read one UTF-8 text file relative to the project root.",
        parameters: objectSchema({ path: stringSchema }, ["path"]),
      },
      itemType: "dynamic_tool_call",
      approval: "automatic",
      execute: (input, signal) => {
        const relativePath = stringField(input, "path");
        return relativePath
          ? runTool(workspaceFileSystem.readFile({ cwd, relativePath }), signal)
          : Promise.resolve(safeError());
      },
    },
    {
      definition: {
        name: "list_files",
        description: "List indexed files and directories in the project root.",
        parameters: objectSchema({}),
      },
      itemType: "dynamic_tool_call",
      approval: "automatic",
      execute: (_input, signal) => runTool(workspaceEntries.list({ cwd }), signal),
    },
    {
      definition: {
        name: "search_files",
        description: "Search project file paths by a short query.",
        parameters: objectSchema({ query: stringSchema }, ["query"]),
      },
      itemType: "dynamic_tool_call",
      approval: "automatic",
      execute: (input, signal) => {
        const query = stringField(input, "query");
        return query !== undefined
          ? runTool(workspaceEntries.search({ cwd, query, limit: 100 }), signal)
          : Promise.resolve(safeError());
      },
    },
    {
      definition: {
        name: "search_contents",
        description: "Search text contents within project files.",
        parameters: objectSchema({ query: stringSchema }, ["query"]),
      },
      itemType: "dynamic_tool_call",
      approval: "automatic",
      execute: (input, signal) => {
        const query = stringField(input, "query");
        return query
          ? runTool(
              workspaceEntries.searchContents({
                cwd,
                query,
                limit: 200,
                caseSensitive: false,
                wholeWord: false,
                useRegex: false,
              }),
              signal,
            )
          : Promise.resolve(safeError());
      },
    },
    {
      definition: {
        name: "write_file",
        description: "Write complete UTF-8 contents to a project-relative file.",
        parameters: objectSchema({ path: stringSchema, contents: stringSchema }, [
          "path",
          "contents",
        ]),
      },
      itemType: "file_change",
      approval: "permission-mode",
      execute: (input, signal) => {
        const relativePath = stringField(input, "path");
        const contents = record(input)?.contents;
        return relativePath && typeof contents === "string"
          ? runTool(workspaceFileSystem.writeFile({ cwd, relativePath, contents }), signal)
          : Promise.resolve(safeError());
      },
    },
    {
      definition: {
        name: "replace_in_file",
        description: "Replace one exact text occurrence in a project-relative UTF-8 file.",
        parameters: objectSchema(
          { path: stringSchema, oldText: stringSchema, newText: stringSchema },
          ["path", "oldText", "newText"],
        ),
      },
      itemType: "file_change",
      approval: "permission-mode",
      execute: (input, signal) => {
        const relativePath = stringField(input, "path");
        const oldText = stringField(input, "oldText");
        const newText = record(input)?.newText;
        if (!relativePath || !oldText || typeof newText !== "string")
          return Promise.resolve(safeError());
        return runTool(
          Effect.gen(function* () {
            const current = yield* workspaceFileSystem.readFile({ cwd, relativePath });
            const first = current.contents.indexOf(oldText);
            if (first < 0 || current.contents.indexOf(oldText, first + oldText.length) >= 0) {
              return yield* new FdReplaceTargetError();
            }
            return yield* workspaceFileSystem.writeFile({
              cwd,
              relativePath,
              contents: `${current.contents.slice(0, first)}${newText}${current.contents.slice(first + oldText.length)}`,
            });
          }),
          signal,
        );
      },
    },
    {
      definition: {
        name: "run_command",
        description:
          "Run one executable with an argument array in the project root. No shell is used.",
        parameters: objectSchema(
          { command: stringSchema, args: { type: "array", items: stringSchema, maxItems: 128 } },
          ["command", "args"],
        ),
      },
      itemType: "command_execution",
      approval: "permission-mode",
      execute: (input, signal) => {
        const command = stringField(input, "command");
        const args = stringArrayField(input, "args");
        return command && args
          ? runTool(
              processRunner.run({
                command,
                args,
                cwd,
                timeout: "2 minutes",
                maxOutputBytes: 256 * 1_024,
                outputMode: "truncate",
              }),
              signal,
            )
          : Promise.resolve(safeError());
      },
    },
    {
      definition: {
        name: "git_status",
        description: "Read the project Git status without modifying the repository.",
        parameters: objectSchema({}),
      },
      itemType: "command_execution",
      approval: "automatic",
      execute: (_input, signal) =>
        runTool(
          vcsProcess.run({
            operation: "fd-agent.git-status",
            command: "git",
            args: ["status", "--short", "--branch"],
            cwd,
            maxOutputBytes: 256 * 1_024,
          }),
          signal,
        ),
    },
    {
      definition: {
        name: "git_diff",
        description: "Read the project Git diff without modifying the repository.",
        parameters: objectSchema({ staged: { type: "boolean" } }),
      },
      itemType: "command_execution",
      approval: "automatic",
      execute: (input, signal) =>
        runTool(
          vcsProcess.run({
            operation: "fd-agent.git-diff",
            command: "git",
            args: record(input)?.staged === true ? ["diff", "--cached"] : ["diff"],
            cwd,
            maxOutputBytes: 256 * 1_024,
          }),
          signal,
        ),
    },
  ];

  return profile === "office-read-only"
    ? tools.filter(
        (tool) =>
          tool.definition.name === "read_file" ||
          tool.definition.name === "list_files" ||
          tool.definition.name === "search_files" ||
          tool.definition.name === "search_contents",
      )
    : tools;
});
