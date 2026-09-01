import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

export const desktopMessageFeedbackCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "提交回答反馈",
  tag: WS_METHODS.serverSetDesktopMessageFeedback,
  concurrency: {
    mode: "latest",
    key: ({ environmentId, input }) =>
      `${environmentId}:${input.clientThreadId}:${input.clientMessageId}`,
  },
});
