import { create } from "zustand";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { SessionPhase } from "./types";

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

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  /** Optional command snapshot for callers that need to preserve attachments. */
  input?: unknown;
  status: "sending" | "failed" | undefined;
  error: string | undefined;
}

interface SendQueueState {
  byThreadKey: Record<string, QueuedMessage[]>;
  enqueue: (threadKey: string, message: QueuedMessage) => void;
  remove: (threadKey: string, messageId: string) => void;
  promote: (threadKey: string, messageId: string) => void;
  clear: (threadKey: string) => void;
  clearAll: () => void;
  update: (threadKey: string, messageId: string, update: Partial<QueuedMessage>) => void;
}

export const useSendQueueStore = create<SendQueueState>((set) => ({
  byThreadKey: {},
  enqueue: (threadKey, message) =>
    set((state) => ({
      byThreadKey: {
        ...state.byThreadKey,
        [threadKey]: [...(state.byThreadKey[threadKey] ?? []), message],
      },
    })),
  remove: (threadKey, messageId) =>
    set((state) => ({
      byThreadKey: {
        ...state.byThreadKey,
        [threadKey]: (state.byThreadKey[threadKey] ?? []).filter(
          (message) => message.id !== messageId,
        ),
      },
    })),
  promote: (threadKey, messageId) =>
    set((state) => {
      const current = state.byThreadKey[threadKey] ?? [];
      const index = current.findIndex((message) => message.id === messageId);
      if (index <= 0) return state;
      const selected = current[index];
      if (!selected) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: [selected, ...current.slice(0, index), ...current.slice(index + 1)],
        },
      };
    }),
  clear: (threadKey) =>
    set((state) => ({
      byThreadKey: { ...state.byThreadKey, [threadKey]: [] },
    })),
  clearAll: () => set({ byThreadKey: {} }),
  update: (threadKey, messageId, update) =>
    set((state) => ({
      byThreadKey: {
        ...state.byThreadKey,
        [threadKey]: (state.byThreadKey[threadKey] ?? []).map((message) =>
          message.id === messageId ? { ...message, ...update } : message,
        ),
      },
    })),
}));

// Claim the message synchronously so rerenders and double clicks cannot send
// it twice. A failed request remains visible until the user retries it.
export async function dispatchQueuedMessage(
  threadKey: string,
  messageId: string,
  send: (message: QueuedMessage) => Promise<void>,
): Promise<void> {
  const store = useSendQueueStore.getState();
  const queue = store.byThreadKey[threadKey] ?? [];
  const message = queue.find((entry) => entry.id === messageId);
  if (!message || queue.some((entry) => entry.status === "sending")) return;
  store.update(threadKey, messageId, { status: "sending", error: undefined });
  try {
    await send(message);
    store.remove(threadKey, messageId);
  } catch (error) {
    store.update(threadKey, messageId, {
      status: "failed",
      error: error instanceof Error ? error.message : "发送失败，请重试。",
    });
  }
}
