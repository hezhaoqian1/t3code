// @effect-diagnostics nodeBuiltinImport:off
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ServerConfig } from "../config.ts";
import { FdRuntimeCredentialStore } from "../fd/FdRuntimeCredentialStore.ts";
import { ProviderAdapterRequestError } from "../provider/Errors.ts";
import { makeCodexAdapter } from "../provider/Layers/CodexAdapter.ts";
import { FD_DEEPSEEK_DRIVER_KIND } from "../provider/Layers/FdDeepSeekAdapter.ts";
import { FdEnterpriseCodexClient } from "../fd-skills/FdEnterpriseCodexClient.ts";
import { NativeSkillCatalog, selectedNativeSkillNames } from "../fd-skills/NativeSkillCatalog.ts";
import { makeFdCodexChildEnvironment } from "./FdCodexChildEnvironment.ts";
import { prepareFdManagedCodexHome } from "./FdManagedCodexHome.ts";

export async function resolveFdCodexTurnSkills(input: {
  readonly cwd: string;
  readonly prompt: string;
  readonly userHome?: string;
  readonly extraRoots?: ReadonlyArray<string>;
  readonly connectorStatePath?: string | undefined;
}): Promise<ReadonlyArray<{ readonly name: string; readonly path: string }>> {
  const selectedNames = selectedNativeSkillNames(input.prompt);
  if (selectedNames.length === 0) return [];
  const connectorEnabled = await readConnectorEnabled(input.connectorStatePath);

  const catalog = new NativeSkillCatalog({
    projectRoot: input.cwd,
    extraRoots: connectorEnabled ? (input.extraRoots ?? []) : [],
    ...(input.userHome ? { userHome: input.userHome } : {}),
  });
  const snapshot = await catalog.refresh();
  const skillsByName = new Map(snapshot.skills.map((skill) => [skill.name, skill] as const));
  return selectedNames.flatMap((name) => {
    const skill = skillsByName.get(name);
    return skill ? [{ name: skill.name, path: skill.skillPath }] : [];
  });
}

export async function prepareFdCodexRuntime(input: {
  readonly stateDir: string;
  readonly credentials: FdServerRuntimeCredentialProjection;
  readonly connectorSkillsRoot?: string | undefined;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly connectorStatePath?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): Promise<{
  readonly environment: NodeJS.ProcessEnv;
  readonly homePath: string;
  readonly skillExtraRoots?: ReadonlyArray<string>;
}> {
  const codexHome = join(input.stateDir, "codex-home");
  const connectorEnabled = await readConnectorEnabled(input.connectorStatePath);
  await prepareFdManagedCodexHome({
    codexHome,
    newApiOrigin: input.credentials.newApiOrigin,
  });
  return {
    homePath: codexHome,
    ...(connectorEnabled && input.connectorSkillsRoot
      ? { skillExtraRoots: [input.connectorSkillsRoot] }
      : {}),
    environment: makeFdCodexChildEnvironment({
      codexHome,
      runtimeApiKey: input.credentials.runtimeApiKey,
      connectorBinPath: connectorEnabled ? input.connectorBinPath : undefined,
      connectorConfigDir: connectorEnabled ? input.connectorConfigDir : undefined,
      ...(input.inheritedEnvironment ? { inheritedEnvironment: input.inheritedEnvironment } : {}),
    }),
  };
}

export const makeFdCodexAdapter = Effect.fn("makeFdCodexAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath?: string;
}) {
  const credentials = yield* FdRuntimeCredentialStore;
  const serverConfig = yield* ServerConfig;
  const enterpriseClient = new FdEnterpriseCodexClient({
    credentials: () => Effect.runPromise(credentials.current).then(Option.getOrUndefined),
  });

  return yield* makeCodexAdapter(
    {
      binaryPath: input.binaryPath ?? process.env.FD_CODEX_BINARY ?? "codex",
    },
    {
      instanceId: input.instanceId,
      resolveRuntime: () =>
        Effect.gen(function* () {
          const current = yield* credentials.current;
          if (Option.isNone(current)) {
            return yield* new ProviderAdapterRequestError({
              provider: FD_DEEPSEEK_DRIVER_KIND,
              method: "session/start",
              detail: "Sign in to FD before starting an Agent session.",
            });
          }

          const projection = current.value;
          return yield* Effect.tryPromise({
            try: () =>
              prepareFdCodexRuntime({
                stateDir: serverConfig.stateDir,
                credentials: projection,
                connectorSkillsRoot: serverConfig.fdConnectorSkillsRoot,
                connectorBinPath: serverConfig.fdConnectorBinPath,
                connectorConfigDir: serverConfig.fdConnectorConfigDir,
                connectorStatePath: serverConfig.fdConnectorStatePath,
              }),
            catch: () =>
              new ProviderAdapterRequestError({
                provider: FD_DEEPSEEK_DRIVER_KIND,
                method: "session/start",
                detail: "FD Agent runtime configuration could not be prepared.",
              }),
          });
        }),
      resolveTurnSkills: (turn) =>
        Effect.tryPromise({
          try: () =>
            resolveFdCodexTurnSkills({
              ...turn,
              connectorStatePath: serverConfig.fdConnectorStatePath,
              extraRoots: serverConfig.fdConnectorSkillsRoot
                ? [serverConfig.fdConnectorSkillsRoot]
                : [],
            }),
          catch: () =>
            new ProviderAdapterRequestError({
              provider: FD_DEEPSEEK_DRIVER_KIND,
              method: "turn/start",
              detail: "Selected local Skill could not be loaded safely.",
            }),
        }),
      resolveSessionRuntime: (session) => {
        if (session.fdSkillVersionId === undefined) return Effect.succeed({});
        const skillVersionId = session.fdSkillVersionId;
        return Effect.tryPromise({
          try: () =>
            enterpriseClient.getRuntimeContext({
              skillVersionId,
              clientThreadId: session.threadId,
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: FD_DEEPSEEK_DRIVER_KIND,
              method: "session/start",
              detail: "Authorized FD Skill runtime context is unavailable.",
              cause,
            }),
        }).pipe(
          Effect.map((runtimeContext) => ({
            developerInstructions: runtimeContext.developer_instructions,
            dynamicTools: runtimeContext.tools.map((tool) => ({
              type: "function" as const,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.input_schema,
            })),
            dynamicToolExecutor: (request) =>
              Effect.tryPromise(() =>
                enterpriseClient.executeToolCall({
                  skillVersionId,
                  releaseDigest: runtimeContext.release_digest,
                  clientThreadId: session.threadId,
                  providerThreadId: request.threadId,
                  turnId: request.turnId,
                  callId: request.callId,
                  tool: request.tool,
                  arguments: request.arguments,
                }),
              ).pipe(
                Effect.match({
                  onFailure: () => ({
                    success: false,
                    contentItems: [
                      {
                        type: "inputText" as const,
                        text: "FD enterprise tool call failed or its authorization changed.",
                      },
                    ],
                  }),
                  onSuccess: (result) => ({
                    success: true,
                    contentItems: [
                      {
                        type: "inputText" as const,
                        text: JSON.stringify({
                          audit_id: result.audit_id,
                          content: result.content,
                          row_count: result.row_count ?? 0,
                          truncated: result.truncated ?? false,
                        }),
                      },
                    ],
                  }),
                }),
              ),
          })),
        );
      },
    },
  );
});

async function readConnectorEnabled(statePath: string | undefined): Promise<boolean> {
  if (!statePath) return false;
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
