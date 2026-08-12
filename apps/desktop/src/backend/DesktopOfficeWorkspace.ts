import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export const OFFICE_WORKSPACE_DIRECTORY = "office-workspace";
export const OFFICE_WELCOME_FILE = "README.md";

const OFFICE_WELCOME_CONTENT = `# Fangde AI Office Workspace

This app-owned folder stores files attached to general office conversations.
You can keep your own documents here. Fangde AI will not overwrite this file after it is created.
`;

export class DesktopOfficeWorkspaceBoundaryError extends Schema.TaggedErrorClass<DesktopOfficeWorkspaceBoundaryError>()(
  "DesktopOfficeWorkspaceBoundaryError",
  {
    stateDir: Schema.String,
    workspaceRoot: Schema.String,
    reason: Schema.Literals(["Symlink", "OutsideStateDirectory"]),
  },
) {
  override get message(): string {
    return `Refusing unsafe Desktop office workspace at ${this.workspaceRoot}.`;
  }
}

export const prepareDesktopOfficeWorkspace = Effect.fn("desktop.officeWorkspace.prepare")(
  function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const unresolvedWorkspaceRoot = environment.path.resolve(
      environment.stateDir,
      OFFICE_WORKSPACE_DIRECTORY,
    );
    if (yield* fileSystem.exists(environment.stateDir)) {
      const stateDirLinkTarget = yield* fileSystem.readLink(environment.stateDir).pipe(
        Effect.map((target) => target as string | undefined),
        Effect.orElseSucceed(() => undefined),
      );
      if (stateDirLinkTarget !== undefined) {
        return yield* new DesktopOfficeWorkspaceBoundaryError({
          stateDir: environment.stateDir,
          workspaceRoot: unresolvedWorkspaceRoot,
          reason: "Symlink",
        });
      }
    }

    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    const canonicalBaseDir = yield* fileSystem.realPath(environment.baseDir);
    const canonicalStateDir = yield* fileSystem.realPath(environment.stateDir);
    const relativeStateDir = environment.path.relative(canonicalBaseDir, canonicalStateDir);
    if (
      relativeStateDir === ".." ||
      relativeStateDir.startsWith(`..${environment.path.sep}`) ||
      environment.path.isAbsolute(relativeStateDir)
    ) {
      return yield* new DesktopOfficeWorkspaceBoundaryError({
        stateDir: canonicalStateDir,
        workspaceRoot: unresolvedWorkspaceRoot,
        reason: "OutsideStateDirectory",
      });
    }
    const workspaceRoot = environment.path.resolve(canonicalStateDir, OFFICE_WORKSPACE_DIRECTORY);

    if (yield* fileSystem.exists(workspaceRoot)) {
      const linkTarget = yield* fileSystem.readLink(workspaceRoot).pipe(
        Effect.map((target) => target as string | undefined),
        Effect.orElseSucceed(() => undefined),
      );
      if (linkTarget !== undefined) {
        return yield* new DesktopOfficeWorkspaceBoundaryError({
          stateDir: canonicalStateDir,
          workspaceRoot,
          reason: "Symlink",
        });
      }
    }

    yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
    const canonicalWorkspaceRoot = yield* fileSystem.realPath(workspaceRoot);
    const relativeWorkspaceRoot = environment.path.relative(
      canonicalStateDir,
      canonicalWorkspaceRoot,
    );
    if (
      relativeWorkspaceRoot.length === 0 ||
      relativeWorkspaceRoot === ".." ||
      relativeWorkspaceRoot.startsWith(`..${environment.path.sep}`) ||
      environment.path.isAbsolute(relativeWorkspaceRoot)
    ) {
      return yield* new DesktopOfficeWorkspaceBoundaryError({
        stateDir: canonicalStateDir,
        workspaceRoot: canonicalWorkspaceRoot,
        reason: "OutsideStateDirectory",
      });
    }

    const linkTarget = yield* fileSystem.readLink(workspaceRoot).pipe(
      Effect.map((target) => target as string | undefined),
      Effect.orElseSucceed(() => undefined),
    );
    if (linkTarget !== undefined) {
      return yield* new DesktopOfficeWorkspaceBoundaryError({
        stateDir: canonicalStateDir,
        workspaceRoot,
        reason: "Symlink",
      });
    }

    const welcomePath = environment.path.join(canonicalWorkspaceRoot, OFFICE_WELCOME_FILE);
    const welcomeExists = yield* fileSystem.exists(welcomePath);
    if (!welcomeExists) {
      yield* fileSystem.writeFileString(welcomePath, OFFICE_WELCOME_CONTENT);
    }

    return canonicalWorkspaceRoot;
  },
);
