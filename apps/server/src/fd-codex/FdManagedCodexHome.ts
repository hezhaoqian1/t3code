// @effect-diagnostics nodeBuiltinImport:off
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const FD_CODEX_MODEL = "deepseek-v4-flash";
export const FD_CODEX_PROVIDER = "fd_new_api";
export const FD_CODEX_API_KEY_ENV = "FD_NEW_API_KEY";

export interface PrepareFdManagedCodexHomeInput {
  readonly codexHome: string;
  readonly newApiOrigin: string;
}

export async function prepareFdManagedCodexHome(
  input: PrepareFdManagedCodexHomeInput,
): Promise<string> {
  if (!isAbsolute(input.codexHome)) {
    throw new Error("Managed CODEX_HOME must be absolute");
  }

  const configPath = join(input.codexHome, "config.toml");
  const config = renderFdManagedCodexConfig(input.newApiOrigin);
  await mkdir(input.codexHome, { recursive: true, mode: 0o700 });
  await writeFileAtomically(configPath, config);
  return configPath;
}

export function renderFdManagedCodexConfig(newApiOrigin: string): string {
  const baseUrl = fdResponsesBaseUrl(newApiOrigin);
  return [
    `model = ${tomlString(FD_CODEX_MODEL)}`,
    `model_provider = ${tomlString(FD_CODEX_PROVIDER)}`,
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "",
    `[model_providers.${FD_CODEX_PROVIDER}]`,
    'name = "FD New API"',
    `base_url = ${tomlString(baseUrl)}`,
    `env_key = ${tomlString(FD_CODEX_API_KEY_ENV)}`,
    "requires_openai_auth = false",
    'wire_api = "responses"',
    "",
  ].join("\n");
}

export function fdResponsesBaseUrl(newApiOrigin: string): string {
  const url = new URL(newApiOrigin);
  const isLoopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
  ) {
    throw new Error("FD New API origin is invalid");
  }

  const base = new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
  return new URL("v1", base).href.replace(/\/$/, "");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
