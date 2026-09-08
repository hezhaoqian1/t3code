// @effect-diagnostics nodeBuiltinImport:off,runEffectInsideEffect:off
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ServerConfig } from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { FdRuntimeCredentialStore } from "../fd/FdRuntimeCredentialStore.ts";
import { ProviderAdapterRequestError } from "../provider/Errors.ts";
import { makeCodexAdapter } from "../provider/Layers/CodexAdapter.ts";
import { FD_DEEPSEEK_DRIVER_KIND } from "../provider/Layers/FdDeepSeekAdapter.ts";
import {
  FdEnterpriseCodexClient,
  FdEnterpriseCodexError,
} from "../fd-skills/FdEnterpriseCodexClient.ts";
import { NativeSkillCatalog, selectedNativeSkillNames } from "../fd-skills/NativeSkillCatalog.ts";
import {
  makeFdCodexChildEnvironment,
  makeResponsesCodexChildEnvironment,
} from "./FdCodexChildEnvironment.ts";
import { prepareFdManagedCodexHome } from "./FdManagedCodexHome.ts";
import {
  DASHSCOPE_API_KEY_SECRET_NAME,
  DASHSCOPE_RESPONSES_PROVIDER,
  FD_RESPONSES_PROVIDERS,
} from "./ResponsesModelCatalog.ts";
import { findResponsesCodexModel } from "./ResponsesCodexConfig.ts";
import { prepareResponsesCodexHome } from "./ResponsesCodexConfig.ts";

