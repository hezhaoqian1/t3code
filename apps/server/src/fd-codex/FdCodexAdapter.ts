// @effect-diagnostics nodeBuiltinImport:off,runEffectInsideEffect:off
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { ServerConfig } from "../config.ts";
import { FdRuntimeCredentialStore } from "../fd/FdRuntimeCredentialStore.ts";
import { ProviderAdapterRequestError } from "../provider/Errors.ts";
import { makeCodexAdapter } from "../provider/Layers/CodexAdapter.ts";
import { FD_DEEPSEEK_DRIVER_KIND } from "../provider/Layers/FdDeepSeekAdapter.ts";
import {
  FdEnterpriseCodexClient,
  FdEnterpriseCodexError,
  type FdEnterpriseCodexToolArtifact,
  type FdEnterpriseCodexToolCallInput,
} from "../fd-skills/FdEnterpriseCodexClient.ts";
import { NativeSkillCatalog, selectedNativeSkillNames } from "../fd-skills/NativeSkillCatalog.ts";
import type { AttachmentToolSet } from "../fileAnalysis/AttachmentTools.ts";
import { makeFdCodexChildEnvironment } from "./FdCodexChildEnvironment.ts";
import { prepareFdManagedCodexHome } from "./FdManagedCodexHome.ts";
import { FD_RESPONSES_PROVIDERS } from "./ResponsesModelCatalog.ts";
import { findResponsesCodexModel } from "./ResponsesCodexConfig.ts";

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
  readonly model?: string;
}): Promise<{
  readonly environment: NodeJS.ProcessEnv;
  readonly homePath: string;
  readonly skillExtraRoots?: ReadonlyArray<string>;
}> {
  const codexHome = NodePath.join(input.stateDir, "codex-home");
  const connectorEnabled = await readConnectorEnabled(input.connectorStatePath);
  if (!input.credentials) throw new Error("Sign in to FD before starting an Agent session.");
  await prepareFdManagedCodexHome({
    codexHome,
    newApiOrigin: input.credentials.newApiOrigin,
  });
  const skillExtraRoots = [
    ...(input.presentationSkillRoot ? [input.presentationSkillRoot] : []),
    ...(connectorEnabled && input.connectorSkillsRoot ? [input.connectorSkillsRoot] : []),
  ];
  return {
    homePath: codexHome,
    ...(skillExtraRoots.length > 0 ? { skillExtraRoots } : {}),
    environment: makeFdCodexChildEnvironment({
      codexHome,
      runtimeApiKey: input.credentials.runtimeApiKey,
      connectorBinPath: connectorEnabled ? input.connectorBinPath : undefined,
      connectorConfigDir: connectorEnabled ? input.connectorConfigDir : undefined,
      ...(input.inheritedEnvironment ? { inheritedEnvironment: input.inheritedEnvironment } : {}),
    }),
  };
}

/**
 * Exposes the local attachment tools (PDF pages, spreadsheet rows) to a Codex
 * session. Calls run in this process against the calling thread's own
 * attachments.
 */
export function fdDocumentToolRuntime(tools: AttachmentToolSet, threadId: string) {
  return {
    dynamicTools: tools.specs.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    dynamicToolExecutor: (request: { readonly tool: string; readonly arguments: unknown }) =>
      Effect.tryPromise({
        try: (signal) =>
          tools.execute({ threadId, tool: request.tool, arguments: request.arguments, signal }),
        catch: () => undefined,
      }).pipe(
        Effect.match({
          onFailure: () => ({ success: false, text: "读取附件失败，请稍后重试。" }),
          onSuccess: (result) => result,
        }),
        Effect.map((result) => ({
          success: result.success,
          contentItems: [
            { type: "inputText" as const, text: result.text },
            ...("images" in result
              ? (result.images ?? []).flatMap((image) => [
                  { type: "inputText" as const, text: image.label },
                  { type: "inputImage" as const, imageUrl: image.dataUrl },
                ])
              : []),
          ],
        })),
      ),
  };
}

