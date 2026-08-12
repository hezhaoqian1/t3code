// @effect-diagnostics globalDate:off
import {
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  type OrchestrationVolatileThreadOverlay,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { FdEnterpriseHistory } from "./FdEnterpriseAgentClient.ts";

const MAX_MESSAGES = 2_000;
const MAX_ACTIVITIES = 500;
const OVERLAY_IDLE_TTL_MS = 30 * 60 * 1_000;
const ENTERPRISE_HISTORY_MESSAGE_PREFIX = "fd-enterprise-history:";

const enterpriseHistoryMessageId = (conversationId: number, messageId: number): MessageId =>
  MessageId.make(ENTERPRISE_HISTORY_MESSAGE_PREFIX + conversationId + ":" + messageId);

type HistoryLoader = (threadId: ThreadId) => Promise<FdEnterpriseHistory | undefined>;

interface StagedTurn {
  readonly message: OrchestrationMessage;
}

interface ThreadOverlayState {
  messages: Array<OrchestrationMessage>;
  activities: Array<OrchestrationThreadActivity>;
  volatileRevision: number;
  lastAccessAt: number;
  historyLoaded: boolean;
  historyLoading: Promise<void> | undefined;
  readonly stagedTurns: Map<MessageId, StagedTurn>;
  readonly liveMessageIds: Set<MessageId>;
  readonly reasoningByItemId: Map<string, string>;
}

export interface FdEnterpriseTurnInput {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly createdAt: string;
}

export interface FdEnterpriseThreadRuntimeShape {
  readonly stageTurn: (input: FdEnterpriseTurnInput) => Effect.Effect<void>;
  readonly getStagedTurn: (
    threadId: ThreadId,
    messageId: MessageId,
  ) => Effect.Effect<OrchestrationMessage | undefined>;
  readonly clearStagedTurn: (threadId: ThreadId, messageId: MessageId) => Effect.Effect<void>;
  readonly clearThread: (threadId: ThreadId) => Effect.Effect<void>;
  readonly clearAll: () => Effect.Effect<void>;
  readonly reloadAllHistory: () => Effect.Effect<void>;
  readonly getGeneration: () => number;
  readonly applyRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly restoreHistory: (history: FdEnterpriseHistory) => Effect.Effect<void>;
  readonly ensureHistory: (threadId: ThreadId) => Effect.Effect<void>;
  readonly getSnapshot: (threadId: ThreadId) => Effect.Effect<OrchestrationVolatileThreadOverlay>;
  readonly stream: (threadId: ThreadId) => Stream.Stream<OrchestrationEvent>;
  readonly resetStream: Stream.Stream<OrchestrationVolatileThreadOverlay>;
  readonly setHistoryLoader: (loader: HistoryLoader) => Effect.Effect<void>;
}

export class FdEnterpriseThreadRuntime extends Context.Service<
  FdEnterpriseThreadRuntime,
  FdEnterpriseThreadRuntimeShape
>()("t3/fd-skills/FdEnterpriseThreadRuntime") {}

const make = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<OrchestrationEvent>();
  const resets = yield* PubSub.unbounded<OrchestrationVolatileThreadOverlay>();
  const states = new Map<ThreadId, ThreadOverlayState>();
  let historyLoader: HistoryLoader | undefined;
  let historyGeneration = 0;
  let volatileRevision = 0;
  const nextVolatileRevision = (): number => {
    volatileRevision += 1;
    return volatileRevision;
  };

  const pruneExpired = (now = Date.now()) => {
    for (const [threadId, state] of states) {
      if (state.stagedTurns.size === 0 && now - state.lastAccessAt > OVERLAY_IDLE_TTL_MS) {
        states.delete(threadId);
      }
    }
  };

  const stateFor = (threadId: ThreadId): ThreadOverlayState => {
    pruneExpired();
    const existing = states.get(threadId);
    if (existing) {
      existing.lastAccessAt = Date.now();
      return existing;
    }
    const state: ThreadOverlayState = {
      messages: [],
      activities: [],
      volatileRevision,
      lastAccessAt: Date.now(),
      historyLoaded: false,
      historyLoading: undefined,
      stagedTurns: new Map(),
      liveMessageIds: new Set(),
      reasoningByItemId: new Map(),
    };
    states.set(threadId, state);
    return state;
  };

  const eventBase = (threadId: ThreadId, occurredAt: string) => {
    const state = stateFor(threadId);
    state.volatileRevision = nextVolatileRevision();
    return {
      sequence: 0,
      volatileRevision: state.volatileRevision,
      eventId: EventId.make(`fd-volatile-${NodeCrypto.randomUUID()}`),
      aggregateKind: "thread" as const,
      aggregateId: threadId,
      occurredAt,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
    };
  };

  const publish = (event: OrchestrationEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

  const applyMessageEvent = (
    state: ThreadOverlayState,
    event: Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
  ) => {
    const next: OrchestrationMessage = {
      id: event.payload.messageId,
      role: event.payload.role,
      text: event.payload.text,
      turnId: event.payload.turnId,
      streaming: event.payload.streaming,
      createdAt: event.payload.createdAt,
      updatedAt: event.payload.updatedAt,
    };
    const index = state.messages.findIndex((message) => message.id === next.id);
    if (index < 0) {
      state.messages = [...state.messages, next].slice(-MAX_MESSAGES);
      return;
    }
    const existing = state.messages[index]!;
    state.messages[index] = {
      ...existing,
      text: next.streaming
        ? `${existing.text}${next.text}`
        : next.text.length > 0
          ? next.text
          : existing.text,
      streaming: next.streaming,
      turnId: next.turnId,
      updatedAt: next.updatedAt,
    };
  };

  const applyActivityEvent = (
    state: ThreadOverlayState,
    event: Extract<OrchestrationEvent, { type: "thread.activity-appended" }>,
  ) => {
    state.activities = [
      ...state.activities.filter((activity) => activity.id !== event.payload.activity.id),
      event.payload.activity,
    ]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-MAX_ACTIVITIES);
  };

  const emitMessage = (input: {
    threadId: ThreadId;
    messageId: MessageId;
    role: "user" | "assistant";
    text: string;
    turnId: ProviderRuntimeEvent["turnId"] | null;
    streaming: boolean;
    createdAt: string;
  }) =>
    Effect.gen(function* () {
      const event = {
        ...eventBase(input.threadId, input.createdAt),
        type: "thread.message-sent" as const,
        payload: {
          threadId: input.threadId,
          messageId: input.messageId,
          role: input.role,
          text: input.text,
          turnId: input.turnId ?? null,
          streaming: input.streaming,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
      } satisfies Extract<OrchestrationEvent, { type: "thread.message-sent" }>;
      applyMessageEvent(stateFor(input.threadId), event);
      yield* publish(event);
    });

  const emitActivity = (input: {
    threadId: ThreadId;
    id: string;
    tone: OrchestrationThreadActivity["tone"];
    kind: string;
    summary: string;
    payload: unknown;
    turnId: ProviderRuntimeEvent["turnId"] | null;
    createdAt: string;
  }) =>
    Effect.gen(function* () {
      const event = {
        ...eventBase(input.threadId, input.createdAt),
        type: "thread.activity-appended" as const,
        payload: {
          threadId: input.threadId,
          activity: {
            id: EventId.make(input.id),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: input.turnId ?? null,
            createdAt: input.createdAt,
          },
        },
      } satisfies Extract<OrchestrationEvent, { type: "thread.activity-appended" }>;
      applyActivityEvent(stateFor(input.threadId), event);
      yield* publish(event);
    });

  const restoreHistorySync = (
    history: FdEnterpriseHistory,
    expectedState?: ThreadOverlayState,
  ): void => {
    const threadId = history.clientThreadId as ThreadId;
    const state = expectedState ?? stateFor(threadId);
    // History reloads are snapshots, so advance the volatile revision before
    // publishing them. This keeps a post-account-switch reload newer than the
    // empty reset snapshot that invalidated the previous account's overlay.
    state.volatileRevision = nextVolatileRevision();
    const staged = Array.from(state.stagedTurns.values(), (entry) => entry.message);
    // A history request can overlap the active Enterprise stream. Replace only
    // the old server projection; live items and locally staged turns remain
    // authoritative until the stream settles.
    const live = state.messages.filter((message) => state.liveMessageIds.has(message.id));
    const restored = history.messages.map(
      (message): OrchestrationMessage => ({
        id: enterpriseHistoryMessageId(history.conversationId, message.id),
        role: message.role,
        text: message.text,
        turnId: null,
        streaming: false,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      }),
    );
    const byId = new Map<MessageId, OrchestrationMessage>();
    for (const message of [...restored, ...live, ...staged]) byId.set(message.id, message);
    for (const message of restored) state.liveMessageIds.delete(message.id);
    state.messages = Array.from(byId.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-MAX_MESSAGES);
    state.historyLoaded = true;
  };

  const restoreHistory = (history: FdEnterpriseHistory) =>
    Effect.sync(() => restoreHistorySync(history));

  const snapshotFor = (threadId: ThreadId): OrchestrationVolatileThreadOverlay => {
    const state = stateFor(threadId);
    return {
      threadId,
      revision: state.volatileRevision,
      messages: [...state.messages],
      activities: [...state.activities],
    };
  };

  const ensureHistory = (threadId: ThreadId) =>
    Effect.promise(async () => {
      const state = stateFor(threadId);
      if (state.historyLoaded) return;
      if (state.historyLoading) return state.historyLoading;
      if (!historyLoader) return;
      const generation = historyGeneration;
      let request!: Promise<void>;
      request = (async () => {
        try {
          const history = await historyLoader!(threadId);
          if (historyGeneration !== generation || states.get(threadId) !== state) return;
          if (history) restoreHistorySync(history, state);
          else state.historyLoaded = true;
        } catch {
          // Transient failures stay retryable so a later authenticated subscription can recover.
        } finally {
          if (state.historyLoading === request) state.historyLoading = undefined;
        }
      })();
      state.historyLoading = request;
      return request;
    });

  const stageTurn: FdEnterpriseThreadRuntimeShape["stageTurn"] = (input) =>
    Effect.gen(function* () {
      const state = stateFor(input.threadId);
      const message: OrchestrationMessage = {
        id: input.messageId,
        role: "user",
        text: input.text,
        turnId: null,
        streaming: false,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      state.stagedTurns.set(input.messageId, { message });
      yield* emitMessage({
        threadId: input.threadId,
        messageId: input.messageId,
        role: "user",
        text: input.text,
        turnId: null,
        streaming: false,
        createdAt: input.createdAt,
      });
    });

  const applyRuntimeEvent: FdEnterpriseThreadRuntimeShape["applyRuntimeEvent"] = (event) => {
    if (event.persistence !== "memory-only") return Effect.void;
    if (event.volatileGeneration !== undefined && event.volatileGeneration !== historyGeneration) {
      return Effect.void;
    }
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      const messageId = MessageId.make(
        event.itemId ?? RuntimeItemId.make(`${event.turnId ?? "turn"}:assistant`),
      );
      stateFor(event.threadId).liveMessageIds.add(messageId);
      return emitMessage({
        threadId: event.threadId,
        messageId,
        role: "assistant",
        text: event.payload.delta,
        turnId: event.turnId ?? null,
        streaming: true,
        createdAt: event.createdAt,
      });
    }
    if (event.type === "content.delta" && event.payload.streamKind === "reasoning_summary_text") {
      const state = stateFor(event.threadId);
      const itemId = event.itemId ?? RuntimeItemId.make(`${event.turnId ?? "turn"}:reasoning`);
      const summary = `${state.reasoningByItemId.get(itemId) ?? ""}${event.payload.delta}`;
      state.reasoningByItemId.set(itemId, summary);
      return emitActivity({
        threadId: event.threadId,
        id: `fd-reasoning:${itemId}`,
        tone: "info",
        kind: "reasoning.summary",
        summary: "正在分析业务需求",
        payload: { text: summary },
        turnId: event.turnId ?? null,
        createdAt: event.createdAt,
      });
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      if (event.payload.itemType === "assistant_message") {
        if (event.type !== "item.completed") return Effect.void;
        const final = (() => {
          const data = event.payload.data;
          if (typeof data !== "object" || data === null) {
            return { text: "", messageId: undefined };
          }
          const value = (data as { finalText?: unknown }).finalText;
          const conversationId = (data as { enterpriseConversationId?: unknown })
            .enterpriseConversationId;
          const messageId = (data as { enterpriseMessageId?: unknown }).enterpriseMessageId;
          return {
            text: typeof value === "string" ? value : "",
            messageId:
              Number.isSafeInteger(conversationId) &&
              (conversationId as number) >= 0 &&
              Number.isSafeInteger(messageId) &&
              (messageId as number) >= 0
                ? enterpriseHistoryMessageId(conversationId as number, messageId as number)
                : undefined,
          };
        })();
        const runtimeMessageId = MessageId.make(
          event.itemId ?? RuntimeItemId.make(`${event.turnId ?? "turn"}:assistant`),
        );
        const finalMessageId = final.messageId ?? runtimeMessageId;
        const state = stateFor(event.threadId);
        if (finalMessageId !== runtimeMessageId) {
          state.messages = state.messages.filter((message) => message.id !== runtimeMessageId);
          state.liveMessageIds.delete(runtimeMessageId);
        }
        state.liveMessageIds.add(finalMessageId);
        return emitMessage({
          threadId: event.threadId,
          messageId: finalMessageId,
          role: "assistant",
          text: final.text,
          turnId: event.turnId ?? null,
          streaming: false,
          createdAt: event.createdAt,
        });
      }
      const completed = event.type === "item.completed";
      return emitActivity({
        threadId: event.threadId,
        id: `fd-tool:${event.itemId ?? event.eventId}`,
        tone: completed && event.payload.status === "failed" ? "error" : "tool",
        kind: completed ? "tool.completed" : "tool.started",
        summary: event.payload.title ?? (completed ? "企业查询已完成" : "正在执行企业查询"),
        payload: event.payload.detail ? { detail: event.payload.detail } : {},
        turnId: event.turnId ?? null,
        createdAt: event.createdAt,
      });
    }
    return Effect.void;
  };

  return {
    stageTurn,
    getStagedTurn: (threadId, messageId) =>
      Effect.sync(() => stateFor(threadId).stagedTurns.get(messageId)?.message),
    clearStagedTurn: (threadId, messageId) =>
      Effect.sync(() => {
        stateFor(threadId).stagedTurns.delete(messageId);
      }),
    clearThread: (threadId) =>
      Effect.sync(() => {
        states.delete(threadId);
      }),
    clearAll: () =>
      Effect.gen(function* () {
        historyGeneration += 1;
        const clearedAt = yield* Clock.currentTimeMillis;
        const snapshots: Array<OrchestrationVolatileThreadOverlay> = [];
        for (const [threadId, state] of states) {
          state.messages = [];
          state.activities = [];
          state.stagedTurns.clear();
          state.liveMessageIds.clear();
          state.reasoningByItemId.clear();
          state.historyLoaded = false;
          state.historyLoading = undefined;
          state.volatileRevision = nextVolatileRevision();
          state.lastAccessAt = clearedAt;
          snapshots.push({
            threadId,
            revision: state.volatileRevision,
            messages: [],
            activities: [],
          });
        }
        yield* Effect.forEach(snapshots, (snapshot) => PubSub.publish(resets, snapshot), {
          discard: true,
        });
      }),
    reloadAllHistory: () =>
      Effect.forEach(
        [...states.keys()],
        (threadId) =>
          ensureHistory(threadId).pipe(
            Effect.andThen(Effect.sync(() => snapshotFor(threadId))),
            Effect.flatMap((snapshot) => PubSub.publish(resets, snapshot)),
          ),
        { discard: true },
      ),
    getGeneration: () => historyGeneration,
    applyRuntimeEvent,
    restoreHistory,
    ensureHistory,
    getSnapshot: (threadId) => Effect.sync(() => snapshotFor(threadId)),
    stream: (threadId) =>
      Stream.fromPubSub(events).pipe(Stream.filter((event) => event.aggregateId === threadId)),
    resetStream: Stream.fromPubSub(resets),
    setHistoryLoader: (loader) =>
      Effect.sync(() => {
        historyLoader = loader;
      }),
  } satisfies FdEnterpriseThreadRuntimeShape;
});

export const FdEnterpriseThreadRuntimeLive = Layer.effect(FdEnterpriseThreadRuntime, make);
