import { type ProviderInstanceConfigMap } from "@t3tools/contracts";
import type * as Layer from "effect/Layer";

import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "../builtInDrivers.ts";
import { FD_DEEPSEEK_DRIVER_KIND, FD_DEEPSEEK_INSTANCE_ID } from "../../fd-agent/FdModelPolicy.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderInstanceRegistryMutableLayer } from "./ProviderInstanceRegistryLive.ts";

export const FD_DEEPSEEK_PROVIDER_INSTANCE_ID = FD_DEEPSEEK_INSTANCE_ID;

export const deriveProviderInstanceConfigMap = (): ProviderInstanceConfigMap =>
  ({
    [FD_DEEPSEEK_PROVIDER_INSTANCE_ID]: {
      driver: FD_DEEPSEEK_DRIVER_KIND,
      enabled: true,
      config: {},
    },
  }) as ProviderInstanceConfigMap;

export const ProviderInstanceRegistryHydrationLive: Layer.Layer<
  ProviderInstanceRegistry,
  never,
  BuiltInDriversEnv
> = ProviderInstanceRegistryMutableLayer({
  drivers: BUILT_IN_DRIVERS,
  configMap: deriveProviderInstanceConfigMap(),
});
