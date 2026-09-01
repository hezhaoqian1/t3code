import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type MessageFeedback = "positive" | "negative";
type FeedbackByMessage = Record<string, MessageFeedback>;

export interface MessageFeedbackStoreState {
  /** Feedback is scoped by route thread key so similarly named messages never collide. */
  byThreadKey: Record<string, FeedbackByMessage>;
  setFeedback: (threadKey: string, messageId: string, feedback: MessageFeedback | null) => void;
}

export const MESSAGE_FEEDBACK_STORAGE_KEY = "fd-ai-message-feedback";
export const MESSAGE_FEEDBACK_MAX_THREADS = 100;
export const MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD = 500;

function normalizeFeedback(value: unknown): MessageFeedback | null {
  return value === "positive" || value === "negative" ? value : null;
}

export function migratePersistedMessageFeedbackState(persistedState: unknown): {
  byThreadKey: Record<string, FeedbackByMessage>;
} {
  if (!persistedState || typeof persistedState !== "object") return { byThreadKey: {} };
  const raw = (persistedState as { byThreadKey?: unknown }).byThreadKey;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { byThreadKey: {} };

  const byThreadKey: Record<string, FeedbackByMessage> = {};
  for (const [threadKey, messages] of Object.entries(raw as Record<string, unknown>).slice(
    -MESSAGE_FEEDBACK_MAX_THREADS,
  )) {
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) continue;
    const normalized: FeedbackByMessage = {};
    for (const [messageId, value] of Object.entries(messages as Record<string, unknown>).slice(
      -MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD,
    )) {
      const feedback = normalizeFeedback(value);
      if (feedback) normalized[messageId] = feedback;
    }
    if (Object.keys(normalized).length > 0) byThreadKey[threadKey] = normalized;
  }
  return { byThreadKey };
}

function setBoundedFeedback(
  byThreadKey: Record<string, FeedbackByMessage>,
  threadKey: string,
  messageId: string,
  feedback: MessageFeedback | null,
): Record<string, FeedbackByMessage> {
  const next = { ...byThreadKey };
  const threadFeedback = { ...(next[threadKey] ?? {}) };
  if (feedback === null) delete threadFeedback[messageId];
  else threadFeedback[messageId] = feedback;

  if (Object.keys(threadFeedback).length === 0) {
    delete next[threadKey];
  } else {
    const boundedMessages = Object.entries(threadFeedback).slice(
      -MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD,
    );
    next[threadKey] = Object.fromEntries(boundedMessages);
  }

  const boundedThreads = Object.entries(next).slice(-MESSAGE_FEEDBACK_MAX_THREADS);
  return Object.fromEntries(boundedThreads);
}

export const useMessageFeedbackStore = create<MessageFeedbackStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      setFeedback: (threadKey, messageId, feedback) =>
        set((state) => ({
          byThreadKey: setBoundedFeedback(state.byThreadKey, threadKey, messageId, feedback),
        })),
    }),
    {
      name: MESSAGE_FEEDBACK_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedMessageFeedbackState,
    },
  ),
);
