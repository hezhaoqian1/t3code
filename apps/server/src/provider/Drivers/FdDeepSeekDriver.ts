// @effect-diagnostics runEffectInsideEffect:off
import type { ProviderSessionStartInput, ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { imageBytesMatchMimeType } from "../../imageMime.ts";
import { ServerConfig } from "../../config.ts";
import { FdRuntimeCredentialStore } from "../../fd/FdRuntimeCredentialStore.ts";
import { makeFdCodexAdapter } from "../../fd-codex/FdCodexAdapter.ts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import { FdAgentKernel } from "../../fd-agent/FdAgentKernel.ts";
import { makeFdLocalTools, type FdLocalToolProfile } from "../../fd-agent/FdLocalTools.ts";
import { FdResponsesClient } from "../../fd-agent/FdResponsesClient.ts";
import { FdVisionService } from "../../fd-vision/FdVisionService.ts";
import {
  FD_RESPONSES_LIMITS,
  FD_RESPONSES_MODEL,
  FD_RESPONSES_MODELS,
  type FdResponsesInputImageContentPart,
} from "../../fd-agent/FdResponsesProtocol.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { makeFdDeepSeekTextGeneration } from "../../textGeneration/FdDeepSeekTextGeneration.ts";
import {
  FdEnterpriseAgentClient,
  FdSkillCatalog,
} from "../../fd-skills/FdEnterpriseAgentClient.ts";
import { FdEnterpriseThreadRuntime } from "../../fd-skills/FdEnterpriseThreadRuntime.ts";
import { NativeSkillCatalog } from "../../fd-skills/NativeSkillCatalog.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { FD_DEEPSEEK_DRIVER_KIND, makeFdDeepSeekAdapter } from "../Layers/FdDeepSeekAdapter.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";

const FdDeepSeekConfig = Schema.Record(Schema.String, Schema.Never);
type FdDeepSeekConfig = typeof FdDeepSeekConfig.Type;

export type FdDeepSeekDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FdRuntimeCredentialStore
  | FileSystem.FileSystem
  | ProcessRunner.ProcessRunner
  | ServerConfig
  | VcsProcess.VcsProcess
  | WorkspaceEntries.WorkspaceEntries
  | WorkspaceFileSystem.WorkspaceFileSystem;

const FD_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export const resolveFdLocalToolContext = Effect.fn("resolveFdLocalToolContext")(function* (input: {
  readonly cwd: string;
  readonly projectWorkspaceRoot: string | undefined;
  readonly officeWorkspaceRoot: string;
  readonly officeModeEnabled: boolean;
}): Effect.fn.Return<
  { readonly cwd: string; readonly profile: FdLocalToolProfile },
  never,
  FileSystem.FileSystem
> {
  if (!input.officeModeEnabled) return { cwd: input.cwd, profile: "project" };

  const fileSystem = yield* FileSystem.FileSystem;
  const canonicalOfficeWorkspaceRoot = yield* fileSystem
    .realPath(input.officeWorkspaceRoot)
    .pipe(Effect.option);
  const safeOfficeWorkspaceRoot = Option.getOrElse(
    canonicalOfficeWorkspaceRoot,
    () => input.officeWorkspaceRoot,
  );

  // Missing project provenance is not enough authority to grant write/command
  // tools. This also keeps legacy persisted sessions fail-closed.
  if (!input.projectWorkspaceRoot) {
    return { cwd: safeOfficeWorkspaceRoot, profile: "office-read-only" };
  }

  const canonicalProjectWorkspaceRoot = yield* fileSystem
    .realPath(input.projectWorkspaceRoot)
    .pipe(Effect.option);
  if (Option.isNone(canonicalProjectWorkspaceRoot) || Option.isNone(canonicalOfficeWorkspaceRoot)) {
    return { cwd: safeOfficeWorkspaceRoot, profile: "office-read-only" };
  }
  return canonicalProjectWorkspaceRoot.value === canonicalOfficeWorkspaceRoot.value
    ? { cwd: canonicalOfficeWorkspaceRoot.value, profile: "office-read-only" }
    : { cwd: input.cwd, profile: "project" };
});

export const resolveFdOrdinarySessionInput = Effect.fn("resolveFdOrdinarySessionInput")(
  function* (input: {
    readonly session: ProviderSessionStartInput;
    readonly officeWorkspaceRoot: string;
    readonly officeModeEnabled: boolean;
  }) {
    const context = yield* resolveFdLocalToolContext({
      cwd: input.session.cwd ?? input.officeWorkspaceRoot,
      projectWorkspaceRoot: input.session.projectWorkspaceRoot,
      officeWorkspaceRoot: input.officeWorkspaceRoot,
      officeModeEnabled: input.officeModeEnabled,
    });

    // The office profile limits which local tools exist; it must not silently
    // replace the runtime permission mode selected for the session.
    return { ...input.session, cwd: context.cwd };
  },
);

export const resolveFdDeepSeekAttachments = Effect.fn("resolveFdDeepSeekAttachments")(function* (
  attachments: ReadonlyArray<import("@t3tools/contracts").ChatAttachment>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig;
  const parts: Array<FdResponsesInputImageContentPart> = [];

  for (const attachment of attachments) {
    if (attachment.type !== "image" || !FD_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return yield* new ProviderAdapterRequestError({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        method: "turn/start",
        detail: "FD image attachment type is unsupported.",
      });
    }
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        method: "turn/start",
        detail: "FD image attachment reference is invalid.",
      });
    }
    const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: FD_DEEPSEEK_DRIVER_KIND,
            method: "turn/start",
            detail: "FD image attachment is unavailable.",
          }),
      ),
    );
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength !== attachment.sizeBytes ||
      bytes.byteLength > FD_RESPONSES_LIMITS.maxImageBytes
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        method: "turn/start",
        detail: "FD image attachment failed size validation.",
      });
    }
    if (!imageBytesMatchMimeType(bytes, attachment.mimeType)) {
      return yield* new ProviderAdapterRequestError({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        method: "turn/start",
        detail: "FD image attachment failed binary validation.",
      });
    }
    parts.push({
      type: "input_image",
      image_url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    });
  }

  return parts;
});

