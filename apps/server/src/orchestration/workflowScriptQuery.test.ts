// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, assert, describe } from "vite-plus/test";
import { readWorkflowScript } from "./workflowScriptQuery.ts";

const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workflow-script-test-"));
const scriptPath = NodePath.join(root, "run.js");
NodeFS.writeFileSync(scriptPath, "export const meta = {};\n");
const outside = NodePath.join(NodeOS.tmpdir(), `t3-workflow-outside-${process.pid}.js`);
NodeFS.writeFileSync(outside, "evil\n");
const link = NodePath.join(root, "sneaky.js");
try {
  NodeFS.symlinkSync(outside, link);
} catch (error) {
  // Tolerate only "already exists" from a prior run — any other failure
  // (EPERM etc.) must fail setup, or the escape test below would pass
  // vacuously on "not-found" without testing containment.
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
    throw error;
  }
}
if (!NodeFS.lstatSync(link).isSymbolicLink()) {
  throw new Error("test setup: sneaky.js must be a symlink");
}

afterAll(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
  NodeFS.rmSync(outside, { force: true });
});

describe("readWorkflowScript containment", () => {
  effectIt.effect("returns typed unavailable until a server-owned root is injected", () =>
    Effect.gen(function* () {
      const reason = yield* readWorkflowScript({ scriptPath }).pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
      );
      assert.equal(reason, "root-unavailable");
    }),
  );

  effectIt.effect("serves a real script under the injected scripts root", () =>
    Effect.gen(function* () {
      const result = yield* readWorkflowScript({ scriptPath }, { scriptsRoot: root });
      assert.include(result.contents, "export const meta");
      assert.equal(result.truncated, false);
    }),
  );

  effectIt.effect("rejects relative and non-js paths", () =>
    Effect.gen(function* () {
      const relative = yield* Effect.exit(
        readWorkflowScript({ scriptPath: "run.js" }, { scriptsRoot: root }),
      );
      assert.equal(relative._tag, "Failure");
      const nonJs = yield* Effect.exit(
        readWorkflowScript({ scriptPath: scriptPath.replace(".js", ".ts") }, { scriptsRoot: root }),
      );
      assert.equal(nonJs._tag, "Failure");
    }),
  );

  effectIt.effect("rejects paths outside the root and symlink escapes", () =>
    Effect.gen(function* () {
      const escaped = yield* Effect.exit(
        readWorkflowScript({ scriptPath: outside }, { scriptsRoot: root }),
      );
      assert.equal(escaped._tag, "Failure");
      // A symlink INSIDE the root pointing outside must fail specifically on
      // realpath re-containment — a "not-found" would mean the link was
      // never exercised and the assertion proves nothing.
      const sneaky = yield* Effect.exit(
        readWorkflowScript({ scriptPath: link }, { scriptsRoot: root }).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        ),
      );
      assert.equal(sneaky._tag, "Success");
      if (sneaky._tag === "Success") {
        assert.equal(sneaky.value, "outside-root");
      }
    }),
  );

  effectIt.effect("rejects non-regular .js entries and truncates oversized scripts", () =>
    Effect.gen(function* () {
      const directoryPath = NodePath.join(root, "directory.js");
      NodeFS.mkdirSync(directoryPath);
      const directoryReason = yield* readWorkflowScript(
        { scriptPath: directoryPath },
        { scriptsRoot: root },
      ).pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
      );
      assert.equal(directoryReason, "not-regular-file");

      const oversizedPath = NodePath.join(root, "oversized.js");
      NodeFS.writeFileSync(oversizedPath, "x".repeat(256 * 1024 + 1));
      const oversized = yield* readWorkflowScript(
        { scriptPath: oversizedPath },
        { scriptsRoot: root },
      );
      assert.equal(oversized.truncated, true);
      assert.equal(Buffer.byteLength(oversized.contents), 256 * 1024);
    }),
  );
});
