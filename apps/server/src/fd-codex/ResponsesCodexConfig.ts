// @effect-diagnostics nodeBuiltinImport:off
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Model-level policy used by a Responses-backed Codex instance.
 *
 * This is deliberately server-side metadata. It is not sent to the renderer
 * as a credential or transport setting; the provider snapshot can project the
 * safe subset of it as model capabilities later.
 */
export interface ResponsesCodexModelConfig {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string;
  /** Provider route for this model when one instance hosts multiple backends. */
  readonly providerId?: string;
  readonly providerDisplayName?: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  /** Image handling route. This is server-side policy, not a provider claim. */
  readonly visionRoute: "native" | "fd-preprocessor" | "unsupported";
  readonly supportsReasoning: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsForcedToolChoice: boolean;
  readonly supportsParallelToolCalls: boolean;
}

export interface ResponsesCodexProviderConfig {
  readonly providerId: string;
  readonly displayName: string;
  /** Fully qualified Responses-compatible base URL, normally ending in /v1. */
  readonly baseUrl: string;
  /** Environment variable read by Codex for this provider's API key. */
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
  readonly models: ReadonlyArray<ResponsesCodexModelConfig>;
}

export function findResponsesCodexModel(
  providers: ReadonlyArray<ResponsesCodexProviderConfig>,
  slug: string,
):
  | { readonly provider: ResponsesCodexProviderConfig; readonly model: ResponsesCodexModelConfig }
  | undefined {
  for (const provider of providers) {
    const model = provider.models.find((candidate) => candidate.slug === slug);
    if (model) return { provider, model };
  }
  return undefined;
}

export interface PrepareResponsesCodexHomeInput {
  readonly codexHome: string;
  readonly provider: ResponsesCodexProviderConfig;
}

export async function prepareResponsesCodexHome(
  input: PrepareResponsesCodexHomeInput,
): Promise<string> {
  if (!isAbsolute(input.codexHome)) {
    throw new Error("Managed CODEX_HOME must be absolute");
  }

  const configPath = join(input.codexHome, "config.toml");
  await mkdir(input.codexHome, { recursive: true, mode: 0o700 });
  await writeFileAtomically(configPath, renderResponsesCodexConfig(input.provider));
  return configPath;
}

export function renderResponsesCodexConfig(provider: ResponsesCodexProviderConfig): string {
  validateProviderConfig(provider);
  return [
    `model = ${tomlString(provider.defaultModel)}`,
    `model_provider = ${tomlString(provider.providerId)}`,
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "",
    `[model_providers.${provider.providerId}]`,
    `name = ${tomlString(provider.displayName)}`,
    `base_url = ${tomlString(provider.baseUrl)}`,
    `env_key = ${tomlString(provider.apiKeyEnv)}`,
    "requires_openai_auth = false",
    'wire_api = "responses"',
    "",
  ].join("\n");
}

function validateProviderConfig(provider: ResponsesCodexProviderConfig): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(provider.providerId)) {
    throw new Error("Responses provider id is invalid");
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(provider.apiKeyEnv)) {
    throw new Error("Responses API key environment variable is invalid");
  }
  if (
    provider.defaultModel.length === 0 ||
    !provider.models.some((model) => model.slug === provider.defaultModel)
  ) {
    throw new Error("Responses provider default model is not in the model catalog");
  }
  const url = new URL(provider.baseUrl);
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    !url.pathname.endsWith("/v1")
  ) {
    throw new Error("Responses provider base URL is invalid");
  }
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