export const FdDeepSeekDriver: ProviderDriver<FdDeepSeekConfig, FdDeepSeekDriverEnv> = {
  driverKind: FD_DEEPSEEK_DRIVER_KIND,
  metadata: { displayName: "FD DeepSeek", supportsMultipleInstances: false },
  configSchema: FdDeepSeekConfig,
  defaultConfig: () => ({}),
  create: ({ instanceId, displayName, accentColor, enabled }) =>
    Effect.gen(function* () {
      const credentials = yield* FdRuntimeCredentialStore;
      const enterpriseRuntime = yield* Effect.serviceOption(FdEnterpriseThreadRuntime);
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const processRunner = yield* ProcessRunner.ProcessRunner;
      const vcsProcess = yield* VcsProcess.VcsProcess;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverConfig = yield* ServerConfig;
      const client = new FdResponsesClient(credentials);
      const visionService = new FdVisionService(client);
      const kernel = new FdAgentKernel(client);
      const ordinaryAdapter = yield* makeFdCodexAdapter({ instanceId });
      const enterpriseClient = new FdEnterpriseAgentClient({
        credentials: () => Effect.runPromise(credentials.current).then(Option.getOrUndefined),
      });
      if (Option.isSome(enterpriseRuntime)) {
        yield* enterpriseRuntime.value.setHistoryLoader((threadId) =>
          enterpriseClient.getHistory(threadId),
        );
      }
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      const initialCredentialState = yield* credentials.current;
      let fdSkillCatalogState: "loading" | "ready" | "error" = Option.isSome(initialCredentialState)
        ? "loading"
        : "ready";
      const refreshFdSkillCatalog = async (
        credentialState: Option.Option<FdServerRuntimeCredentialProjection>,
      ): Promise<void> => {
        if (Option.isNone(credentialState)) {
          fdSkillCatalog.clear();
          fdSkillCatalogState = "ready";
          return;
        }
        fdSkillCatalogState = "loading";
        try {
          await fdSkillCatalog.refresh();
          fdSkillCatalogState = "ready";
        } catch {
          fdSkillCatalogState = "error";
        }
      };
      if (Option.isSome(initialCredentialState)) {
        // The initial provider snapshot is what feeds the composer picker. Wait
        // for the first permission-filtered catalog so an authenticated session
        // cannot permanently render an empty FD Skill list due to a startup race.
        yield* Effect.promise(() => refreshFdSkillCatalog(initialCredentialState));
      }
      const userSkillCatalog = new NativeSkillCatalog();
      yield* Effect.promise(() => userSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        instanceId,
        kernel,
        ordinaryAdapter,
        ordinarySessionInput: (input) =>
          resolveFdOrdinarySessionInput({
            session: input,
            officeWorkspaceRoot: serverConfig.cwd,
            officeModeEnabled:
              serverConfig.mode === "desktop" && serverConfig.autoBootstrapProjectFromCwd,
          }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem)),
        toolsForSession: (input) => {
          const cwd = input.cwd ?? serverConfig.cwd;
          return resolveFdLocalToolContext({
            cwd,
            projectWorkspaceRoot: input.projectWorkspaceRoot,
            officeWorkspaceRoot: serverConfig.cwd,
            officeModeEnabled:
              serverConfig.mode === "desktop" && serverConfig.autoBootstrapProjectFromCwd,
          }).pipe(
            Effect.flatMap((context) => makeFdLocalTools(context.cwd, context.profile)),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
            Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
            Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
            Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
          );
        },
        resolveAttachments: (attachments) =>
          resolveFdDeepSeekAttachments(attachments).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(ServerConfig, serverConfig),
          ),
        visionService,
        nativeSkillCatalogForSession: async (input) => {
          const catalog = new NativeSkillCatalog(input.cwd ? { projectRoot: input.cwd } : {});
          await catalog.refresh();
          return catalog;
        },
        fdSkillCatalog,
        enterpriseClient,
        enterpriseGeneration: () =>
          Option.isSome(enterpriseRuntime) ? enterpriseRuntime.value.getGeneration() : 0,
      });
      let previousRuntimeCredential = runtimeCredentialKey(initialCredentialState);
      let previousEnterpriseOwner = enterpriseOwnerKey(initialCredentialState);
      const clearEnterpriseState = Effect.gen(function* () {
        if (Option.isSome(enterpriseRuntime)) {
          yield* enterpriseRuntime.value.clearAll();
        }
      });
      const textGeneration = makeFdDeepSeekTextGeneration(client);

      const buildSnapshot = Effect.fn("buildFdDeepSeekSnapshot")(function* (
        credentialState: Option.Option<FdServerRuntimeCredentialProjection>,
      ) {
        const checkedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        const authenticated = Option.isSome(credentialState);
        return {
          instanceId,
          driver: FD_DEEPSEEK_DRIVER_KIND,
          displayName: displayName ?? "FD DeepSeek",
          ...(accentColor ? { accentColor } : {}),
          continuation: {
            groupKey: defaultProviderContinuationIdentity({
              driverKind: FD_DEEPSEEK_DRIVER_KIND,
              instanceId,
            }).continuationKey,
          },
          showInteractionModeToggle: true,
          requiresNewThreadForModelChange: false,
          enabled,
          status: enabled && authenticated ? "ready" : enabled ? "warning" : "disabled",
          auth: authenticated
            ? { status: "authenticated", type: "fd-account", label: "FD Account" }
            : { status: "unauthenticated", type: "fd-account", label: "FD Account" },
          checkedAt,
          skillCatalogState: fdSkillCatalogState,
          ...(!authenticated && enabled ? { message: "Sign in to FD to use DeepSeek." } : {}),
          models: FD_RESPONSES_MODELS.map((model) => ({
            slug: model,
            name: model === FD_RESPONSES_MODEL ? "DeepSeek V4 Flash" : "DeepSeek V4 Pro",
            shortName: model === FD_RESPONSES_MODEL ? "V4 Flash" : "V4 Pro",
            isCustom: false,
            isDefault: model === FD_RESPONSES_MODEL,
            capabilities: { optionDescriptors: [] },
          })),
          slashCommands: [],
          skills: [
            ...userSkillCatalog.snapshot.skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              path: skill.skillPath,
              scope: `${skill.scope}:${skill.source}`,
              enabled: true,
              displayName: skill.name,
              shortDescription: skill.description,
            })),
            ...(fdSkillCatalog.authorized
              ? fdSkillCatalog.snapshot.skills.map((skill) => ({
                  name: skill.name,
                  description: skill.description,
                  path: `fd-managed://${skill.versionId}`,
                  scope: "fd-managed",
                  enabled: true,
                  displayName: skill.displayName,
                  shortDescription: skill.description,
                }))
              : []),
          ],
        } satisfies ServerProvider;
      });

      const getSnapshot = credentials.current.pipe(Effect.flatMap(buildSnapshot));
      const snapshot = {
        getSnapshot,
        streamChanges: credentials.changes.pipe(
          Stream.mapEffect((credentialState) =>
            Effect.gen(function* () {
              const nextRuntimeCredential = runtimeCredentialKey(credentialState);
              const nextEnterpriseOwner = enterpriseOwnerKey(credentialState);
              if (nextEnterpriseOwner !== previousEnterpriseOwner) {
                yield* clearEnterpriseState;
              }
              if (nextRuntimeCredential !== previousRuntimeCredential) {
                yield* adapter.stopAll().pipe(Effect.orDie);
              }
              if (nextEnterpriseOwner !== previousEnterpriseOwner) {
                fdSkillCatalog.clear();
              }
              previousRuntimeCredential = nextRuntimeCredential;
              previousEnterpriseOwner = nextEnterpriseOwner;
              yield* Effect.promise(() => refreshFdSkillCatalog(credentialState));
              if (Option.isSome(credentialState) && Option.isSome(enterpriseRuntime)) {
                yield* enterpriseRuntime.value.reloadAllHistory();
              }
              return yield* buildSnapshot(credentialState);
            }),
          ),
        ),
      };

      return {
        instanceId,
        driverKind: FD_DEEPSEEK_DRIVER_KIND,
        continuationIdentity: defaultProviderContinuationIdentity({
          driverKind: FD_DEEPSEEK_DRIVER_KIND,
          instanceId,
        }),
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

function runtimeCredentialKey(
  credentialState: Option.Option<FdServerRuntimeCredentialProjection>,
): string {
  return Option.match(credentialState, {
    onNone: () => "none",
    onSome: (credentials) =>
      `${credentials.newApiOrigin}:${credentials.userId}:${credentials.runtimeTokenId}:${credentials.runtimeApiKey}`,
  });
}

function enterpriseOwnerKey(
  credentialState: Option.Option<FdServerRuntimeCredentialProjection>,
): string {
  return Option.match(credentialState, {
    onNone: () => "none",
    onSome: (credentials) => `${credentials.newApiOrigin}:${credentials.userId}`,
  });
}
