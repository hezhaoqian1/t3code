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

/** Longest task name kept in a folder name, in characters. */
export const TASK_FOLDER_LABEL_MAX_LENGTH = 20;
const TASK_FOLDER_FALLBACK_LABEL = "新任务";
// Openers that say how to ask, not what the task is about.
const LEADING_FILLER =
  /^(?:请你?帮忙?我?|请|麻烦你?帮?我?|帮我|帮忙|你好|您好|能不能|能否|可不可以|可以|可否|我想要?|我要|我需要|我希望)[\s，,、:：]*/u;
// Common Chinese characters, ASCII letters and digits. Everything else
// (spaces, quotes, $, %, &, emoji, rare CJK outside GBK...) separates words, so
// the folder stays safe for Windows, shells and the tools the agent runs there.
const DISALLOWED_LABEL_CHARACTERS = /[^一-龥A-Za-z0-9]+/gu;

/**
 * The task name part of a task folder, taken from the task's title: the first
 * message as the employee wrote it (or the fixed title FD Skills use, which
 * keeps enterprise queries out of the name). The AI title comes seconds later
 * and the agent's session then runs inside the folder, so the folder can't wait
 * for it or be renamed after it.
 */
export function deriveTaskFolderLabel(title: string | null | undefined): string {
  let text = (title ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/(?:\.{3}|…)+$/u, "");
  // The first sentence, and its first clause when that alone says enough.
  text =
    text
      .split(/[。！？!?；;\r\n]/u)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(LEADING_FILLER, "");
    if (next === text) break;
    text = next;
  }
  const firstClause = text.split(/[，,]/u)[0]?.trim() ?? "";
  if (Array.from(firstClause.replace(DISALLOWED_LABEL_CHARACTERS, "")).length >= 4) {
    text = firstClause;
  }
  const label = Array.from(text.replace(DISALLOWED_LABEL_CHARACTERS, "-").replace(/^-+|-+$/gu, ""))
    .slice(0, TASK_FOLDER_LABEL_MAX_LENGTH)
    .join("")
    .replace(/-+$/u, "");
  return label.length > 0 ? label : TASK_FOLDER_FALLBACK_LABEL;
}

/**
 * `任务名_年-月-日_时-分`, e.g. `分析基金持仓情况_2026-11-11_15-20`, in the
 * task's local creation time. A task created in the same minute with the same
 * name gets `_2`, `_3`, ….
 */
export function formatTaskWorkspaceDirectoryName(input: {
  readonly createdAt: string;
  readonly title?: string | null | undefined;
  readonly suffix?: number | undefined;
}): string {
  const date = DateTime.toDate(DateTime.makeUnsafe(input.createdAt));
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const base = `${deriveTaskFolderLabel(input.title)}_${day}_${time}`;
  const suffix = input.suffix ?? 0;
  return suffix === 0 ? base : `${base}_${String(suffix + 1)}`;
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

export const prepareTaskWorkspace = Effect.fn("taskWorkspace.prepare")(function* (input: {
  readonly createdAt: string;
  readonly title?: string | null | undefined;
}) {
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
    const directory = path.join(
      canonicalRoot,
      formatTaskWorkspaceDirectoryName({ createdAt: input.createdAt, title: input.title, suffix }),
    );
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
