import type {
  ResponsesCodexModelConfig,
  ResponsesCodexProviderConfig,
} from "./ResponsesCodexConfig.ts";

export const FD_RESPONSES_PROVIDER: ResponsesCodexProviderConfig = {
  providerId: "fd_new_api",
  displayName: "FD New API",
  baseUrl: "https://fd.invalid/v1",
  apiKeyEnv: "FD_NEW_API_KEY",
  defaultModel: "deepseek-flash",
  models: [
    {
      slug: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      shortName: "Flash",
      supportsTools: true,
      supportsVision: true,
      visionRoute: "native",
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
      visionRoute: "unsupported",
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: true,
      supportsParallelToolCalls: true,
    },
    {
      slug: "qwen3.8-max",
      name: "Qwen 3.8 Max",
      shortName: "Qwen Max",
      supportsTools: true,
      supportsVision: true,
      visionRoute: "native",
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "qwen3.8-flash",
      name: "Qwen 3.8 Flash",
      shortName: "Qwen Flash",
      supportsTools: true,
      supportsVision: true,
      visionRoute: "native",
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "glm-5.2",
      name: "GLM 5.2",
      shortName: "GLM 5.2",
      supportsTools: true,
      supportsVision: false,
      visionRoute: "unsupported",
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
    {
      slug: "kimi-k3",
      name: "Kimi K3",
      shortName: "Kimi K3",
      supportsTools: true,
      supportsVision: true,
      visionRoute: "native",
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsForcedToolChoice: false,
      supportsParallelToolCalls: false,
    },
  ],
};
export const FD_RESPONSES_PROVIDERS = [FD_RESPONSES_PROVIDER] as const;
export const FD_RESPONSES_MODEL_CATALOG = FD_RESPONSES_PROVIDERS.flatMap(
  (provider) => provider.models,
);

/** Models accepted by the provider boundary, including persisted legacy names. */
export function isFdResponsesModelAdvertised(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return (
    FD_RESPONSES_MODEL_CATALOG.some((model) => model.slug === normalized) ||
    normalized === "deepseek-v4-flash" ||
    normalized === "deepseek-v4-flash-vision-exp"
  );
}
/** Resolve a static or server-authorized model without duplicating capability
 * inference in each attachment and provider path. Unknown models are only
 * surfaced after the authenticated New API catalog authorizes them. */
export function resolveFdResponsesModelConfig(slug: string): ResponsesCodexModelConfig | undefined {
  const normalized = slug.trim().toLowerCase();
  const canonicalSlug =
    normalized === "deepseek-v4-flash" || normalized === "deepseek-v4-flash-vision-exp"
      ? "deepseek-flash"
      : normalized;
  const known = FD_RESPONSES_MODEL_CATALOG.find((model) => model.slug === canonicalSlug);
  if (known) {
    if (canonicalSlug === "deepseek-flash" && canonicalSlug !== normalized) {
      // Keep the legacy desktop route stable while new sessions use the
      // canonical Flash model's native image input.
      return { ...known, slug, name: slug, shortName: slug, supportsVision: false, visionRoute: "fd-preprocessor" };
    }
    return known;
  }
  if (normalized.length === 0) return undefined;
  const supportsVision = /vision|vl|image|omni|kimi/.test(normalized);
  return {
    slug,
    name: slug,
    shortName: slug,
    supportsTools: true,
    supportsVision,
    visionRoute: supportsVision ? "native" : "unsupported",
    supportsReasoning: true,
    supportsStructuredOutput: true,
    supportsForcedToolChoice: false,
    supportsParallelToolCalls: false,
  };
}
