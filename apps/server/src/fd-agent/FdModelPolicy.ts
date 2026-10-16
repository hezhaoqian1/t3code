import { type ModelSelection, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { FD_RESPONSES_MODEL } from "./FdResponsesProtocol.ts";

export const FD_DEEPSEEK_DRIVER_KIND = ProviderDriverKind.make("fd-deepseek");
export const FD_DEEPSEEK_INSTANCE_ID = ProviderInstanceId.make("fd-deepseek");

export const FD_MODEL_UNAVAILABLE_MESSAGE = "当前模型已不可用，请切换 Flash 重试。";

export function isFdModelUnavailableError(message: string): boolean {
  return /model_not_found|no available channel|无可用渠道|当前模型已不可用|selected model is not advertised/i.test(
    message,
  );
}

export const FD_DEEPSEEK_MODEL_SELECTION: ModelSelection = {
  instanceId: FD_DEEPSEEK_INSTANCE_ID,
  model: FD_RESPONSES_MODEL,
};
