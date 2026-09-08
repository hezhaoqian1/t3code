import type { ResponsesCodexProviderConfig } from "./ResponsesCodexConfig.ts";

export const FD_RESPONSES_PROVIDER: ResponsesCodexProviderConfig = {
  providerId: "fd_new_api",
  displayName: "FD New API",
  baseUrl: "https://fd.invalid/v1",
  apiKeyEnv: "FD_NEW_API_KEY",
  defaultModel: "deepseek-v4-flash",
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

/**
 * DashScope's OpenAI-compatible Responses endpoint. This catalog is kept
 * separate from the FD entitlement catalog so adding an external backend
 * cannot accidentally expand the FD runtime policy.
 */
export const DASHSCOPE_RESPONSES_PROVIDER: ResponsesCodexProviderConfig = {
  providerId: "dashscope",
  displayName: "DashScope Responses",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  defaultModel: "qwen3.8-flash",
  models: [
    {
      slug: "qwen3.8-max",
      name: "Qwen 3.8 Max",
      shortName: "Qwen Max",
      providerId: "dashscope",
      providerDisplayName: "DashScope Responses",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "qwen3.8-flash",
      name: "Qwen 3.8 Flash",
      shortName: "Qwen Flash",
      providerId: "dashscope",
      providerDisplayName: "DashScope Responses",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "glm-5.2",
      name: "GLM 5.2",
      shortName: "GLM 5.2",
      providerId: "dashscope",
      providerDisplayName: "DashScope Responses",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "kimi-k3",
      name: "Kimi K3",
      shortName: "Kimi K3",
      providerId: "dashscope",
      providerDisplayName: "DashScope Responses",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
  ],
};

/** Name used by the server-owned secret store; never sent to the renderer. */
export const DASHSCOPE_API_KEY_SECRET_NAME = "dashscope-api-key";

export const DASHSCOPE_RESPONSES_MODEL_SLUGS = DASHSCOPE_RESPONSES_PROVIDER.models.map(
  (model) => model.slug,
);

export const FD_RESPONSES_PROVIDERS = [
  FD_RESPONSES_PROVIDER,
  DASHSCOPE_RESPONSES_PROVIDER,
] as const;
export const FD_RESPONSES_MODEL_CATALOG = FD_RESPONSES_PROVIDERS.flatMap(
  (provider) => provider.models,
);
