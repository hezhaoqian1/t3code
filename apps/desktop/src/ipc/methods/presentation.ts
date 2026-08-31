// @effect-diagnostics nodeBuiltinImport:off
import {
  PresentationExportInput,
  PresentationExportResult,
  PresentationOpenInput,
  PresentationReadProjectInput,
  PresentationReadProjectResult,
  PresentationWriteFileInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const spawn = promisify(NodeChildProcess.execFile);

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = NodePath.resolve(root);
  const normalizedCandidate = NodePath.resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${NodePath.sep}`)
  );
}

async function resolveTaskProject(
  environment: {
    readonly path: { resolve: (...parts: string[]) => string };
    readonly homeDirectory: string;
    readonly stateDir: string;
  },
  projectPath: string,
): Promise<string> {
  const tasksRoot = environment.path.resolve(environment.homeDirectory, "FangdeAI", "Tasks");
  const officeWorkspaceRoot = environment.path.resolve(environment.stateDir, "office-workspace");
  const resolved = environment.path.resolve(projectPath);
  if (!isPathInside(tasksRoot, resolved) && !isPathInside(officeWorkspaceRoot, resolved))
    throw new Error("presentation-project-outside-task-workspace");
  const [realTasksRoot, realOfficeWorkspaceRoot, realProjectPath] = await Promise.all([
    NodeFS.realpath(tasksRoot),
    NodeFS.realpath(officeWorkspaceRoot).catch(() => officeWorkspaceRoot),
    NodeFS.realpath(resolved),
  ]);
  if (
    !isPathInside(realTasksRoot, realProjectPath) &&
    !isPathInside(realOfficeWorkspaceRoot, realProjectPath)
  ) {
    throw new Error("presentation-project-outside-task-workspace");
  }
  return realProjectPath;
}

export const exportPresentation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRESENTATION_EXPORT_CHANNEL,
  payload: PresentationExportInput,
  result: PresentationExportResult,
  handler: Effect.fn("desktop.ipc.presentation.export")(function* ({ projectPath }) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const resolvedProjectPath = yield* Effect.tryPromise(() =>
      resolveTaskProject(environment, projectPath),
    );
    const stat = yield* Effect.tryPromise(() => NodeFS.stat(resolvedProjectPath));
    if (!stat.isDirectory())
      return yield* Effect.die(new Error("presentation-project-not-directory"));
    const exporter = environment.isPackaged
      ? environment.path.join(
          environment.resourcesPath,
          "presentation",
          "fd-presentation-studio",
          "scripts",
          "local-export",
          "export-pptd.mjs",
        )
      : environment.path.join(
          environment.rootDir,
          "apps/desktop/resources/presentation/fd-presentation-studio/scripts/local-export/export-pptd.mjs",
        );
    const outputPath = environment.path.join(
      resolvedProjectPath,
      `${NodePath.basename(resolvedProjectPath)}.pptx`,
    );
    yield* Effect.tryPromise(() => NodeFS.rm(outputPath, { force: true }));
    yield* Effect.tryPromise(async () => {
      await spawn(
        process.execPath,
        [
          exporter,
          resolvedProjectPath,
          "--output",
          outputPath,
          "--no-sign",
          "--transition",
          "fade",
        ],
        {
          cwd: resolvedProjectPath,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            FD_PRESENTATION_NODE_MODULES: environment.path.join(
              environment.appPath,
              "node_modules",
            ),
            KIMI_COOKIE: "",
            KIMI_ORIGIN: "",
          },
          maxBuffer: 32 * 1024 * 1024,
        },
      );
    });
    const pagesPath = environment.path.join(resolvedProjectPath, "pages");
    const entries = yield* Effect.tryPromise(() => NodeFS.readdir(pagesPath));
    const pageCount = entries.filter((name) => name.endsWith(".page")).length;
    if (pageCount < 1) return yield* Effect.die(new Error("presentation-pages-missing"));
    return { projectPath: resolvedProjectPath, pptxPath: outputPath, pageCount };
  }),
});

export const openPresentation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRESENTATION_OPEN_CHANNEL,
  payload: PresentationOpenInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.presentation.open")(function* ({ projectPath }) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const resolvedProjectPath = yield* Effect.tryPromise(() =>
      resolveTaskProject(environment, projectPath),
    );
    const stat = yield* Effect.tryPromise(() => NodeFS.stat(resolvedProjectPath));
    if (!stat.isDirectory())
      return yield* Effect.die(new Error("presentation-project-not-directory"));
    const editorPath = environment.isPackaged
      ? environment.path.join(
          environment.resourcesPath,
          "presentation",
          "fd-presentation-studio",
          "editor",
          "index.html",
        )
      : environment.path.join(
          environment.rootDir,
          "apps/desktop/resources/presentation/fd-presentation-studio/editor/index.html",
        );
    const editorWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1100,
      minHeight: 700,
      title: "方德演示",
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: environment.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    editorWindow.setMenuBarVisibility(false);
    yield* Effect.tryPromise(() =>
      editorWindow.loadFile(editorPath, {
        search: `?desktopProjectPath=${encodeURIComponent(resolvedProjectPath)}`,
      }),
    );
  }),
});

export const readPresentationProject = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRESENTATION_READ_PROJECT_CHANNEL,
  payload: PresentationReadProjectInput,
  result: PresentationReadProjectResult,
  handler: Effect.fn("desktop.ipc.presentation.readProject")(function* ({ projectPath }) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const resolvedProjectPath = yield* Effect.tryPromise(() =>
      resolveTaskProject(environment, projectPath),
    );
    const files: Array<{ path: string; content: string; dataUrl?: string }> = [];
    const walk = async (directory: string, prefix = ""): Promise<void> => {
      for (const entry of await NodeFS.readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".DS_Store" || entry.name === ".git") continue;
        const absolute = NodePath.join(directory, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(absolute, relative);
        else if (entry.isFile()) {
          const ext = NodePath.extname(entry.name).toLowerCase();
          if (![".pptd", ".page", ".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext)) continue;
          const bytes = await NodeFS.readFile(absolute);
          const isImage = [".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext);
          files.push({
            path: relative,
            content: isImage ? "" : bytes.toString("utf8"),
            ...(isImage
              ? {
                  dataUrl: `data:${ext === ".svg" ? "image/svg+xml" : `image/${ext.slice(1)}`};base64,${bytes.toString("base64")}`,
                }
              : {}),
          });
        }
      }
    };
    yield* Effect.tryPromise(() => walk(resolvedProjectPath));
    return { projectPath: resolvedProjectPath, files };
  }),
});

export const writePresentationFile = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRESENTATION_WRITE_FILE_CHANNEL,
  payload: PresentationWriteFileInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.presentation.writeFile")(function* ({
    projectPath,
    relativePath,
    content,
  }) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const resolvedProjectPath = yield* Effect.tryPromise(() =>
      resolveTaskProject(environment, projectPath),
    );
    if (!/^(?:[^/]+\/)*[^/]+\.(?:pptd|page)$/i.test(relativePath) || relativePath.includes("..")) {
      return yield* Effect.die(new Error("presentation-file-path-invalid"));
    }
    const target = environment.path.resolve(resolvedProjectPath, relativePath);
    if (!isPathInside(resolvedProjectPath, target))
      return yield* Effect.die(new Error("presentation-file-outside-project"));
    const parent = NodePath.dirname(target);
    const realParent = yield* Effect.tryPromise(() => NodeFS.realpath(parent).catch(() => parent));
    if (!isPathInside(resolvedProjectPath, realParent)) {
      return yield* Effect.die(new Error("presentation-file-outside-project"));
    }
    const existingTarget = yield* Effect.tryPromise(() =>
      NodeFS.realpath(target).catch(() => target),
    );
    if (!isPathInside(resolvedProjectPath, existingTarget)) {
      return yield* Effect.die(new Error("presentation-file-outside-project"));
    }
    yield* Effect.tryPromise(() => NodeFS.mkdir(NodePath.dirname(target), { recursive: true }));
    yield* Effect.tryPromise(() => NodeFS.writeFile(target, content, "utf8"));
  }),
});

export const methods = [
  exportPresentation,
  openPresentation,
  readPresentationProject,
  writePresentationFile,
] as const;
