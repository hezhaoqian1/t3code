import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Rescans local skills and the account's FD Skills, then republishes the provider list. */
export const refreshProviderSkillsCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "刷新 Skill 列表",
  tag: WS_METHODS.serverRefreshProviderSkills,
  concurrency: {
    mode: "latest",
    key: ({ environmentId, input }) => `${environmentId}:${input.instanceId ?? "all"}`,
  },
});