export async function resolveFdCodexTurnSkills(input: {
  readonly cwd: string;
  readonly prompt: string;
  readonly nativeSkillNames?: ReadonlyArray<string>;
  readonly userHome?: string;
  readonly extraRoots?: ReadonlyArray<string>;
  readonly managedRoots?: ReadonlyArray<string>;
  readonly connectorStatePath?: string | undefined;
}): Promise<ReadonlyArray<{ readonly name: string; readonly path: string }>> {
  const selectedNames = input.nativeSkillNames?.length
    ? input.nativeSkillNames
    : selectedNativeSkillNames(input.prompt);
  if (selectedNames.length === 0) return [];
  const connectorEnabled = await readConnectorEnabled(input.connectorStatePath);

  const catalog = new NativeSkillCatalog({
    projectRoot: input.cwd,
    extraRoots: connectorEnabled ? (input.extraRoots ?? []) : [],
    ...(input.managedRoots ? { managedRoots: input.managedRoots } : {}),
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
  readonly credentials?: FdServerRuntimeCredentialProjection;
  readonly connectorSkillsRoot?: string | undefined;
  readonly connectorBinPath?: string | undefined;
  readonly connectorConfigDir?: string | undefined;
  readonly connectorStatePath?: string | undefined;
  readonly presentationSkillRoot?: string | undefined;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
  /** Optional server-resolved key. Environment remains a development fallback. */
  readonly dashScopeApiKey?: string;
  readonly model?: string;
}): Promise<{
  readonly environment: NodeJS.ProcessEnv;
  readonly homePath: string;
  readonly skillExtraRoots?: ReadonlyArray<string>;
}> {
  const selected = input.model
    ? findResponsesCodexModel(FD_RESPONSES_PROVIDERS, input.model)
    : undefined;
  const isDashScope = selected?.provider.providerId === DASHSCOPE_RESPONSES_PROVIDER.providerId;
  const codexHome = join(input.stateDir, isDashScope ? `codex-home-${input.model}` : "codex-home");
  const connectorEnabled = await readConnectorEnabled(input.connectorStatePath);
  if (isDashScope) {
    const apiKey =
      input.dashScopeApiKey ??
      input.inheritedEnvironment?.["DASHSCOPE_API_KEY"] ??
      process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required for the selected model");
    await prepareResponsesCodexHome({
      codexHome,
      provider: DASHSCOPE_RESPONSES_PROVIDER,
    });
  } else {
    if (!input.credentials) throw new Error("Sign in to FD before starting an Agent session.");
    await prepareFdManagedCodexHome({
      codexHome,
      newApiOrigin: input.credentials.newApiOrigin,
    });
  }
  const skillExtraRoots = [
    ...(input.presentationSkillRoot ? [input.presentationSkillRoot] : []),
    ...(connectorEnabled && input.connectorSkillsRoot ? [input.connectorSkillsRoot] : []),
  ];
  return {
    homePath: codexHome,
    ...(skillExtraRoots.length > 0 ? { skillExtraRoots } : {}),
    environment: isDashScope
      ? makeResponsesCodexChildEnvironment({
          codexHome,
          apiKeyEnv: "DASHSCOPE_API_KEY",
          apiKey:
            input.dashScopeApiKey ??
            input.inheritedEnvironment?.["DASHSCOPE_API_KEY"] ??
            process.env.DASHSCOPE_API_KEY!,
          connectorBinPath: connectorEnabled ? input.connectorBinPath : undefined,
          connectorConfigDir: connectorEnabled ? input.connectorConfigDir : undefined,
          ...(input.inheritedEnvironment
            ? { inheritedEnvironment: input.inheritedEnvironment }
            : {}),
        })
      : makeFdCodexChildEnvironment({
          codexHome,
          runtimeApiKey:
            input.credentials?.runtimeApiKey ??
            (() => {
              throw new Error("FD runtime credential is unavailable");
            })(),
          connectorBinPath: connectorEnabled ? input.connectorBinPath : undefined,
          connectorConfigDir: connectorEnabled ? input.connectorConfigDir : undefined,
          ...(input.inheritedEnvironment
            ? { inheritedEnvironment: input.inheritedEnvironment }
            : {}),
        }),
  };
}

export const makeFdCodexAdapter = Effect.fn("makeFdCodexAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath?: string;
}) {
  const credentials = yield* FdRuntimeCredentialStore;
  const secretStore = yield* Effect.serviceOption(ServerSecretStore.ServerSecretStore);
  const serverConfig = yield* ServerConfig;
  const credentialsContext = yield* Effect.context<FdRuntimeCredentialStore>();
  const runCredentialPromise = Effect.runPromiseWith(credentialsContext);
  const enterpriseClient = new FdEnterpriseCodexClient({
    credentials: () => runCredentialPromise(credentials.current).then(Option.getOrUndefined),
  });

  return yield* makeCodexAdapter(
    {
      binaryPath: input.binaryPath ?? process.env.FD_CODEX_BINARY ?? "codex",
    },
    {
      instanceId: input.instanceId,
      resolveModelCapabilities: (model) =>
        findResponsesCodexModel(FD_RESPONSES_PROVIDERS, model)?.model,
      resolveModelRuntimeKey: (model) =>
        findResponsesCodexModel(FD_RESPONSES_PROVIDERS, model)?.provider.providerId,
      resolveRuntime: (session) =>
        Effect.gen(function* () {
          const current = yield* credentials.current;
          const requestedModel = session.modelSelection?.model;
          const externalModel = requestedModel
            ? findResponsesCodexModel(FD_RESPONSES_PROVIDERS, requestedModel)?.provider
                .providerId === DASHSCOPE_RESPONSES_PROVIDER.providerId
            : false;
          if (Option.isNone(current) && !externalModel) {
            return yield* new ProviderAdapterRequestError({
              provider: FD_DEEPSEEK_DRIVER_KIND,
              method: "session/start",
              detail: "Sign in to FD before starting an Agent session.",
            });
          }

          const runtimeInput = {
            stateDir: serverConfig.stateDir,
            connectorSkillsRoot: serverConfig.fdConnectorSkillsRoot,
            connectorBinPath: serverConfig.fdConnectorBinPath,
            connectorConfigDir: serverConfig.fdConnectorConfigDir,
            connectorStatePath: serverConfig.fdConnectorStatePath,
            presentationSkillRoot: serverConfig.fdPresentationSkillRoot,
            ...(session.modelSelection?.model ? { model: session.modelSelection.model } : {}),
          } as const;
          const dashScopeApiKey = yield* readDashScopeApiKey(secretStore);
          const runtimeKey =
            (requestedModel
              ? findResponsesCodexModel(FD_RESPONSES_PROVIDERS, requestedModel)?.provider.providerId
              : undefined) ?? "fd_new_api";
          return yield* Effect.tryPromise({
            try: () =>
              Option.isSome(current)
                ? prepareFdCodexRuntime({
                    ...runtimeInput,
                    credentials: current.value,
                    ...(dashScopeApiKey ? { dashScopeApiKey } : {}),
                  })
                : prepareFdCodexRuntime({
                    ...runtimeInput,
                    ...(dashScopeApiKey ? { dashScopeApiKey } : {}),
                  }),
            catch: () =>
              new ProviderAdapterRequestError({
                provider: FD_DEEPSEEK_DRIVER_KIND,
                method: "session/start",
                detail: "FD Agent runtime configuration could not be prepared.",
              }),
          }).pipe(
            Effect.map((runtime) => ({
              ...runtime,
              runtimeKey,
            })),
          );
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
              managedRoots: serverConfig.fdPresentationSkillRoot
                ? [serverConfig.fdPresentationSkillRoot]
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
                  onFailure: (cause) => ({
                    success: false,
                    contentItems: [
                      {
                        type: "inputText" as const,
                        text: fdEnterpriseToolFailureMessage(cause),
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

function readDashScopeApiKey(
  secretStore: Option.Option<ServerSecretStore.ServerSecretStore["Service"]>,
): Effect.Effect<string | undefined> {
  const storedKey = Option.isSome(secretStore)
    ? secretStore.value.get(DASHSCOPE_API_KEY_SECRET_NAME)
    : Effect.succeed(Option.none<Uint8Array>());
  return storedKey.pipe(
    Effect.map((stored) => {
      if (Option.isSome(stored)) {
        const value = new TextDecoder().decode(stored.value).trim();
        if (value.length > 0) return value;
      }
      const environmentValue = process.env.DASHSCOPE_API_KEY?.trim();
      return environmentValue && environmentValue.length > 0 ? environmentValue : undefined;
    }),
    Effect.orElseSucceed(() => process.env.DASHSCOPE_API_KEY?.trim() || undefined),
  );
}

export function fdEnterpriseToolFailureMessage(cause: unknown): string {
  if (cause instanceof FdEnterpriseCodexError) {
    switch (cause.code) {
      case "query_timed_out":
        return "企业数据查询超时，未返回结果，请稍后重试。";
      case "connector_query_failed":
        return "企业数据连接暂不可用，未返回结果，请稍后重试。";
    }
  }
  return "企业数据工具调用失败，未返回结果，请稍后重试。";
}

async function readConnectorEnabled(statePath: string | undefined): Promise<boolean> {
  if (!statePath) return false;
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
