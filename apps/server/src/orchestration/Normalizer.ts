import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type ClientOrchestrationCommand,
  type IsoDateTime,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import {
  createAttachmentId,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  planAttachmentClaim,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export const canonicalizeClientCommandTimestamps = (
  command: ClientOrchestrationCommand,
  receivedAt: IsoDateTime,
): ClientOrchestrationCommand => {
  const canonicalCommand =
    "createdAt" in command
      ? {
          ...command,
          createdAt: receivedAt,
        }
      : command;

  if (canonicalCommand.type !== "thread.turn.start" || !canonicalCommand.bootstrap?.createThread) {
    return canonicalCommand;
  }

  return {
    ...canonicalCommand,
    bootstrap: {
      ...canonicalCommand.bootstrap,
      createThread: {
        ...canonicalCommand.bootstrap.createThread,
        createdAt: receivedAt,
      },
    },
  };
};

const removeClaimedAttachmentPaths = Effect.fn("Normalizer.removeClaimedAttachmentPaths")(
  function* (attachmentPaths: ReadonlyArray<string>) {
    if (attachmentPaths.length === 0) {
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* Effect.forEach(
      attachmentPaths,
      (attachmentPath) =>
        fileSystem.remove(attachmentPath, { force: true }).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Failed to remove an unclaimed attachment copy.", {
              attachmentPath,
              cause,
            }),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      { concurrency: 1 },
    );
  },
);

/**
 * A turn start whose dispatch failed leaves the thread copies of its uploaded
 * attachments behind. The pending uploads are still there, so a retry claims
 * them again; this removes the orphaned copies.
 */
export const cleanupFailedUploadedAttachments = Effect.fn(
  "Normalizer.cleanupFailedUploadedAttachments",
)(function* (command: ClientOrchestrationCommand, normalizedCommand: OrchestrationCommand) {
  if (command.type !== "thread.turn.start" || normalizedCommand.type !== "thread.turn.start") {
    return;
  }
  const serverConfig = yield* ServerConfig;
  const claimedPaths: string[] = [];
  for (const [index, attachment] of normalizedCommand.message.attachments.entries()) {
    const original = command.message.attachments[index];
    if (
      !original ||
      "dataUrl" in original ||
      parseThreadSegmentFromAttachmentId(original.id) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    ) {
      continue;
    }
    const claimedPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (claimedPath) {
      claimedPaths.push(claimedPath);
    }
  }
  yield* removeClaimedAttachmentPaths(claimedPaths);
});

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const receivedAt = DateTime.formatIso(yield* DateTime.now);
    const canonicalCommand = canonicalizeClientCommandTimestamps(command, receivedAt);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (canonicalCommand.type === "project.create") {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          canonicalCommand.workspaceRoot,
          canonicalCommand.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: canonicalCommand.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type === "project.meta.update" &&
      canonicalCommand.workspaceRoot !== undefined
    ) {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(canonicalCommand.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (canonicalCommand.type !== "thread.turn.start") {
      return canonicalCommand as OrchestrationCommand;
    }

    const claimedAttachmentPaths: string[] = [];
    const normalizedAttachments = yield* Effect.forEach(
      canonicalCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          if (!("dataUrl" in attachment)) {
            // Uploaded ahead of the send: copy the pending upload under this
            // thread's id. Only pending uploads can be claimed, so a turn can
            // never point at another thread's attachment.
            const claim = planAttachmentClaim({
              attachmentsDir: serverConfig.attachmentsDir,
              threadId: canonicalCommand.threadId,
              attachmentId: attachment.id,
            });
            if (!claim.ok) {
              return yield* new OrchestrationDispatchCommandError({
                message: `附件“${attachment.name}”无法发送：${claim.reason}。`,
              });
            }
            const info = yield* fileSystem.stat(claim.currentPath).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationDispatchCommandError({
                    message: `附件“${attachment.name}”无法发送：上传的文件不存在。`,
                    cause,
                  }),
              ),
            );
            const maxBytes =
              attachment.type === "image"
                ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
                : PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES;
            if (
              Number(info.size) !== attachment.sizeBytes ||
              attachment.sizeBytes <= 0 ||
              attachment.sizeBytes > maxBytes
            ) {
              return yield* new OrchestrationDispatchCommandError({
                message: `附件“${attachment.name}”无法发送：上传的文件大小不一致。`,
              });
            }
            const normalizedAttachment = {
              ...attachment,
              id: claim.finalId,
              mimeType: attachment.mimeType.toLowerCase(),
            };
            const expectedPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment: normalizedAttachment,
            });
            if (expectedPath !== claim.finalPath) {
              return yield* new OrchestrationDispatchCommandError({
                message: `附件“${attachment.name}”无法发送：文件类型与上传时不一致。`,
              });
            }
            // Keep the pending copy until the turn succeeds, so a failed
            // thread bootstrap can retry with a fresh thread id.
            yield* fileSystem.copyFile(claim.currentPath, claim.finalPath).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationDispatchCommandError({
                    message: `附件“${attachment.name}”无法保存到当前任务。`,
                    cause,
                  }),
              ),
            );
            claimedAttachmentPaths.push(claim.finalPath);
            return normalizedAttachment;
          }

          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid attachment payload for '${attachment.name}'.`,
            });
          }

          const isImage = attachment.type === "image";
          const maxBytes = isImage
            ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
            : PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES;
          if (
            (isImage && !parsed.mimeType.startsWith("image/")) ||
            (!isImage && parsed.mimeType !== attachment.mimeType) ||
            bytesAreEmptyOrTooLarge(attachment.dataUrl, maxBytes)
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: `${isImage ? "图片" : "文件"}附件 '${attachment.name}' 为空或超过大小限制。`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");

          const attachmentId = createAttachmentId(canonicalCommand.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: attachment.type,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    ).pipe(Effect.tapError(() => removeClaimedAttachmentPaths(claimedAttachmentPaths)));

    return {
      ...canonicalCommand,
      message: {
        ...canonicalCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

function bytesAreEmptyOrTooLarge(dataUrl: string, maxBytes: number): boolean {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return true;
  const base64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  if (base64.length === 0) return true;
  const estimatedBytes =
    Math.floor((base64.length * 3) / 4) -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  return estimatedBytes <= 0 || estimatedBytes > maxBytes;
}
