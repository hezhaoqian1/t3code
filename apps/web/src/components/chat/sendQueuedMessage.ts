import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUploads,
  type UploadableAttachment,
} from "../../lib/attachmentUploadQueue";
import { appendElementContextsToPrompt } from "../../lib/elementContext";
import { appendPreviewAnnotationPrompt } from "../../lib/previewAnnotation";
import { appendTerminalContextsToPrompt } from "../../lib/terminalContext";
import { newMessageId } from "../../lib/utils";
import { appendReviewCommentsToPrompt } from "../../reviewCommentContext";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useSendQueueStore, type QueuedMessage } from "../../sendQueueStore";
import { readThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import {
  deriveComposerSendState,
  readFileAsDataUrl,
  resolveThreadMetadataUpdateForNextTurn,
  revokeBlobPreviewUrl,
} from "../ChatView.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
} from "./composerPromptHistory";

async function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

/** The text a queued message sends: the prompt plus its context blocks. */
export function buildQueuedMessageText(message: QueuedMessage): string | null {
  const { sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
    prompt: message.text,
    imageCount: message.images.length,
    documentCount: message.documents.length,
    terminalContexts: [...message.terminalContexts],
    elementContextCount:
      message.elementContexts.length +
      message.previewAnnotations.length +
      message.reviewComments.length,
  });
  if (!hasSendableContent) return null;
  const withContexts = appendElementContextsToPrompt(
    appendTerminalContextsToPrompt(message.text, sendableTerminalContexts),
    [...message.elementContexts],
  );
  const withAnnotations = message.previewAnnotations.reduce(
    (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
    withContexts,
  );
  const text = appendReviewCommentsToPrompt(withAnnotations, [...message.reviewComments]).trim();
  if (text.length > 0) return text;
  return message.documents.length > 0
    ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT
    : IMAGE_ONLY_BOOTSTRAP_PROMPT;
}

async function resolveTurnAttachments(
  environmentId: ScopedThreadRef["environmentId"],
  attachments: ReadonlyArray<UploadableAttachment>,
) {
  await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
  const uploaded = getUploadedAttachments({ environmentId, attachments });
  if (uploaded) return uploaded;
  // Any upload that is not ready sends the whole set inline instead.
  return Promise.all(
    attachments.map(async (attachment) => {
      const inline = {
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readFileAsDataUrl(attachment.file),
      };
      return attachment.type === "image"
        ? { type: "image" as const, ...inline }
        : { type: "document" as const, ...inline };
    }),
  );
}

export type SendQueuedMessageResult = "sent" | "skipped" | "failed" | "retrying";

/** The provider still finishing the previous turn; it clears up on its own. */
const PROVIDER_BUSY_PATTERN = "仍在处理";
export const QUEUED_BUSY_RETRY_DELAY_MS = 1_500;
export const QUEUED_BUSY_MAX_AUTO_RETRIES = 5;

/**
 * Sends one queued message on its task, open or not. While the task's turn
 * runs this steers it (the provider folds the message into the running turn
 * at its next step); otherwise it starts the next turn with the settings
 * captured when the message was queued. It reads nothing from the composer.
 * A failed send stays in the queue, held for "send now".
 */
