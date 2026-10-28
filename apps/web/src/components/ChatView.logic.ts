import {
  type AssetResource,
  type EnvironmentId,
  isProviderDriverKind,
  ProjectId,
  type ModelSelection,
  type ProviderDriverKind,
  type ServerProvider,
  type ScopedProjectRef,
  type MessageId,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { shallow } from "zustand/vanilla/shallow";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { isFdEnterpriseHistoryMessageId } from "@t3tools/shared/conversationRewind";
import {
  type ChatAttachment,
  type ChatMessage,
  type ComposerDocumentAttachment,
  type SessionPhase,
  type Thread,
  type ThreadShell,
  type TurnDiffSummary,
} from "../types";
import type { TimelineEntry } from "../session-logic";
import {
  type ComposerImageAttachment,
  type DraftId,
  type DraftThreadState,
} from "../composerDraftStore";
import { recallableComposerPrompt } from "./chat/composerPromptHistory";
import * as Schema from "effect/Schema";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import type { DraftThreadEnvMode } from "../composerDraftStore";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 10;
export const MAX_HIDDEN_MOUNTED_PREVIEW_THREADS = 3;
export const ENVIRONMENT_RECONNECT_WARNING_GRACE_MS = 2_000;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

/**
 * Maps each user message to the checkpoint turn count a revert should target.
 * Returns `previous` when the result is unchanged: a streamed assistant
 * paragraph rebuilds `timelineEntries`, and the timeline row projection only
 * reuses rows while this Map keeps its identity.
 */
export function buildRevertTurnCountByUserMessageId(
  input: {
    readonly timelineEntries: ReadonlyArray<TimelineEntry>;
    readonly turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
    readonly inferredCheckpointTurnCountByTurnId: Readonly<Record<string, number | undefined>>;
  },
  previous: Map<MessageId, number> | null = null,
): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>();
  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < input.timelineEntries.length; nextIndex += 1) {
      const nextEntry = input.timelineEntries[nextIndex];
      if (!nextEntry || nextEntry.kind !== "message") {
        continue;
      }
      if (nextEntry.message.role === "user") {
        break;
      }
      const summary = input.turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
      if (!summary) {
        continue;
      }
      const turnCount =
        summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
      if (typeof turnCount !== "number") {
        break;
      }
      byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
      break;
    }
  }
  return previous !== null && shallow(previous, byUserMessageId) ? previous : byUserMessageId;
}

/**
 * The user messages the conversation can be rewound to ("从这里重来"), each
 * mapped to the checkpoint a files-too rewind would restore, or 0 when there
 * is none. App-created task folders have no checkpoints, so every sent
 * message qualifies. FD Skill history lives on the enterprise service and
 * cannot be rewound, so messages at or before the last FD Skill message do not.
 * Returns `previous` when unchanged so timeline rows keep their identity.
 */
export function buildRewindTurnCountByUserMessageId(
  input: {
    readonly timelineEntries: ReadonlyArray<TimelineEntry>;
    readonly checkpointTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
  },
  previous: Map<MessageId, number> | null = null,
): Map<MessageId, number> {
  let firstRewindableIndex = 0;
  for (let index = input.timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = input.timelineEntries[index];
    if (entry?.kind === "message" && isFdEnterpriseHistoryMessageId(entry.message.id)) {
      firstRewindableIndex = index + 1;
      break;
    }
  }
  const byUserMessageId = new Map<MessageId, number>();
  for (let index = firstRewindableIndex; index < input.timelineEntries.length; index += 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") continue;
    byUserMessageId.set(
      entry.message.id,
      input.checkpointTurnCountByUserMessageId.get(entry.message.id) ?? 0,
    );
  }
  return previous !== null && shallow(previous, byUserMessageId) ? previous : byUserMessageId;
}

export interface RewoundAttachmentFile {
  readonly attachment: ChatAttachment;
  readonly file: File;
}

/**
 * Copies a message's attachments before it is rewound: the rewind prunes the
 * stored files of removed messages, and the copies go back into the composer.
 */
export async function prepareRevertedMessageAttachments(input: {
  readonly message: ChatMessage;
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
  readonly createAssetUrl: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AtomCommandResult<{ readonly relativeUrl: string }, unknown>>;
}): Promise<RewoundAttachmentFile[]> {
  return Promise.all(
    (input.message.attachments ?? []).map(async (attachment) => {
      const failure = new Error(`没能取回附件“${attachment.name}”，请稍后再试。`);
      const result = await input.createAssetUrl({
        environmentId: input.environmentId,
        input: { resource: { _tag: "attachment", attachmentId: attachment.id } },
      });
      if (result._tag === "Failure") throw failure;
      const url = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
      if (url === null) throw failure;
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw failure;
      const file = new File([await response.blob()], attachment.name, {
        type: attachment.mimeType,
      });
      return { attachment, file };
    }),
  );
}

