import { type ModelSelection, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { FD_RESPONSES_MODEL } from "./FdResponsesProtocol.ts";

export const FD_DEEPSEEK_DRIVER_KIND = ProviderDriverKind.make("fd-deepseek");
export const FD_DEEPSEEK_INSTANCE_ID = ProviderInstanceId.make("fd-deepseek");

export const FD_DEEPSEEK_MODEL_SELECTION: ModelSelection = {
  instanceId: FD_DEEPSEEK_INSTANCE_ID,
  model: FD_RESPONSES_MODEL,
};