export async function sendQueuedMessage(
  threadRef: ScopedThreadRef,
  messageId: string,
): Promise<SendQueuedMessageResult> {
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const store = useSendQueueStore.getState();
  const queue = store.byThreadKey[threadKey] ?? [];
  const message = queue.find((entry) => entry.id === messageId);
  // Claim synchronously so a rerender or a double click cannot send it twice.
  if (!message || queue.some((entry) => entry.status === "sending")) return "skipped";
  store.update(threadKey, messageId, { status: "sending", error: undefined });

  const shell = readThreadShell(threadRef);
  const sessionStatus = shell?.session?.status ?? null;
  const steering = sessionStatus === "running" || sessionStatus === "starting";
  const { sendSettings } = message;
  const attachments: UploadableAttachment[] = [...message.images, ...message.documents];

  try {
    const text = buildQueuedMessageText(message);
    if (text === null) {
      // Only expired terminal context was left; retrying would block the queue.
      useSendQueueStore.getState().finish(threadKey, messageId);
      return "skipped";
    }
    const wireAttachments = await resolveTurnAttachments(environmentId, attachments);
    const createdAt = new Date().toISOString();

    // A new turn starts with the task's stored modes, so changes made in the
    // composer before queueing are saved first. A steer joins the running
    // turn as it is.
    if (!steering && shell) {
      const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: shell.modelSelection,
        nextModelSelection: sendSettings.modelSelection,
        currentBranch: shell.branch,
      });
      if (metadataUpdate) {
        await run(threadEnvironment.updateMetadata, {
          environmentId,
          input: { threadId, ...metadataUpdate },
        });
      }
      if (shell.runtimeMode !== sendSettings.runtimeMode) {
        await run(threadEnvironment.setRuntimeMode, {
          environmentId,
          input: { threadId, runtimeMode: sendSettings.runtimeMode, createdAt },
        });
      }
      if (shell.interactionMode !== sendSettings.interactionMode) {
        await run(threadEnvironment.setInteractionMode, {
          environmentId,
          input: { threadId, interactionMode: sendSettings.interactionMode, createdAt },
        });
      }
      useSendQueueStore.getState().setLastDispatch(threadKey, {
        latestTurnId: shell.latestTurn?.turnId ?? null,
        latestTurnRequestedAt: shell.latestTurn?.requestedAt ?? null,
        dispatchedAt: Date.now(),
      });
    }

    await run(threadEnvironment.startTurn, {
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: wireAttachments,
        },
        // The same FD Skill keeps the provider on the running session's
        // profile; a different one would restart it and drop the turn.
        ...(sendSettings.fdSkillVersionId !== undefined
          ? { fdSkillVersionId: sendSettings.fdSkillVersionId }
          : {}),
        ...(sendSettings.nativeSkillNames.length > 0
          ? { nativeSkillNames: [...sendSettings.nativeSkillNames] }
          : {}),
        ...(sendSettings.presentation ? { presentation: sendSettings.presentation } : {}),
        ...(steering ? {} : { modelSelection: sendSettings.modelSelection }),
        runtimeMode: sendSettings.runtimeMode,
        interactionMode: sendSettings.interactionMode,
        createdAt,
      },
    });

    useSendQueueStore.getState().finish(threadKey, messageId);
    // The server copied the uploads into the task; drop the pending copies.
    releaseAttachmentUploads(attachments);
    for (const image of message.images) revokeBlobPreviewUrl(image.previewUrl);
    return "sent";
  } catch (error) {
    if (!steering) useSendQueueStore.getState().setLastDispatch(threadKey, null);
    const reason = error instanceof Error && error.message ? error.message : "发送失败";
    const retries = message.busyRetryCount ?? 0;
    if (
      !steering &&
      reason.includes(PROVIDER_BUSY_PATTERN) &&
      retries < QUEUED_BUSY_MAX_AUTO_RETRIES
    ) {
      // The turn that just ended is still settling on the provider; the
      // message goes out again by itself once that finishes.
      useSendQueueStore.getState().update(threadKey, messageId, {
        status: "failed",
        error: "当前任务仍在收尾，稍后自动重试。",
        busyRetryCount: retries + 1,
      });
      setTimeout(() => {
        const current = useSendQueueStore
          .getState()
          .byThreadKey[threadKey]?.find((entry) => entry.id === messageId);
        if (current?.status !== "failed" || current.holdUntilUserAction) return;
        useSendQueueStore
          .getState()
          .update(threadKey, messageId, { status: undefined, error: undefined });
      }, QUEUED_BUSY_RETRY_DELAY_MS);
      return "retrying";
    }
    useSendQueueStore.getState().update(threadKey, messageId, {
      status: "failed",
      holdUntilUserAction: true,
      error: steering ? `引导失败：${reason}` : `发送失败：${reason}`,
    });
    const title = readThreadShell(threadRef)?.title;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: title ? `“${title}”的排队消息未发出` : "排队消息未发出",
        description: `${reason}。可在排队列表中点“重试”。`,
      }),
    );
    return "failed";
  }
}