export const makeFdCodexAdapter = Effect.fn("makeFdCodexAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath?: string;
  /** Local attachment tools offered to every session; FD Skill tools are added alongside. */
  readonly documentTools?: AttachmentToolSet;
}) {
  const credentials = yield* FdRuntimeCredentialStore;
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
        findResponsesCodexModel(FD_RESPONSES_PROVIDERS, model)?.model ?? {
          slug: model,
          name: model,
          supportsTools: true,
          supportsVision: /vision|vl|image|omni|kimi/i.test(model),
          visionRoute: /vision|vl|image|omni|kimi/i.test(model) ? "native" : "unsupported",
          supportsReasoning: true,
          supportsStructuredOutput: true,
          supportsForcedToolChoice: false,
          supportsParallelToolCalls: false,
        },
      resolveModelRuntimeKey: (model) =>
        findResponsesCodexModel(FD_RESPONSES_PROVIDERS, model)?.provider.providerId,
      resolveRuntime: (session) =>
        Effect.gen(function* () {
          const current = yield* credentials.current;
          if (Option.isNone(current)) {
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
          const runtimeKey = "fd_new_api";
          return yield* Effect.tryPromise({
            try: () =>
              prepareFdCodexRuntime({
                ...runtimeInput,
                credentials: current.value,
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
        const documents = input.documentTools
          ? fdDocumentToolRuntime(input.documentTools, session.threadId)
          : undefined;
        if (session.fdSkillVersionId === undefined) return Effect.succeed(documents ?? {});
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
            dynamicTools: [
              ...runtimeContext.tools.map((tool) => ({
                type: "function" as const,
                name: tool.name,
                description: tool.description,
                inputSchema: tool.input_schema,
              })),
              // The gateway owns an FD Skill session's tool contract: if one
              // of its tools ever shares a name with a document tool, it wins.
              ...(documents?.dynamicTools ?? []).filter(
                (tool) => !runtimeContext.tools.some((skillTool) => skillTool.name === tool.name),
              ),
            ],
            dynamicToolExecutor: (request) =>
              documents &&
              input.documentTools?.handles(request.tool) &&
              !runtimeContext.tools.some((skillTool) => skillTool.name === request.tool)
                ? documents.dynamicToolExecutor(request)
                : executeFdEnterpriseToolCall(
                    enterpriseClient,
                    {
                      skillVersionId,
                      releaseDigest: runtimeContext.release_digest,
                      clientThreadId: session.threadId,
                      providerThreadId: request.threadId,
                      turnId: request.turnId,
                      callId: request.callId,
                      tool: request.tool,
                      arguments: request.arguments,
                      timeoutSeconds: runtimeContext.tools.find(
                        (tool) => tool.name === request.tool,
                      )?.timeout_seconds,
                    },
                    { taskFolder: session.cwd },
                  ),
          })),
        );
      },
    },
  );
});

export function executeFdEnterpriseToolCall(
  client: FdEnterpriseCodexClient,
  input: FdEnterpriseCodexToolCallInput,
  options: { readonly taskFolder?: string | undefined } = {},
) {
  return Effect.tryPromise({
    try: async (signal) => {
      const result = await client.executeToolCall({ ...input, signal });
      const savedFiles =
        result.artifacts && result.artifacts.length > 0
          ? await saveFdToolArtifacts(client, result.artifacts, options.taskFolder, signal)
          : undefined;
      return { ...result, savedFiles };
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        method: "tool/call",
        detail: "FD enterprise tool call failed.",
        cause,
      }),
  }).pipe(
    Effect.match({
      onFailure: (cause) => ({
        success: false,
        contentItems: [
          { type: "inputText" as const, text: fdEnterpriseToolFailureMessage(cause.cause) },
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
              ...(result.savedFiles ? { saved_files: result.savedFiles } : {}),
            }),
          },
        ],
      }),
    }),
  );
}

interface FdSavedToolFile {
  readonly file_name: string;
  /** Path relative to the task folder, for linking in the reply. */
  readonly path?: string;
  readonly error?: string;
}

/**
 * Saves files a gateway tool produced into `<task folder>/outputs/`, never
 * overwriting an existing file. Failures are reported per file to the model.
 */
export async function saveFdToolArtifacts(
  client: FdEnterpriseCodexClient,
  artifacts: ReadonlyArray<FdEnterpriseCodexToolArtifact>,
  taskFolder: string | undefined,
  signal?: AbortSignal,
): Promise<ReadonlyArray<FdSavedToolFile>> {
  const saved: FdSavedToolFile[] = [];
  for (const artifact of artifacts) {
    const fileName = safeArtifactFileName(artifact);
    if (!taskFolder) {
      saved.push({ file_name: fileName, error: "当前会话没有任务文件夹，报告未保存。" });
      continue;
    }
    try {
      const bytes = await client.downloadArtifact({ artifact, signal });
      const directory = NodePath.join(taskFolder, "outputs");
      await NodeFSP.mkdir(directory, { recursive: true });
      const target = await availableFilePath(directory, fileName);
      await NodeFSP.writeFile(target, bytes, { flag: "wx" });
      saved.push({
        file_name: NodePath.basename(target),
        path: NodePath.relative(taskFolder, target).split(NodePath.sep).join("/"),
      });
    } catch {
      saved.push({ file_name: fileName, error: "报告已生成，但保存到任务文件夹失败，请重试。" });
    }
  }
  return saved;
}

function safeArtifactFileName(artifact: FdEnterpriseCodexToolArtifact): string {
  const base = Array.from(NodePath.basename(artifact.file_name.replaceAll("\\", "/")))
    .filter((character) => character >= " " && !'<>:"/\\|?*'.includes(character))
    .join("")
    .trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 180) : `${artifact.id}.html`;
}

async function availableFilePath(directory: string, fileName: string): Promise<string> {
  const extension = NodePath.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = NodePath.join(
      directory,
      attempt === 1 ? fileName : `${stem} (${attempt})${extension}`,
    );
    try {
      await NodeFSP.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("no free file name");
}

export function fdEnterpriseToolFailureMessage(cause: unknown): string {
  if (cause instanceof FdEnterpriseCodexError) {
    if (cause.diagnostic) {
      return JSON.stringify({
        error: { code: cause.code, message: cause.message, ...cause.diagnostic },
      });
    }
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
    const parsed = JSON.parse(await NodeFSP.readFile(statePath, "utf8")) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
