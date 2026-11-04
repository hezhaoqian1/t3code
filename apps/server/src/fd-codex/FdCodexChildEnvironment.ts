// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

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
  /** FD gateway origin; Codex reaches it directly, never through a system/VPN proxy. */
  readonly gatewayOrigin: string;
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
  /** Responses endpoint origin; Codex reaches it directly, never through a system/VPN proxy. */
  readonly gatewayOrigin: string;
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
  readonly gatewayOrigin: string;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  if (!NodePath.isAbsolute(input.codexHome)) {
    throw new Error("Managed CODEX_HOME must be absolute");
  }
  const source = input.inheritedEnvironment ?? process.env;
  const environment: NodeJS.ProcessEnv = { CODEX_HOME: input.codexHome };
  for (const key of INHERITED_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  // Codex follows the OS proxy (Windows Internet Settings, macOS network proxies) and
  // HTTP(S)_PROXY. A VPN in system-proxy mode would then send every model request
  // abroad and back to the domestic gateway, where long streams stall. The desktop's
  // own gateway calls already go direct; NO_PROXY keeps the model traffic on the same
  // path while other hosts still use the employee's proxy.
  environment.NO_PROXY = withDirectHost(environment.NO_PROXY, gatewayHost(input.gatewayOrigin));
  if (input.connectorBinPath) {
    const inheritedPath = environment.PATH ?? "";
    environment.PATH = inheritedPath
      ? `${input.connectorBinPath}${NodePath.delimiter}${inheritedPath}`
      : input.connectorBinPath;
  }
  if (input.connectorConfigDir) {
    if (!NodePath.isAbsolute(input.connectorConfigDir)) {
      throw new Error("Connector config directory must be absolute");
    }
    environment.LARKSUITE_CLI_CONFIG_DIR = input.connectorConfigDir;
  }
  return environment;
}

function gatewayHost(origin: string): string {
  const hostname = new URL(origin).hostname;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Adds `host` to a comma-separated NO_PROXY list, keeping the employee's own entries. */
export function withDirectHost(noProxy: string | undefined, host: string): string {
  const entries = (noProxy ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const normalizedHost = host.toLowerCase();
  const covered = entries.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized === "*" || normalized === normalizedHost;
  });
  return (covered ? entries : [...entries, host]).join(",");
}
