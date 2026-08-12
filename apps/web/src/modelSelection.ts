import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";

const FD_MODEL = "deepseek-v4-flash";

export function resolveAppModelSelection(
  _provider: ProviderDriverKind,
  _settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  _selectedModel: string | null | undefined,
): string {
  return (
    providers
      .find((provider) => provider.instanceId === "fd-deepseek")
      ?.models.find((model) => model.slug === FD_MODEL)?.slug ?? FD_MODEL
  );
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  _settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  _selectedModel: string | null | undefined,
): string | null {
  if (instanceId !== "fd-deepseek") return null;
  return resolveAppModelSelection(
    providers[0]?.driver ?? ("fd-deepseek" as ProviderDriverKind),
    _settings,
    providers,
    FD_MODEL,
  );
}
