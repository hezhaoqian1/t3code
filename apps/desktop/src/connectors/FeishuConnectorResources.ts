import type * as Path from "effect/Path";

export interface FeishuConnectorResourceEnvironment {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly rootDir: string;
}

export function resolveFeishuConnectorResources(environment: FeishuConnectorResourceEnvironment): {
  readonly cliPath: string;
  readonly cliBinDir: string;
  readonly skillsSourceRoot: string;
} {
  const binaryName = environment.platform === "win32" ? "lark-cli.exe" : "lark-cli";
  const packageRoot = environment.isPackaged
    ? environment.path.join(`${environment.appPath}.unpacked`, "node_modules", "@larksuite", "cli")
    : environment.path.join(
        environment.rootDir,
        "apps",
        "desktop",
        "node_modules",
        "@larksuite",
        "cli",
      );

  return {
    cliPath: environment.path.join(packageRoot, "bin", binaryName),
    cliBinDir: environment.path.join(packageRoot, "bin"),
    skillsSourceRoot: environment.isPackaged
      ? environment.path.join(environment.resourcesPath, "connectors", "feishu", "skills")
      : environment.path.join(
          environment.rootDir,
          "apps",
          "desktop",
          "resources",
          "connectors",
          "feishu",
          "skills",
        ),
  };
}
