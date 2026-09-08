// @effect-diagnostics nodeBuiltinImport:off
import { isAbsolute } from "node:path";

import { FD_CODEX_API_KEY_ENV } from "./FdManagedCodexHome.ts";

const INHERITED_ENV_KEYS = [
  "HOME",
  "PATH",
  "SystemRoot",
  "ComSpec",
  "TMPDIR",
  "TEMP",
  "TMP",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export function makeFdCodexChildEnvironment(input: {
  readonly codexHome: string;
  readonly runtimeApiKey: string;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  if (
    input.runtimeApiKey.length === 0 ||
    input.runtimeApiKey.length > 65_536 ||
    /[\0\r\n]/.test(input.runtimeApiKey)
  ) {
    throw new Error("FD runtime credential is invalid");
  }
  const environment = makeBaseCodexChildEnvironment(input);
  environment[FD_CODEX_API_KEY_ENV] = input.runtimeApiKey;
  return environment;
}

export function makeResponsesCodexChildEnvironment(input: {
  readonly codexHome: string;
  readonly apiKeyEnv: string;
  readonly apiKey: string;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.apiKeyEnv)) {
    throw new Error("Responses API key environment variable is invalid");
  }
  if (input.apiKey.length === 0 || input.apiKey.length > 65_536 || /[\0\r\n]/.test(input.apiKey)) {
    throw new Error("Responses API credential is invalid");
  }
  const environment = makeBaseCodexChildEnvironment(input);
  environment[input.apiKeyEnv] = input.apiKey;
  return environment;
}

function makeBaseCodexChildEnvironment(input: {
  readonly codexHome: string;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  if (!isAbsolute(input.codexHome)) {
    throw new Error("Managed CODEX_HOME must be absolute");
  }
  const source = input.inheritedEnvironment ?? process.env;
  const environment: NodeJS.ProcessEnv = { CODEX_HOME: input.codexHome };
  for (const key of INHERITED_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  if (input.connectorBinPath) {
    const inheritedPath = environment.PATH ?? "";
    environment.PATH = inheritedPath
      ? `${input.connectorBinPath}${process.platform === "win32" ? ";" : ":"}${inheritedPath}`
      : input.connectorBinPath;
  }
  if (input.connectorConfigDir) {
    if (!isAbsolute(input.connectorConfigDir)) {
      throw new Error("Connector config directory must be absolute");
    }
    environment.LARKSUITE_CLI_CONFIG_DIR = input.connectorConfigDir;
  }
  return environment;
}