/** The composer draft operations a rewound message is restored with. */
export interface RewindDraftStore {
  readonly getComposerDraft: (
    target: ScopedThreadRef | DraftId,
  ) => { readonly prompt: string } | null;
  readonly setPrompt: (target: ScopedThreadRef | DraftId, prompt: string) => void;
  readonly addImages: (
    target: ScopedThreadRef | DraftId,
    images: ComposerImageAttachment[],
    options?: { allowDuplicates?: boolean },
  ) => void;
}

/**
 * Puts a rewound message back into its thread's composer draft: the typed
 * text below anything still unsent, and the attachment copies as new chips.
 * Send-time additions (terminal output, annotations) are left out, like the
 * prompt history does. Documents live in the mounted composer, so they are
 * returned for the caller to add there.
 */
export function restoreRewoundMessageToDraft(input: {
  readonly store: RewindDraftStore;
  readonly target: ScopedThreadRef | DraftId;
  readonly message: ChatMessage;
  readonly files: ReadonlyArray<RewoundAttachmentFile>;
  readonly createId: () => string;
  readonly createPreviewUrl: (file: File) => string;
}): { readonly prompt: string; readonly documents: ComposerDocumentAttachment[] } {
  const currentPrompt = input.store.getComposerDraft(input.target)?.prompt ?? "";
  // Only what the employee typed comes back: never an answer or thinking text.
  const restoredPrompt =
    input.message.role === "user" ? recallableComposerPrompt(input.message.text) : "";
  const prompt =
    restoredPrompt.length === 0
      ? currentPrompt
      : currentPrompt.trim().length > 0
        ? `${currentPrompt}\n\n${restoredPrompt}`
        : restoredPrompt;
  input.store.setPrompt(input.target, prompt);
  const images: ComposerImageAttachment[] = [];
  const documents: ComposerDocumentAttachment[] = [];
  for (const { attachment, file } of input.files) {
    if (attachment.type === "image") {
      images.push({
        type: "image",
        id: input.createId(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: file.size,
        previewUrl: input.createPreviewUrl(file),
        file,
      });
    } else {
      documents.push({
        type: "document",
        id: input.createId(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: file.size,
        ...(attachment.source !== undefined ? { source: attachment.source } : {}),
        file,
      });
    }
  }
  // A restored image is a separate attachment even when the draft already
  // holds an identical one.
  if (images.length > 0) input.store.addImages(input.target, images, { allowDuplicates: true });
  return { prompt, documents };
}

/**
 * Waits until a rewind has removed `messageId` from the thread, or rejects
 * with the reason the server gave. `revert` sends the command; acceptance
 * alone is not enough, because the rewind itself runs afterwards.
 */
export async function waitForRevertedMessage(
  threadRef: ScopedThreadRef,
  messageId: MessageId,
  revert: () => Promise<void>,
  timeoutMs = 120_000,
): Promise<void> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const initial = appAtomRegistry.get(threadAtom);
  if (!initial?.messages.some((message) => message.id === messageId)) {
    throw new Error("找不到要重来的那条消息，它可能已经被移除。");
  }
  const previousFailures = new Set(
    initial.activities
      .filter((activity) => activity.kind === "checkpoint.revert.failed")
      .map((activity) => activity.id),
  );
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let accepted = false;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unsubscribe();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const inspect = () => {
      const thread = appAtomRegistry.get(threadAtom);
      if (!thread) return;
      const failure = thread.activities.findLast(
        (activity) =>
          activity.kind === "checkpoint.revert.failed" && !previousFailures.has(activity.id),
      );
      if (failure) {
        const payload = failure.payload;
        finish(
          new Error(
            typeof payload === "object" &&
              payload !== null &&
              "detail" in payload &&
              typeof payload.detail === "string"
              ? payload.detail
              : failure.summary,
          ),
        );
      } else if (accepted && !thread.messages.some((message) => message.id === messageId)) {
        finish();
      }
    };
    unsubscribe = appAtomRegistry.subscribe(threadAtom, inspect);
    timeout = globalThis.setTimeout(() => {
      finish(new Error("等待太久，没能确认对话已经回到这条消息之前，请刷新后查看。"));
    }, timeoutMs);
    Promise.resolve()
      .then(revert)
      .then(() => {
        accepted = true;
        inspect();
      }, finish);
  });
}

