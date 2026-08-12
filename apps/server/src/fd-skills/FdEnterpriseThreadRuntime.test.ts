import {
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import type { FdEnterpriseHistory } from "./FdEnterpriseAgentClient.ts";
import {
  FdEnterpriseThreadRuntime,
  FdEnterpriseThreadRuntimeLive,
} from "./FdEnterpriseThreadRuntime.ts";

const threadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440000");
const turnId = TurnId.make("turn-1");
const eventBase = {
  eventId: EventId.make("event-1"),
  provider: ProviderDriverKind.make("fd-deepseek"),
  providerInstanceId: ProviderInstanceId.make("fd-deepseek"),
  threadId,
  turnId,
  createdAt: "2026-08-10T00:00:01.000Z",
  persistence: "memory-only" as const,
};

describe("FdEnterpriseThreadRuntime", () => {
  effectIt.effect("keeps staged and streamed enterprise content in the volatile overlay", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      yield* runtime.stageTurn({
        threadId,
        messageId: MessageId.make("message-1"),
        text: "查询蔡梦晨持仓",
        createdAt: "2026-08-10T00:00:00.000Z",
      });
      yield* runtime.applyRuntimeEvent({
        ...eventBase,
        itemId: RuntimeItemId.make("assistant-1"),
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: "持仓查询结果" },
      });
      yield* runtime.applyRuntimeEvent({
        ...eventBase,
        eventId: EventId.make("event-2"),
        itemId: RuntimeItemId.make("assistant-1"),
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          status: "completed",
          data: { finalText: "最终企业结果" },
        },
      });

      const snapshot = yield* runtime.getSnapshot(threadId);
      expect(snapshot.messages).toMatchObject([
        { role: "user", text: "查询蔡梦晨持仓", streaming: false },
        { role: "assistant", text: "最终企业结果", streaming: false },
      ]);
      expect(snapshot.revision).toBeGreaterThan(0);
      expect(yield* runtime.getStagedTurn(threadId, MessageId.make("message-1"))).toMatchObject({
        text: "查询蔡梦晨持仓",
      });
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("restores server-authoritative history through the registered loader", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      yield* runtime.setHistoryLoader(async () => ({
        clientThreadId: threadId,
        conversationId: 0,
        truncated: false,
        messages: [
          {
            id: 11,
            conversationId: 0,
            role: "assistant",
            text: "服务端历史",
            createdAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      }));
      yield* runtime.ensureHistory(threadId);
      expect((yield* runtime.getSnapshot(threadId)).messages).toMatchObject([
        { role: "assistant", text: "服务端历史" },
      ]);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("keeps transient history failures retryable until a later load succeeds", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      let attempts = 0;
      yield* runtime.setHistoryLoader(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary history outage");
        return {
          clientThreadId: threadId,
          conversationId: 7,
          truncated: false,
          messages: [
            {
              id: 12,
              conversationId: 7,
              role: "assistant",
              text: "重试后恢复的服务端历史",
              createdAt: "2026-08-10T00:00:00.000Z",
            },
          ],
        };
      });

      yield* runtime.ensureHistory(threadId);
      expect((yield* runtime.getSnapshot(threadId)).messages).toEqual([]);
      yield* runtime.ensureHistory(threadId);
      expect(attempts).toBe(2);
      expect((yield* runtime.getSnapshot(threadId)).messages).toMatchObject([
        { role: "assistant", text: "重试后恢复的服务端历史" },
      ]);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("purges every account-scoped overlay on credential invalidation", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      yield* runtime.stageTurn({
        threadId,
        messageId: MessageId.make("message-account-scoped"),
        text: "敏感企业查询",
        createdAt: "2026-08-10T00:00:00.000Z",
      });
      expect((yield* runtime.getSnapshot(threadId)).messages).not.toEqual([]);
      yield* runtime.clearAll();
      expect((yield* runtime.getSnapshot(threadId)).messages).toEqual([]);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("keeps revisions monotonic when a cleared thread is recreated", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      const messageId = MessageId.make("message-before-recreate");
      yield* runtime.stageTurn({
        threadId,
        messageId,
        text: "before",
        createdAt: "2026-08-10T00:00:00.000Z",
      });
      const before = yield* runtime.getSnapshot(threadId);
      yield* runtime.clearStagedTurn(threadId, messageId);
      yield* runtime.clearThread(threadId);
      yield* runtime.stageTurn({
        threadId,
        messageId: MessageId.make("message-after-recreate"),
        text: "after",
        createdAt: "2026-08-10T00:00:01.000Z",
      });

      expect((yield* runtime.getSnapshot(threadId)).revision).toBeGreaterThan(before.revision);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("invalidates in-flight history and publishes an empty reset snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* FdEnterpriseThreadRuntime;
        const context = yield* Effect.context<never>();
        const runPromise = Effect.runPromiseWith(context);
        const loaderReady = yield* Deferred.make<void>();
        const historyResponse = yield* Deferred.make<FdEnterpriseHistory>();
        yield* runtime.setHistoryLoader(() =>
          runPromise(
            Deferred.succeed(loaderReady, undefined).pipe(
              Effect.andThen(Deferred.await(historyResponse)),
            ),
          ),
        );
        yield* runtime.stageTurn({
          threadId,
          messageId: MessageId.make("message-before-account-switch"),
          text: "账号 A 的企业查询",
          createdAt: "2026-08-10T00:00:00.000Z",
        });
        const before = yield* runtime.getSnapshot(threadId);
        const resetFiber = yield* Stream.runHead(runtime.resetStream).pipe(Effect.forkChild);
        const historyFiber = yield* runtime.ensureHistory(threadId).pipe(Effect.forkChild);
        yield* Deferred.await(loaderReady);

        yield* runtime.clearAll();
        yield* Deferred.succeed(historyResponse, {
          clientThreadId: threadId,
          conversationId: 9,
          truncated: false,
          messages: [
            {
              id: 99,
              conversationId: 9,
              role: "assistant",
              text: "账号 A 的迟到历史",
              createdAt: "2026-08-10T00:00:00.000Z",
            },
          ],
        });
        yield* Fiber.join(historyFiber);
        const reset = yield* Fiber.join(resetFiber);

        expect(Option.isSome(reset)).toBe(true);
        if (Option.isSome(reset)) {
          expect(reset.value).toMatchObject({
            threadId,
            messages: [],
            activities: [],
          });
          expect(reset.value.revision).toBeGreaterThan(before.revision);
        }
        expect((yield* runtime.getSnapshot(threadId)).messages).toEqual([]);
      }),
    ).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("merges a pending history response with live Enterprise completion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* FdEnterpriseThreadRuntime;
        const context = yield* Effect.context<never>();
        const runPromise = Effect.runPromiseWith(context);
        const loaderReady = yield* Deferred.make<void>();
        const historyResponse = yield* Deferred.make<FdEnterpriseHistory>();
        yield* runtime.setHistoryLoader(() =>
          runPromise(
            Deferred.succeed(loaderReady, undefined).pipe(
              Effect.andThen(Deferred.await(historyResponse)),
            ),
          ),
        );
        const historyFiber = yield* runtime.ensureHistory(threadId).pipe(Effect.forkChild);
        yield* Deferred.await(loaderReady);

        yield* runtime.applyRuntimeEvent({
          ...eventBase,
          itemId: RuntimeItemId.make("assistant-history-race"),
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "实时回答" },
        });
        yield* runtime.applyRuntimeEvent({
          ...eventBase,
          eventId: EventId.make("event-history-race-completed"),
          itemId: RuntimeItemId.make("assistant-history-race"),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            data: { finalText: "实时最终回答" },
          },
        });
        yield* Deferred.succeed(historyResponse, {
          clientThreadId: threadId,
          conversationId: 11,
          truncated: false,
          messages: [
            {
              id: 101,
              conversationId: 11,
              role: "assistant",
              text: "服务端历史",
              createdAt: "2026-08-10T00:00:00.000Z",
            },
          ],
        });
        yield* Fiber.join(historyFiber);

        expect((yield* runtime.getSnapshot(threadId)).messages).toMatchObject([
          { text: "服务端历史", streaming: false },
          { text: "实时最终回答", streaming: false },
        ]);
      }),
    ).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("deduplicates a same-turn assistant already included in restored history", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* FdEnterpriseThreadRuntime;
        const context = yield* Effect.context<never>();
        const runPromise = Effect.runPromiseWith(context);
        const loaderReady = yield* Deferred.make<void>();
        const historyResponse = yield* Deferred.make<FdEnterpriseHistory>();
        yield* runtime.setHistoryLoader(() =>
          runPromise(
            Deferred.succeed(loaderReady, undefined).pipe(
              Effect.andThen(Deferred.await(historyResponse)),
            ),
          ),
        );
        const historyFiber = yield* runtime.ensureHistory(threadId).pipe(Effect.forkChild);
        yield* Deferred.await(loaderReady);
        const completedAt = "2026-08-10T00:00:02.000Z";
        yield* runtime.applyRuntimeEvent({
          ...eventBase,
          createdAt: completedAt,
          itemId: RuntimeItemId.make("assistant-same-turn"),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            data: {
              finalText: "同一回合最终回答",
              enterpriseConversationId: 12,
              enterpriseMessageId: 120,
            },
          },
        });
        yield* Deferred.succeed(historyResponse, {
          clientThreadId: threadId,
          conversationId: 12,
          truncated: false,
          messages: [
            {
              id: 120,
              conversationId: 12,
              role: "assistant",
              text: "同一回合最终回答",
              createdAt: completedAt,
            },
          ],
        });
        yield* Fiber.join(historyFiber);
        const messages = (yield* runtime.getSnapshot(threadId)).messages;
        expect(messages.filter((message) => message.text === "同一回合最终回答")).toHaveLength(1);
      }),
    ).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect(
    "reconciles a delta, overlapping history, and later terminal item by stable ID",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* FdEnterpriseThreadRuntime;
          const context = yield* Effect.context<never>();
          const runPromise = Effect.runPromiseWith(context);
          const loaderReady = yield* Deferred.make<void>();
          const historyResponse = yield* Deferred.make<FdEnterpriseHistory>();
          yield* runtime.setHistoryLoader(() =>
            runPromise(
              Deferred.succeed(loaderReady, undefined).pipe(
                Effect.andThen(Deferred.await(historyResponse)),
              ),
            ),
          );
          const historyFiber = yield* runtime.ensureHistory(threadId).pipe(Effect.forkChild);
          yield* Deferred.await(loaderReady);
          const itemId = RuntimeItemId.make("assistant-overlap-race");
          yield* runtime.applyRuntimeEvent({
            ...eventBase,
            itemId,
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "部分回答" },
          });
          yield* Deferred.succeed(historyResponse, {
            clientThreadId: threadId,
            conversationId: 13,
            truncated: false,
            messages: [
              {
                id: 130,
                conversationId: 13,
                role: "assistant",
                text: "完整最终回答",
                createdAt: "2026-08-10T00:00:02.000Z",
              },
            ],
          });
          yield* Fiber.join(historyFiber);
          yield* runtime.applyRuntimeEvent({
            ...eventBase,
            eventId: EventId.make("event-overlap-race-completed"),
            itemId,
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              data: {
                finalText: "完整最终回答",
                enterpriseConversationId: 13,
                enterpriseMessageId: 130,
              },
            },
          });
          const messages = (yield* runtime.getSnapshot(threadId)).messages;
          expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
          expect(messages).toMatchObject([{ text: "完整最终回答", streaming: false }]);
        }),
      ).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("rejects memory events from the account generation cleared at the boundary", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      const event = {
        eventId: EventId.make("fd-stale-generation"),
        provider: ProviderDriverKind.make("fd-deepseek"),
        threadId,
        createdAt: "2026-08-10T00:00:00.000Z",
        persistence: "memory-only" as const,
        volatileGeneration: runtime.getGeneration(),
        type: "content.delta" as const,
        itemId: RuntimeItemId.make("fd-stale-item"),
        payload: { streamKind: "assistant_text" as const, delta: "账号 A 的迟到回答" },
      } satisfies ProviderRuntimeEvent;
      yield* runtime.clearAll();
      yield* runtime.applyRuntimeEvent(event);
      expect((yield* runtime.getSnapshot(threadId)).messages).toEqual([]);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  effectIt.effect("reloads known thread history after an account boundary", () =>
    Effect.gen(function* () {
      const runtime = yield* FdEnterpriseThreadRuntime;
      yield* runtime.setHistoryLoader(async (clientThreadId) => ({
        clientThreadId,
        conversationId: 10,
        truncated: false,
        messages: [
          {
            id: 10,
            conversationId: 10,
            role: "assistant",
            text: "账号 B 的服务端历史",
            createdAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      }));
      yield* runtime.stageTurn({
        threadId,
        messageId: MessageId.make("message-account-b"),
        text: "账号 B 查询",
        createdAt: "2026-08-10T00:00:00.000Z",
      });
      yield* runtime.clearAll();
      const reset = yield* runtime.getSnapshot(threadId);
      yield* runtime.reloadAllHistory();
      const snapshot = yield* runtime.getSnapshot(threadId);
      expect(snapshot.revision).toBeGreaterThan(reset.revision);
      expect(snapshot.messages).toMatchObject([{ text: "账号 B 的服务端历史" }]);
    }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );
});
