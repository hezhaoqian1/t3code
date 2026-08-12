import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
  readonly defaultBaseDir?: string;
}): string {
  return Option.getOrElse(
    normalizeConfiguredBaseDir(input.t3Home),
    () => input.defaultBaseDir ?? input.joinPath(input.homeDirectory, ".t3"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  if (Option.isSome(normalizeConfiguredBaseDir(input.t3Home))) {
    return input.joinPath(input.baseDir, "userdata");
  }
  return input.isDevelopment ? input.joinPath(input.baseDir, "dev") : input.baseDir;
}
