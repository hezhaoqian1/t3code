import type * as CodexSchema from "effect-codex-app-server/schema";

import packageJson from "../../package.json" with { type: "json" };

export function buildFdCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "fd_ai_desktop",
      title: "FD AI Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}
