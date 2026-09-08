import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";

const FD_PROVIDER_INSTANCE_ID = "fd-deepseek";

export function resolveAppModelSelection(
  _provider: ProviderDriverKind,
  _settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const models =
    providers.find((provider) => provider.instanceId === FD_PROVIDER_INSTANCE_ID)?.models ?? [];
  if (selectedModel && models.some((model) => model.slug === selectedModel)) {
    return selectedModel;
  }
  return models.find((model) => model.isDefault)?.slug ?? models[0]?.slug ?? "deepseek-v4-flash";
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  _settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string | null {
  if (instanceId !== FD_PROVIDER_INSTANCE_ID) return null;
  return resolveAppModelSelection(
    providers[0]?.driver ?? ("fd-deepseek" as ProviderDriverKind),
    _settings,
    providers,
    selectedModel,
  );
}