export function scheduleEnvironmentReconnectWarning(showWarning: () => void): () => void {
  const timeoutId = globalThis.setTimeout(showWarning, ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);
  return () => globalThis.clearTimeout(timeoutId);
}

export function hasEnvironmentReconnectWarningGraceElapsed(
  activeEnvironmentId: EnvironmentId | null,
  elapsedEnvironmentId: EnvironmentId | null,
): boolean {
  return activeEnvironmentId !== null && activeEnvironmentId === elapsedEnvironmentId;
}

export function startNewThreadForProject(
  projectRef: ScopedProjectRef | null,
  handleNewThread: (projectRef: ScopedProjectRef) => Promise<void>,
): boolean {
  if (projectRef === null) return false;
  void handleNewThread(projectRef);

  return true;
}

export function resolveThreadMetadataUpdateForNextTurn(input: {
  currentModelSelection: ModelSelection;
  nextModelSelection?: ModelSelection;
  currentBranch: string | null;
  nextBranch?: string;
}): {
  modelSelection?: ModelSelection;
  branch?: string;
  worktreePath?: null;
} | null {
  const nextModelSelection = input.nextModelSelection;
  const modelSelectionChanged =
    nextModelSelection !== undefined &&
    (nextModelSelection.model !== input.currentModelSelection.model ||
      nextModelSelection.instanceId !== input.currentModelSelection.instanceId ||
      JSON.stringify(nextModelSelection.options ?? null) !==
        JSON.stringify(input.currentModelSelection.options ?? null));
  const branchChanged = input.nextBranch !== undefined && input.nextBranch !== input.currentBranch;
  if (!modelSelectionChanged && !branchChanged) {
    return null;
  }
  return {
    ...(modelSelectionChanged ? { modelSelection: nextModelSelection } : {}),
    ...(branchChanged ? { branch: input.nextBranch, worktreePath: null } : {}),
  };
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    projectId: draftThread.projectId,
    title: "新任务",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    createdAt: draftThread.createdAt,
    updatedAt: draftThread.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    checkpoints: [],
    activities: [],
    proposedPlans: [],
  };
}

export function buildLoadingThreadFromShell(shell: ThreadShell): Thread {
  return {
    ...shell,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    deletedAt: null,
  };
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  activeServerThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.activeServerThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.activeServerThread.environmentId === input.routeThreadRef.environmentId &&
    input.activeServerThread.id === input.targetThreadId,
  );
}

export function buildThreadTurnInterruptInput(thread: Pick<Thread, "id" | "session">): {
  threadId: ThreadId;
  turnId?: TurnId;
} {
  const runningTurnId = thread.session?.status === "running" ? thread.session.activeTurnId : null;
  return {
    threadId: thread.id,
    ...(runningTurnId !== null ? { turnId: runningTurnId } : {}),
  };
}

export function reconcileMountedTerminalThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadTerminalOpen: boolean;
  maxHiddenThreadCount?: number;
}): string[] {
  return reconcileRetainedMountedThreadIds({
    currentThreadIds: input.currentThreadIds,
    openThreadIds: input.openThreadIds,
    activeThreadId: input.activeThreadId,
    activeThreadOpen: input.activeThreadTerminalOpen,
    maxHiddenThreadCount: input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  });
}

export function reconcileRetainedMountedThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadOpen: boolean;
  maxHiddenThreadCount: number;
  retainInactiveActiveThread?: boolean;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) =>
      (threadId !== input.activeThreadId || input.retainInactiveActiveThread === true) &&
      openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(0, input.maxHiddenThreadCount);
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadOpen &&
    !nextThreadIds.includes(input.activeThreadId)
  ) {
    nextThreadIds.push(input.activeThreadId);
  }

  return nextThreadIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftThreadEnvMode;
  isGitRepo: boolean;
}): DraftThreadEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  documentCount?: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  /**
   * Optional element-pick attachment count. Element contexts contribute to
   * "sendable content" exactly like images and (text-bearing) terminal
   * contexts do: a prompt of just element chips is still a valid send.
   */
  elementContextCount?: number;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const elementContextCount = options.elementContextCount ?? 0;
  const documentCount = options.documentCount ?? 0;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      documentCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      elementContextCount > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function branchMismatchKey(
  threadId: string | null,
  mismatch: { threadBranch: string; currentBranch: string } | null,
): string | null {
  if (!threadId || !mismatch) {
    return null;
  }
  return `${threadId}:${mismatch.threadBranch}:${mismatch.currentBranch}`;
}

