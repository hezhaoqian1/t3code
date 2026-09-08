// @effect-diagnostics nodeBuiltinImport:off
import {
  prepareResponsesCodexHome,
  renderResponsesCodexConfig,
  type ResponsesCodexProviderConfig,
} from "./ResponsesCodexConfig.ts";

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
  return prepareResponsesCodexHome({
    codexHome: input.codexHome,
    provider: fdProviderConfig(fdResponsesBaseUrl(input.newApiOrigin)),
  });
}

export function renderFdManagedCodexConfig(newApiOrigin: string): string {
  return renderResponsesCodexConfig(fdProviderConfig(fdResponsesBaseUrl(newApiOrigin)));
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

function fdProviderConfig(baseUrl: string): ResponsesCodexProviderConfig {
  return {
    providerId: FD_CODEX_PROVIDER,
    displayName: "FD New API",
    baseUrl,
    apiKeyEnv: FD_CODEX_API_KEY_ENV,
    defaultModel: FD_CODEX_MODEL,
    models: [
      {
        slug: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        shortName: "V4 Flash",
        supportsTools: true,
        supportsVision: false,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsForcedToolChoice: true,
        supportsParallelToolCalls: true,
      },
      {
        slug: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        shortName: "V4 Pro",
        supportsTools: true,
        supportsVision: false,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsForcedToolChoice: true,
        supportsParallelToolCalls: true,
      },
    ],
  };
}
