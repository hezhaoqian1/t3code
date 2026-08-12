import {
  type ModelSelection,
  type ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderState,
} from "@t3tools/contracts";

export const FD_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("fd-deepseek");
export const FD_MODEL_SELECTION: ModelSelection = {
  instanceId: FD_PROVIDER_INSTANCE_ID,
  model: "deepseek-v4-flash",
};

export const NO_PROVIDER_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("t3code_no_provider"),
  model: "",
};

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly enabled: boolean;
  readonly status: ServerProviderState;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => ({
    instanceId: snapshot.instanceId,
    driverKind: snapshot.driver,
    displayName: snapshot.displayName ?? "FD DeepSeek",
    ...(snapshot.accentColor ? { accentColor: snapshot.accentColor } : {}),
    ...(snapshot.continuation?.groupKey
      ? { continuationGroupKey: snapshot.continuation.groupKey }
      : {}),
    enabled: snapshot.enabled,
    status: snapshot.status,
    isDefault: snapshot.instanceId === FD_PROVIDER_INSTANCE_ID,
    isAvailable: true,
    snapshot,
    models: snapshot.models,
  }));
}

export function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  return [...entries].toSorted((left, right) =>
    left.instanceId === FD_PROVIDER_INSTANCE_ID
      ? -1
      : right.instanceId === FD_PROVIDER_INSTANCE_ID
        ? 1
        : left.instanceId.localeCompare(right.instanceId),
  );
}

export function resolveSelectableProviderInstanceEntry(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  requestedInstanceId?: ProviderInstanceId | null,
): ProviderInstanceEntry | undefined {
  const selectable = (entry: ProviderInstanceEntry) =>
    entry.enabled && entry.isAvailable && entry.status === "ready" && entry.models.length > 0;
  return (
    entries.find((entry) => entry.instanceId === requestedInstanceId && selectable(entry)) ??
    entries.find(selectable)
  );
}

export function resolveProviderDriverKindForInstanceSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  _providers: ReadonlyArray<ServerProvider>,
  instanceId?: ProviderInstanceId | null,
): ProviderDriverKind | null {
  return entries.find((entry) => entry.instanceId === instanceId)?.driverKind ?? null;
}