// The mismatch banner only matters when the user is about to send: passive
// reading of an old thread carries no risk (the branch picker tint already
// covers ambient awareness). Draft content is the intent signal — composer
// focus is useless here because ChatView autofocuses the composer on every
// thread open. `wasShownForCurrentMismatch` keeps the banner mounted once
// revealed so it doesn't flicker away when the draft is cleared.
export function shouldShowBranchMismatchBanner(input: {
  hasMismatch: boolean;
  isDismissed: boolean;
  composerHasContent: boolean;
  wasShownForCurrentMismatch: boolean;
}): boolean {
  if (!input.hasMismatch || input.isDismissed) {
    return false;
  }
  return input.composerHasContent || input.wasShownForCurrentMismatch;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes). Durable cross-device dismissal is planned as a server-side ack.
const sessionDismissedBranchMismatchKeys = new Set<string>();

export function dismissBranchMismatchForSession(key: string): void {
  sessionDismissedBranchMismatchKeys.add(key);
}

export function isBranchMismatchDismissedForSession(key: string | null): boolean {
  return key !== null && sessionDismissedBranchMismatchKeys.has(key);
}

export function threadHasStarted(thread: Thread | null | undefined): boolean {
  return Boolean(
    thread && (thread.latestTurn !== null || thread.messages.length > 0 || thread.session !== null),
  );
}

// `threadProvider` is the open branded driver kind carried by the session.
// Unknown driver kinds degrade to `null` (i.e. "unlocked"), which is the safe
// rollback / fork behavior — the routing layer is the right place to surface
// "driver not installed" errors, not the lock state.
//
// `selectedProvider` takes the same open-string shape because the composer
// now tracks the picker selection as a `ProviderInstanceId` (e.g.
// `codex_personal`). Custom instance ids that don't directly match a
// registered driver resolve to `null` here, which matches the existing
// "unknown driver -> unlocked" semantics. Callers that want the lock to track
// a custom instance's underlying driver kind should resolve the instance id
// upstream and pass the correlated kind.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  const narrowedThreadProvider =
    input.threadProvider && isProviderDriverKind(input.threadProvider)
      ? input.threadProvider
      : null;
  const narrowedSelectedProvider =
    input.selectedProvider && isProviderDriverKind(input.selectedProvider)
      ? input.selectedProvider
      : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}

export function getStartedThreadModelChangeBlockReason(input: {
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "requiresNewThreadForModelChange">>;
  hasStartedSession: boolean;
  currentModelSelection: ModelSelection;
  currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  nextModelSelection: ModelSelection;
}): { title: string; description: string } | null {
  if (!input.hasStartedSession) {
    return null;
  }
  const currentModelSelection = {
    ...input.currentModelSelection,
    instanceId: input.currentProviderInstanceId ?? input.currentModelSelection.instanceId,
  };
  if (
    currentModelSelection.instanceId === input.nextModelSelection.instanceId &&
    currentModelSelection.model === input.nextModelSelection.model
  ) {
    return null;
  }
  const currentProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === currentModelSelection.instanceId,
  );
  const nextProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === input.nextModelSelection.instanceId,
  );
  if (
    currentProvider?.requiresNewThreadForModelChange !== true &&
    nextProvider?.requiresNewThreadForModelChange !== true
  ) {
    return null;
  }
  return {
    title: "Start a new chat to change models",
    description: "This provider does not allow switching models after a conversation has started.",
  };
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const getThread = () => appAtomRegistry.get(threadAtom);
  const thread = getThread();

  if (threadHasStarted(thread)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = appAtomRegistry.subscribe(threadAtom, (thread) => {
      if (!threadHasStarted(thread)) {
        return;
      }
      finish(true);
    });

    if (threadHasStarted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestUserMessageId: ChatMessage["id"] | null;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionStatus: NonNullable<Thread["session"]>["status"] | null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  const latestUserMessage = activeThread?.messages.findLast((message) => message.role === "user");
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestUserMessageId: latestUserMessage?.id ?? null,
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionStatus: session?.status ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  latestUserMessageId: ChatMessage["id"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.threadError)) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestUserMessageChanged =
    input.localDispatch.latestUserMessageId !== input.latestUserMessageId;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    // Steering adds a user message to the current running turn without
    // necessarily changing any of the turn timestamps. Treat that projected
    // message as the server acknowledgment so the composer does not remain
    // stuck in its local "Sending" state until the turn settles.
    if (latestUserMessageChanged) {
      return true;
    }
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== null &&
      session?.activeTurnId !== undefined &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  return (
    latestTurnChanged ||
    input.localDispatch.sessionStatus !== (session?.status ?? null) ||
    input.localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}
