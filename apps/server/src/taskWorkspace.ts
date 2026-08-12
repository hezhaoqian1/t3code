import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "./config.ts";

export class TaskWorkspaceUnavailableError extends Schema.TaggedErrorClass<TaskWorkspaceUnavailableError>()(
  "TaskWorkspaceUnavailableError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function formatTaskWorkspaceDirectoryName(isoTimestamp: string, suffix = 0): string {
  const date = DateTime.toDate(DateTime.makeUnsafe(isoTimestamp));
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return suffix === 0 ? base : `${base}-${String(suffix + 1)}`;
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "reason" in cause &&
    typeof cause.reason === "object" &&
    cause.reason !== null &&
    "_tag" in cause.reason &&
    cause.reason._tag === "AlreadyExists"
  );
}

export const prepareTaskWorkspace = Effect.fn("taskWorkspace.prepare")(function* (
  createdAt: string,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const taskWorkspaceRoot = config.taskWorkspaceRoot?.trim();
  if (!taskWorkspaceRoot) {
    return yield* new TaskWorkspaceUnavailableError({
      reason: "Task workspace root is not configured for this server.",
    });
  }

  yield* fileSystem.makeDirectory(taskWorkspaceRoot, { recursive: true });
  const canonicalRoot = yield* fileSystem.realPath(taskWorkspaceRoot);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const directory = path.join(canonicalRoot, formatTaskWorkspaceDirectoryName(createdAt, suffix));
    const created = yield* fileSystem.makeDirectory(directory).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        isAlreadyExists(cause)
          ? Effect.succeed(false)
          : Effect.fail(
              new TaskWorkspaceUnavailableError({
                reason: `Unable to create task workspace directory: ${directory}.`,
              }),
            ),
      ),
    );
    if (created) return directory;
  }
  return yield* new TaskWorkspaceUnavailableError({
    reason: "Unable to allocate a unique task workspace directory.",
  });
});

export const removeEmptyTaskWorkspace = Effect.fn("taskWorkspace.removeEmpty")(function* (
  workspaceRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const entries = yield* fileSystem
    .readDirectory(workspaceRoot)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  if (entries.length === 0) {
    yield* fileSystem.remove(workspaceRoot, { force: true, recursive: true }).pipe(Effect.ignore);
  }
});
