// @effect-diagnostics nodeBuiltinImport:off
/**
 * Read-only access to T3-owned workflow scripts for the Agents surface.
 *
 * Containment rules:
 * - the server injects the scripts root; clients cannot choose it;
 * - the resolved realpath must live under that root, including symlinked leaves;
 * - only .js leaf files are served;
 * - reads are size-capped rather than failed, with a truncation marker.
 *
 * The client-supplied path is a hint from the workflow's runHandles; it is
 * never trusted beyond these checks.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { OrchestrationGetWorkflowScriptError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const SCRIPT_BYTE_CAP = 256 * 1024;

export interface WorkflowScriptQueryOptions {
  readonly scriptsRoot?: string;
}

export const readWorkflowScript = Effect.fn("orchestration.readWorkflowScript")(function* (
  input: { readonly scriptPath: string },
  options: WorkflowScriptQueryOptions = {},
) {
  const requested = input.scriptPath;

  if (!NodePath.isAbsolute(requested) || NodePath.extname(requested) !== ".js") {
    return yield* new OrchestrationGetWorkflowScriptError({
      reason: "invalid-path",
      scriptPath: requested,
    });
  }

  const scriptsRoot = options.scriptsRoot;
  if (scriptsRoot === undefined) {
    return yield* new OrchestrationGetWorkflowScriptError({
      reason: "root-unavailable",
      scriptPath: requested,
    });
  }

  const root = yield* Effect.tryPromise({
    try: async () => {
      const resolvedRoot = await NodeFSP.realpath(scriptsRoot);
      const rootStat = await NodeFSP.stat(resolvedRoot);
      if (!rootStat.isDirectory()) throw new Error("Workflow scripts root is not a directory");
      return resolvedRoot;
    },
    catch: (cause) =>
      new OrchestrationGetWorkflowScriptError({
        reason: "root-unavailable",
        scriptPath: requested,
        cause,
      }),
  });

  // Realpath the file itself (not just its directory): a symlink named
  // like a script inside a contained directory must not escape.
  const resolved = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(requested),
    catch: (cause) =>
      new OrchestrationGetWorkflowScriptError({
        reason: "not-found",
        scriptPath: requested,
        cause,
      }),
  });

  if (resolved !== root && !resolved.startsWith(`${root}${NodePath.sep}`)) {
    return yield* new OrchestrationGetWorkflowScriptError({
      reason: "outside-root",
      scriptPath: resolved,
    });
  }
  if (NodePath.extname(resolved) !== ".js") {
    return yield* new OrchestrationGetWorkflowScriptError({
      reason: "not-js",
      scriptPath: resolved,
    });
  }

  // Open first, then verify what was actually opened via the file descriptor.
  // Re-checking the path after open would race against a swap; fstat on the handle cannot. The two
  // containment checks fail with their own tagged reasons; "read-failed" is
  // reserved for genuine platform failures with the real cause attached.
  const read = yield* Effect.tryPromise({
    try: async () => {
      const handle = await NodeFSP.open(resolved, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return { failure: "not-regular-file" as const };
        }
        // The opened inode must be the same one realpath resolved to: a
        // process swapping the path between realpath and open changes the
        // inode, which this comparison catches.
        const pathStat = await NodeFSP.lstat(resolved);
        if (stat.ino !== pathStat.ino || stat.dev !== pathStat.dev) {
          return { failure: "changed-during-read" as const };
        }
        const truncated = stat.size > SCRIPT_BYTE_CAP;
        const buffer = Buffer.alloc(Math.min(stat.size, SCRIPT_BYTE_CAP));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return {
          contents: buffer.subarray(0, bytesRead).toString("utf8"),
          truncated,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new OrchestrationGetWorkflowScriptError({
        reason: "read-failed",
        scriptPath: resolved,
        cause,
      }),
  });
  if ("failure" in read) {
    return yield* new OrchestrationGetWorkflowScriptError({
      reason: read.failure,
      scriptPath: resolved,
    });
  }

  return {
    scriptPath: resolved,
    contents: read.contents,
    truncated: read.truncated,
  };
});
