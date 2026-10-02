import { create } from "zustand";
import type {
  ModelSelection,
  OrchestrationThreadActivity,
  PreviewAnnotationPayload,
  PresentationTurnSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

import type { ComposerImageAttachment } from "./composerDraftStore";
import type { ElementContextDraft } from "./lib/elementContext";
import type { TerminalContextDraft } from "./lib/terminalContext";
import type { ReviewCommentContext } from "./reviewCommentContext";
import type { ComposerDocumentAttachment, SessionPhase } from "./types";

/** Attachment preparation owns the session before the provider emits turn.started. */
export function hasPendingAttachmentPreparation(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  const pending = new Set<string>();
  for (const activity of activities) {
    const payload = activity.payload;
    const taskId =
      typeof payload === "object" && payload !== null && "taskId" in payload
        ? Reflect.get(payload, "taskId")
        : undefined;
    if (typeof taskId !== "string" || !taskId.startsWith("attachments-")) continue;
    if (activity.kind === "task.completed") pending.delete(taskId);
    else if (activity.kind === "task.started" || activity.kind === "task.progress")
      pending.add(taskId);
  }
  return pending.size > 0;
}

/**
 * What "send now" does for a queued message. While a turn runs it steers that
 * turn: the provider folds the message in at its next step instead of waiting
 * for the turn to end. Otherwise it goes out as the next turn. A non-null
 * `blockedReason` explains why neither can happen yet.
 */
export function resolveQueuedSendNow(input: {
  phase: SessionPhase;
  isPreparingAttachments: boolean;
  hasPendingRequest: boolean;
  isUnavailable: boolean;
  isStartingTurn: boolean;
  queueSending: boolean;
}): { action: "steer" | "send"; blockedReason: string | null } {
  const action = input.phase === "running" ? "steer" : "send";
  if (input.queueSending) return { action, blockedReason: "正在发送上一条排队消息" };
  if (input.isUnavailable) return { action, blockedReason: "正在连接本地服务" };
  // Approvals and questions pause the agent. A steer landing on top of them
  // answers nothing, so the user resolves them first.
  if (input.hasPendingRequest) return { action, blockedReason: "请先处理当前的授权或问题" };
  // The provider owns the session while it prepares attachments and rejects
  // a second send until that finishes.
  if (input.isPreparingAttachments) return { action, blockedReason: "附件处理中，完成后可引导" };
  if (action === "send" && input.isStartingTurn) {
    return { action, blockedReason: "任务正在启动" };
  }
  return { action, blockedReason: null };
}

/**
 * The composer's settings when the message was queued. The send uses these
 * instead of the live composer, so it can go out while the employee is
 * looking at another task.
 */
export interface QueuedMessageSendSettings {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly fdSkillVersionId?: number;
  readonly nativeSkillNames: ReadonlyArray<string>;
  readonly presentation?: PresentationTurnSelection;
}

/**
 * A composer submission held back while the task's turn runs. It carries the
 * full draft — text, attachments and contexts — so it goes out exactly as the
 * employee pressed Enter on it.
 */
export interface QueuedMessage {
  id: string;
  /** The prompt as typed, including inline chips; editable while queued. */
  text: string;
  createdAt: string;
  images: ReadonlyArray<ComposerImageAttachment>;
  documents: ReadonlyArray<ComposerDocumentAttachment>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  elementContexts: ReadonlyArray<ElementContextDraft>;
  previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  reviewComments: ReadonlyArray<ReviewCommentContext>;
  sendSettings: QueuedMessageSendSettings;
  /**
   * Waits for an explicit "send now" instead of leaving on its own, after a
   * failed send so it cannot retry in a loop.
   */
  holdUntilUserAction?: boolean;
  /** Automatic resends after the provider said it was still finishing a turn. */
  busyRetryCount?: number;
  status: "sending" | "failed" | undefined;
  error: string | undefined;
}

/**
 * The task as it was when its last queued message went out as a new turn.
 * The next message waits until the server has moved past it, so two queued
 * messages never start on the same idle moment.
 */
export interface QueuedDispatch {
  readonly latestTurnId: string | null;
  readonly latestTurnRequestedAt: string | null;
  readonly dispatchedAt: number;
}

interface SendQueueState {
  byThreadKey: Record<string, QueuedMessage[]>;
  lastDispatchByThreadKey: Record<string, QueuedDispatch>;
  enqueue: (threadKey: string, message: QueuedMessage) => void;
  /** Removes and returns one message; null when it is gone or already sending. */
  remove: (threadKey: string, messageId: string) => QueuedMessage | null;
  /** Removes and returns every message that is not already on the wire. */
  takeAll: (threadKey: string) => QueuedMessage[];
  promote: (threadKey: string, messageId: string) => void;
  clear: (threadKey: string) => void;
  clearAll: () => void;
  update: (threadKey: string, messageId: string, update: Partial<QueuedMessage>) => void;
  /** Drops a message whose send went through. */
  finish: (threadKey: string, messageId: string) => void;
  setLastDispatch: (threadKey: string, dispatch: QueuedDispatch | null) => void;
}

function withQueue(
  state: Pick<SendQueueState, "byThreadKey">,
  threadKey: string,
  queue: QueuedMessage[],
): Pick<SendQueueState, "byThreadKey"> {
  const byThreadKey = { ...state.byThreadKey };
  if (queue.length === 0) delete byThreadKey[threadKey];
  else byThreadKey[threadKey] = queue;
  return { byThreadKey };
}

/** In-memory only: a queued message is a live intent, not a draft worth persisting. */
export const useSendQueueStore = create<SendQueueState>((set, get) => ({
  byThreadKey: {},
  lastDispatchByThreadKey: {},
  enqueue: (threadKey, message) =>
    set((state) => withQueue(state, threadKey, [...(state.byThreadKey[threadKey] ?? []), message])),
  remove: (threadKey, messageId) => {
    const queue = get().byThreadKey[threadKey] ?? [];
    const message = queue.find((entry) => entry.id === messageId);
    if (!message || message.status === "sending") return null;
    set((state) =>
      withQueue(
        state,
        threadKey,
        queue.filter((entry) => entry.id !== messageId),
      ),
    );
    return message;
  },
  takeAll: (threadKey) => {
    const queue = get().byThreadKey[threadKey] ?? [];
    const taken = queue.filter((entry) => entry.status !== "sending");
    if (taken.length === 0) return [];
    set((state) =>
      withQueue(
        state,
        threadKey,
        queue.filter((entry) => entry.status === "sending"),
      ),
    );
    return taken;
  },
  promote: (threadKey, messageId) =>
    set((state) => {
      const current = state.byThreadKey[threadKey] ?? [];
      const index = current.findIndex((message) => message.id === messageId);
      if (index <= 0) return state;
      const selected = current[index];
      if (!selected) return state;
      return withQueue(state, threadKey, [
        selected,
        ...current.slice(0, index),
        ...current.slice(index + 1),
      ]);
    }),
  clear: (threadKey) => set((state) => withQueue(state, threadKey, [])),
  clearAll: () => set({ byThreadKey: {}, lastDispatchByThreadKey: {} }),
  update: (threadKey, messageId, update) =>
    set((state) => {
      const current = state.byThreadKey[threadKey];
      if (!current?.some((message) => message.id === messageId)) return state;
      return withQueue(
        state,
        threadKey,
        current.map((message) => (message.id === messageId ? { ...message, ...update } : message)),
      );
    }),
  finish: (threadKey, messageId) =>
    set((state) =>
      withQueue(
        state,
        threadKey,
        (state.byThreadKey[threadKey] ?? []).filter((message) => message.id !== messageId),
      ),
    ),
  setLastDispatch: (threadKey, dispatch) =>
    set((state) => {
      const lastDispatchByThreadKey = { ...state.lastDispatchByThreadKey };
      if (dispatch) lastDispatchByThreadKey[threadKey] = dispatch;
      else delete lastDispatchByThreadKey[threadKey];
      return { lastDispatchByThreadKey };
    }),
}));

/** How long a dispatched turn may stay unacknowledged before the queue moves on anyway. */
export const QUEUED_DISPATCH_ACK_TIMEOUT_MS = 30_000;

/**
 * Whether the server has picked up the last queued turn start: the task's
 * latest turn changed since the dispatch, or the dispatch is old enough that
 * a lost acknowledgement must not stall the queue forever.
 */
export function isQueuedDispatchAcknowledged(input: {
  readonly dispatch: QueuedDispatch | undefined;
  readonly latestTurnId: string | null;
  readonly latestTurnRequestedAt: string | null;
  readonly nowMs: number;
}): boolean {
  const { dispatch } = input;
  if (!dispatch) return true;
  if (
    input.latestTurnId !== dispatch.latestTurnId ||
    input.latestTurnRequestedAt !== dispatch.latestTurnRequestedAt
  ) {
    return true;
  }
  return input.nowMs - dispatch.dispatchedAt >= QUEUED_DISPATCH_ACK_TIMEOUT_MS;
}

/**
 * A queued message goes out by itself only once the task is idle: no running
 * or starting session, nothing waiting on the employee, and the previous
 * queued turn already picked up. Failed or held messages wait for "send now".
 */
export function isQueuedMessageDue(input: {
  readonly message: Pick<QueuedMessage, "status" | "holdUntilUserAction">;
  readonly sessionStatus: string | null;
  readonly hasPendingRequest: boolean;
  readonly connected: boolean;
  readonly dispatchAcknowledged: boolean;
}): boolean {
  if (input.message.holdUntilUserAction || input.message.status !== undefined) return false;
  if (!input.connected || input.hasPendingRequest || !input.dispatchAcknowledged) return false;
  return input.sessionStatus !== "running" && input.sessionStatus !== "starting";
}
