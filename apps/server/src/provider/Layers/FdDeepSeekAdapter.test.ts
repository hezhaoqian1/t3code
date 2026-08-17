import { describe, expect, it, vi } from "@effect/vitest";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { FD_RUNTIME_PRO_MODEL } from "@t3tools/contracts/fd/runtime-credentials";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

import {
  FdAgentKernel,
  type FdAgentTool,
  type FdResponsesStreamer,
} from "../../fd-agent/FdAgentKernel.ts";
import { FdResponsesError, type FdResponsesEvent } from "../../fd-agent/FdResponsesProtocol.ts";
import { NativeSkillCatalog } from "../../fd-skills/NativeSkillCatalog.ts";
import {
  FdEnterpriseAgentClient,
  FdEnterpriseAgentError,
  FdSkillCatalog,
  type FdEnterpriseAgentEvent,
} from "../../fd-skills/FdEnterpriseAgentClient.ts";
import {
  FD_DEEPSEEK_DRIVER_KIND,
  FD_DEEPSEEK_INSTANCE_ID,
  makeFdDeepSeekAdapter,
} from "./FdDeepSeekAdapter.ts";

const metadata: FdResponsesEvent = {
  type: "response-metadata",
  responseId: "response",
  model: "deepseek-v4-flash",
};

const completed: ReadonlyArray<FdResponsesEvent> = [
  metadata,
  { type: "text-delta", text: "Done" },
  { type: "completed", finishReason: "stop" },
];

const threadId = ThreadId.make("fd-thread");
const enterpriseTurnId = "550e8400-e29b-41d4-a716-446655440010";

function streamer(rounds: ReadonlyArray<ReadonlyArray<FdResponsesEvent>>): FdResponsesStreamer {
  let index = 0;
  return {
    stream: async function* () {
      for (const event of rounds[index++] ?? []) yield event;
    },
  };
}

const writeTool: FdAgentTool = {
  definition: {
    name: "write_file",
    description: "Write a file",
    parameters: { type: "object", properties: {} },
  },
  itemType: "file_change",
  approval: "permission-mode",
  execute: vi.fn(async () => ({ ok: true, value: { private: "result" } })),
};

const startInput = {
  provider: FD_DEEPSEEK_DRIVER_KIND,
  providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
  threadId,
  runtimeMode: "full-access" as const,
  modelSelection: {
    instanceId: FD_DEEPSEEK_INSTANCE_ID,
    model: "deepseek-v4-flash",
  },
};

const waitFor = (predicate: () => boolean) =>
  Effect.promise(() => vi.waitFor(() => expect(predicate()).toBe(true)));

const authorizedCatalog = {
  skills: [
    {
      id: 4,
      versionId: 10004,
      name: "company-database-query",
      displayName: "管理部数据查询",
      description: "查询企业数据",
      kind: "database",
      riskTier: "high",
    },
  ],
  modelCapabilities: {
    "deepseek-v4-flash": { fdSkills: true, protocol: "enterprise-agent-v1" },
  },
} as const;

const enterpriseClientWith = (
  streamTurn: FdEnterpriseAgentClient["streamTurn"],
): FdEnterpriseAgentClient =>
  ({
    getCatalog: async () => authorizedCatalog,
    streamTurn,
  }) as unknown as FdEnterpriseAgentClient;

describe("FdDeepSeekAdapter", () => {
  it.effect("does not expose enterprise history through the generic provider snapshot", () =>
    Effect.gen(function* () {
      const client: FdResponsesStreamer = {
        stream: async function* () {
          for (const event of completed) yield event;
        },
      };
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(client),
      });
      yield* adapter.startSession(startInput);
      const restored = yield* adapter.readThread(threadId);
      expect(restored.turns).toEqual([]);
      const turn = yield* adapter.sendTurn({ threadId, input: "本地问题" });
      yield* waitFor(() => turn.turnId !== undefined);
      expect(turn.turnId).toBeTruthy();
    }),
  );

  it.effect("runs the direct Responses lifecycle with the exact Pro model", () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const client: FdResponsesStreamer = {
        stream: async function* (request) {
          requests.push(request);
          yield { ...metadata, model: FD_RUNTIME_PRO_MODEL };
          yield { type: "text-delta", text: "Pro done" };
          yield { type: "completed", finishReason: "stop" };
        },
      };
      const adapter = yield* makeFdDeepSeekAdapter({ kernel: new FdAgentKernel(client) });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const proStartInput = {
        ...startInput,
        modelSelection: { ...startInput.modelSelection, model: FD_RUNTIME_PRO_MODEL },
      };

      const session = yield* adapter.startSession(proStartInput);
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Use Pro",
        modelSelection: proStartInput.modelSelection,
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(session.model).toBe(FD_RUNTIME_PRO_MODEL);
      expect(requests).toEqual([expect.objectContaining({ model: FD_RUNTIME_PRO_MODEL })]);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn.started",
          turnId: turn.turnId,
          payload: { model: FD_RUNTIME_PRO_MODEL },
        }),
      );
    }),
  );

  it.effect("rejects arbitrary models and direct Pro FD Skill execution", () =>
    Effect.gen(function* () {
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
      });
      const invalidStart = yield* adapter
        .startSession({
          ...startInput,
          modelSelection: { ...startInput.modelSelection, model: "other-model" },
        })
        .pipe(Effect.flip);
      expect(invalidStart).toMatchObject({
        issue: "Only FD-managed DeepSeek models are authorized.",
      });

      yield* adapter.startSession({
        ...startInput,
        modelSelection: { ...startInput.modelSelection, model: FD_RUNTIME_PRO_MODEL },
      });
      const invalidSkillTurn = yield* adapter
        .sendTurn({
          threadId,
          input: "Run enterprise skill",
          fdSkillVersionId: 10004,
          modelSelection: {
            instanceId: FD_DEEPSEEK_INSTANCE_ID,
            model: FD_RUNTIME_PRO_MODEL,
          },
        })
        .pipe(Effect.flip);
      expect(invalidSkillTurn).toMatchObject({
        issue: "This FD Skill runtime currently requires V4 Flash.",
      });
    }),
  );

  it.effect("routes an authorized FD Skill through Enterprise Agent exactly once", () =>
    Effect.gen(function* () {
      const localStream = vi.fn(async function* () {
        for (const event of completed) yield event;
      });
      const enterpriseEvents: ReadonlyArray<FdEnterpriseAgentEvent> = [
        {
          type: "turn.started",
          turnId: enterpriseTurnId,
          conversationId: 0,
          model: "deepseek-v4-flash",
        },
        { type: "assistant.reasoning", turnId: enterpriseTurnId, delta: "正在核对授权范围" },
        {
          type: "tool.started",
          turnId: enterpriseTurnId,
          callId: "call-1",
          tool: "db_query",
          toolClass: "data_read",
          label: "正在查询客户持仓",
        },
        {
          type: "tool.completed",
          turnId: enterpriseTurnId,
          callId: "call-1",
          tool: "db_query",
          toolClass: "data_read",
          status: "succeeded",
          auditId: "audit-1",
          rowCount: 6,
        },
        {
          type: "assistant.delta",
          turnId: enterpriseTurnId,
          delta: "总持仓金额为 6,966,525.37 元。",
        },
        {
          type: "turn.completed",
          turnId: enterpriseTurnId,
          message: {
            id: 1,
            conversationId: 0,
            role: "assistant",
            text: "总持仓金额为 6,966,525.37 元。",
            createdAt: "2026-08-10T00:00:00Z",
          },
          toolCalls: 1,
          usage: { inputTokens: 20, outputTokens: 12 },
        },
      ];
      const enterpriseClient = {
        getCatalog: async () => ({
          skills: [
            {
              id: 4,
              versionId: 10004,
              name: "company-database-query",
              displayName: "管理部数据查询",
              description: "查询企业数据",
              kind: "database",
              riskTier: "high",
            },
          ],
          modelCapabilities: {
            "deepseek-v4-flash": { fdSkills: true, protocol: "enterprise-agent-v1" },
          },
        }),
        streamTurn: async function* () {
          for (const event of enterpriseEvents) yield event;
        },
      } as unknown as FdEnterpriseAgentClient;
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel({ stream: localStream }),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440000");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "蔡梦晨客户的持仓存量",
        fdSkillVersionId: 10004,
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(localStream).not.toHaveBeenCalled();
      expect(
        events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      ).toHaveLength(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "reasoning_summary_text", delta: "正在核对授权范围" },
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({ detail: "audit audit-1", status: "completed" }),
        }),
      );
      expect(enterpriseEvents[0]?.type).toBe("turn.started");
    }),
  );

  it.effect("fails closed for a revoked or stale FD Skill version", () =>
    Effect.gen(function* () {
      const enterpriseStream = vi.fn(async function* (): AsyncGenerator<FdEnterpriseAgentEvent> {
        return;
      });
      const enterpriseClient = {
        streamTurn: enterpriseStream,
      } as unknown as FdEnterpriseAgentClient;
      const fdSkillCatalog = new FdSkillCatalog({
        getCatalog: async () => ({ skills: [], modelCapabilities: {} }),
      } as unknown as FdEnterpriseAgentClient);
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession(startInput);
      const turn = yield* adapter.sendTurn({ threadId, input: "查询", fdSkillVersionId: 99999 });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(enterpriseStream).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn.completed",
          payload: expect.objectContaining({ state: "failed" }),
        }),
      );
    }),
  );

  it.effect("reconciles an interrupted Enterprise turn with the same idempotency key", () =>
    Effect.gen(function* () {
      const calls: Array<{ idempotencyKey: string; signal: AbortSignal | undefined }> = [];
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const enterpriseClient = {
        getCatalog: async () => ({
          skills: [
            {
              id: 4,
              versionId: 10004,
              name: "company-database-query",
              displayName: "管理部数据查询",
              description: "查询企业数据",
              kind: "database",
              riskTier: "high",
            },
          ],
          modelCapabilities: {
            "deepseek-v4-flash": { fdSkills: true, protocol: "enterprise-agent-v1" },
          },
        }),
        streamTurn: async function* (input: {
          idempotencyKey: string;
          signal?: AbortSignal;
        }): AsyncGenerator<FdEnterpriseAgentEvent> {
          calls.push({ idempotencyKey: input.idempotencyKey, signal: input.signal });
          if (calls.length === 1) {
            yield {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            };
            yield {
              type: "assistant.delta",
              turnId: enterpriseTurnId,
              delta: "不会重复的片段",
            };
            firstStarted();
            await new Promise<void>((resolve, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            });
            return;
          }

          expect(input.signal?.aborted).toBe(false);
          yield {
            type: "turn.started",
            turnId: enterpriseTurnId,
            conversationId: 7,
            model: "deepseek-v4-flash",
            replayed: true,
          };
          yield {
            type: "assistant.delta",
            turnId: enterpriseTurnId,
            delta: "不会重复的片段",
          };
          yield {
            type: "turn.completed",
            turnId: enterpriseTurnId,
            message: {
              id: 9,
              conversationId: 7,
              role: "assistant",
              text: "权威最终回答",
              createdAt: "2026-08-10T00:00:00Z",
            },
            toolCalls: 0,
            usage: { inputTokens: 8, outputTokens: 4 },
            replayed: true,
          };
        },
      } as unknown as FdEnterpriseAgentClient;
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440001");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "查询客户持仓",
        fdSkillVersionId: 10004,
        idempotencyKey: "fd-command-accepted-1234567890",
      });
      yield* Effect.promise(() => started);
      yield* adapter.interruptTurn(enterpriseThreadId, turn.turnId);
      yield* waitFor(
        () =>
          events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId)
            .length === 1,
      );

      expect(calls).toHaveLength(2);
      expect(calls[0]?.idempotencyKey).toBe("fd-command-accepted-1234567890");
      expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
      expect(calls[0]?.signal?.aborted).toBe(true);
      expect(calls[1]?.signal).not.toBe(calls[0]?.signal);
      expect(
        events.filter(
          (event) => event.type === "content.delta" && event.payload.delta === "不会重复的片段",
        ),
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      ).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ state: "completed" }) }),
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({
          persistence: "memory-only",
          type: "item.completed",
          payload: expect.objectContaining({
            data: expect.objectContaining({
              finalText: "权威最终回答",
              enterpriseConversationId: 7,
              enterpriseMessageId: 9,
            }),
          }),
        }),
      );
      expect(
        events.filter(
          (event) =>
            event.type === "item.completed" &&
            event.itemId === RuntimeItemId.make(`${turn.turnId}:assistant`),
        ),
      ).toHaveLength(1);
    }),
  );

  it.effect("reconciles an ordinary uncertain disconnect with the same idempotency key", () =>
    Effect.gen(function* () {
      const keys: string[] = [];
      const enterpriseClient = enterpriseClientWith(async function* (input) {
        keys.push(input.idempotencyKey);
        yield {
          type: "turn.started",
          turnId: enterpriseTurnId,
          conversationId: 7,
          model: "deepseek-v4-flash",
          ...(keys.length > 1 ? { replayed: true } : {}),
        };
        if (keys.length === 1) {
          throw new FdEnterpriseAgentError("invalid_stream", 0);
        }
        yield {
          type: "turn.completed",
          turnId: enterpriseTurnId,
          message: {
            id: 9,
            conversationId: 7,
            role: "assistant",
            text: "权威恢复结果",
            createdAt: "2026-08-10T00:00:00Z",
          },
          toolCalls: 0,
          usage: { inputTokens: 8, outputTokens: 4 },
          replayed: true,
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440011");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "恢复查询",
        fdSkillVersionId: 10004,
        idempotencyKey: "fd-command-uncertain-1234567890",
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(keys).toEqual(["fd-command-uncertain-1234567890", "fd-command-uncertain-1234567890"]);
      expect(
        events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      ).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ state: "completed" }) }),
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({
          persistence: "memory-only",
          type: "item.completed",
          payload: expect.objectContaining({
            data: expect.objectContaining({ finalText: "权威恢复结果" }),
          }),
        }),
      );
    }),
  );

  it.effect("accepts an authoritative replay terminal state without replayed tool frames", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const enterpriseClient = enterpriseClientWith(async function* () {
        attempts += 1;
        yield {
          type: "turn.started",
          turnId: enterpriseTurnId,
          conversationId: 7,
          model: "deepseek-v4-flash",
          ...(attempts === 2 ? { replayed: true } : {}),
        };
        if (attempts === 1) {
          yield {
            type: "tool.started",
            turnId: enterpriseTurnId,
            callId: "call-replay-authoritative",
            tool: "fd_data_query",
            toolClass: "data_read",
            label: "正在查询客户持仓",
          };
          throw new FdEnterpriseAgentError("invalid_stream", 0);
        }
        yield {
          type: "turn.completed",
          turnId: enterpriseTurnId,
          message: {
            id: 12,
            conversationId: 7,
            role: "assistant",
            text: "服务端已完成的权威结果",
            createdAt: "2026-08-10T00:00:00Z",
          },
          toolCalls: 1,
          usage: { inputTokens: 4, outputTokens: 3 },
          replayed: true,
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440014");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "查询客户持仓",
        fdSkillVersionId: 10004,
        idempotencyKey: "fd-command-authoritative-replay-123456",
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(attempts).toBe(2);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          itemId: expect.stringContaining("call-replay-authoritative"),
          payload: expect.objectContaining({ status: "completed", title: "企业查询已恢复" }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({
            data: expect.objectContaining({ finalText: "服务端已完成的权威结果" }),
          }),
        }),
      );
    }),
  );

  it.effect("closes first-attempt tool activity when reconciliation fails before start", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const enterpriseClient = enterpriseClientWith(async function* (input) {
        attempts += 1;
        if (attempts === 1) {
          yield {
            type: "turn.started",
            turnId: enterpriseTurnId,
            conversationId: 7,
            model: "deepseek-v4-flash",
          };
          yield {
            type: "tool.started",
            turnId: enterpriseTurnId,
            callId: "call-before-disconnect",
            tool: "fd_resource_list",
            toolClass: "capability",
            label: "正在读取可用范围",
          };
          throw new FdEnterpriseAgentError("invalid_stream", 0);
        }
        yield {
          type: "turn.failed",
          turnId: input.idempotencyKey,
          code: "agent_request_invalid",
          message: "请求未通过校验。",
          retryable: false,
          userMessagePersisted: true,
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440013");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "恢复失败",
        fdSkillVersionId: 10004,
        idempotencyKey: "fd-command-replay-failed-123456",
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      const started = events.find(
        (event) => event.type === "item.started" && event.payload.itemType === "dynamic_tool_call",
      );
      expect(started?.itemId).toBeDefined();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          itemId: started?.itemId,
          payload: expect.objectContaining({ status: "failed" }),
        }),
      );
      expect(attempts).toBe(2);
    }),
  );

  it.effect("accepts the documented pre-start failure keyed by the idempotency key", () =>
    Effect.gen(function* () {
      const enterpriseClient = enterpriseClientWith(async function* (input) {
        yield {
          type: "turn.failed",
          turnId: input.idempotencyKey,
          code: "agent_request_invalid",
          message: "请求未通过校验。",
          retryable: false,
          userMessagePersisted: false,
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const enterpriseThreadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440012");
      yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
      const turn = yield* adapter.sendTurn({
        threadId: enterpriseThreadId,
        input: "无效请求",
        fdSkillVersionId: 10004,
        idempotencyKey: "fd-command-prestart-1234567890",
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );
      expect(
        events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      ).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ state: "failed" }) }),
      ]);
    }),
  );

  it.effect("enforces data-read audit grounding without blocking ordinary zero-tool turns", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        name: string;
        input: string;
        events: ReadonlyArray<FdEnterpriseAgentEvent>;
        state: "completed" | "failed";
        finalText?: string;
      }> = [
        {
          name: "denied View",
          input: "查询未授权的 View",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-denied-view",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在核验授权 View",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-denied-view",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "failed",
            },
            {
              type: "turn.failed",
              turnId: enterpriseTurnId,
              code: "tool_resource_not_allowed",
              message: "查询未通过数据权限校验。",
              retryable: false,
              userMessagePersisted: true,
            },
          ],
          state: "failed",
        },
        {
          name: "missing audit",
          input: "查询蔡梦辰持仓",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-missing-audit",
              tool: "fd_holdings_get_latest",
              toolClass: "data_read",
              label: "正在查询持仓",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-missing-audit",
              tool: "fd_holdings_get_latest",
              toolClass: "data_read",
              status: "succeeded",
              rowCount: 1,
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 1,
                conversationId: 7,
                role: "assistant",
                text: "不应接受的数据结论",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 1,
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          state: "failed",
        },
        {
          name: "failed data read",
          input: "查询失败后仍给出结论",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-failed-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在查询企业数据",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-failed-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "failed",
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 2,
                conversationId: 7,
                role: "assistant",
                text: "不应从失败查询得出结论",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 1,
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          state: "failed",
        },
        {
          name: "one unaudited successful read among multiple reads",
          input: "合并两次企业查询",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-audited-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在执行第一项查询",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-audited-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "succeeded",
              auditId: "audit-first-read",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-unaudited-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在执行第二项查询",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-unaudited-read",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "succeeded",
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 21,
                conversationId: 7,
                role: "assistant",
                text: "不应接受部分审计的数据结论",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 2,
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          state: "failed",
        },
        {
          name: "retrying correction with a new audited call",
          input: "纠正查询后重试",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-invalid-query",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在执行原始查询",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-invalid-query",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "failed",
              retrying: true,
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-corrected-query",
              tool: "fd_data_query",
              toolClass: "data_read",
              label: "正在执行纠正后的查询",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-corrected-query",
              tool: "fd_data_query",
              toolClass: "data_read",
              status: "succeeded",
              auditId: "audit-corrected-query",
              rowCount: 1,
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 22,
                conversationId: 7,
                role: "assistant",
                text: "纠正后的权威结果",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 2,
              usage: { inputTokens: 2, outputTokens: 1 },
            },
          ],
          state: "completed",
          finalText: "纠正后的权威结果",
        },
        {
          name: "audited zero rows and typo",
          input: "查询蔡梦辰持仓",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-zero-rows",
              tool: "fd_holdings_get_latest",
              toolClass: "data_read",
              label: "正在查询持仓",
            },
            {
              type: "tool.completed",
              turnId: enterpriseTurnId,
              callId: "call-zero-rows",
              tool: "fd_holdings_get_latest",
              toolClass: "data_read",
              status: "succeeded",
              auditId: "audit-zero-rows",
              rowCount: 0,
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 3,
                conversationId: 7,
                role: "assistant",
                text: "未找到蔡梦辰的持仓记录，请核对姓名是否为蔡梦晨。",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 1,
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          state: "completed",
          finalText: "未找到蔡梦辰的持仓记录，请核对姓名是否为蔡梦晨。",
        },
        {
          name: "stale running capability tool",
          input: "能力说明",
          events: [
            {
              type: "turn.started",
              turnId: enterpriseTurnId,
              conversationId: 7,
              model: "deepseek-v4-flash",
            },
            {
              type: "tool.started",
              turnId: enterpriseTurnId,
              callId: "call-stale-capability",
              tool: "fd_resource_list",
              toolClass: "capability",
              label: "正在读取可用范围",
            },
            {
              type: "turn.completed",
              turnId: enterpriseTurnId,
              message: {
                id: 20,
                conversationId: 7,
                role: "assistant",
                text: "不应在工具仍运行时完成",
                createdAt: "2026-08-10T00:00:00Z",
              },
              toolCalls: 1,
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          state: "failed",
        },
        ...["你好", "你能做什么"].map(
          (
            input,
            index,
          ): {
            name: string;
            input: string;
            events: ReadonlyArray<FdEnterpriseAgentEvent>;
            state: "completed";
            finalText: string;
          } => ({
            name: `zero-tool ${input}`,
            input,
            events: [
              {
                type: "turn.started",
                turnId: enterpriseTurnId,
                conversationId: 7,
                model: "deepseek-v4-flash",
              },
              {
                type: "turn.completed",
                turnId: enterpriseTurnId,
                message: {
                  id: 10 + index,
                  conversationId: 7,
                  role: "assistant",
                  text:
                    input === "你好" ? "你好，有什么可以帮你？" : "我可以说明已授权的数据范围。",
                  createdAt: "2026-08-10T00:00:00Z",
                },
                toolCalls: 0,
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ],
            state: "completed",
            finalText: input === "你好" ? "你好，有什么可以帮你？" : "我可以说明已授权的数据范围。",
          }),
        ),
      ];

      for (const [index, testCase] of cases.entries()) {
        const enterpriseClient = enterpriseClientWith(async function* () {
          for (const event of testCase.events) yield event;
        });
        const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
        yield* Effect.promise(() => fdSkillCatalog.refresh());
        const adapter = yield* makeFdDeepSeekAdapter({
          kernel: new FdAgentKernel(streamer([completed])),
          fdSkillCatalog,
          enterpriseClient,
        });
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        const enterpriseThreadId = ThreadId.make(
          `550e8400-e29b-41d4-a716-${String(440020 + index).padStart(12, "0")}`,
        );
        yield* adapter.startSession({ ...startInput, threadId: enterpriseThreadId });
        const turn = yield* adapter.sendTurn({
          threadId: enterpriseThreadId,
          input: testCase.input,
          fdSkillVersionId: 10004,
        });
        yield* waitFor(() =>
          events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
        );
        expect(
          events.find((event) => event.type === "turn.completed" && event.turnId === turn.turnId)
            ?.payload,
          testCase.name,
        ).toMatchObject({ state: testCase.state });
        if (testCase.finalText) {
          expect(events, testCase.name).toContainEqual(
            expect.objectContaining({
              persistence: "memory-only",
              type: "item.completed",
              payload: expect.objectContaining({
                data: expect.objectContaining({ finalText: testCase.finalText }),
              }),
            }),
          );
        }
      }
    }),
  );

  it.effect("loads a selected local Skill as instructions without adding tools", () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const client: FdResponsesStreamer = {
        stream: async function* (request) {
          requests.push(request);
          for (const event of completed) yield event;
        },
      };
      const skillCatalog = {
        loadSelected: vi.fn(async () => [
          "---\nname: local\ndescription: local\n---\nlocal instructions",
        ]),
      } as unknown as NativeSkillCatalog;
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(client),
        nativeSkillCatalogForSession: async () => skillCatalog,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession(startInput);
      const turn = yield* adapter.sendTurn({ threadId, input: "$local do this" });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );

      expect(skillCatalog.loadSelected).toHaveBeenCalledWith(["local"]);
      expect(requests[0]).toMatchObject({
        instructions: expect.stringContaining("local instructions"),
      });
      expect(requests[0]).not.toHaveProperty("tools");
    }),
  );

  it.effect("runs a session, settles once, and supports private-history rollback", () =>
    Effect.gen(function* () {
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed, completed])),
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession(startInput);
      expect(session.model).toBe("deepseek-v4-flash");
      const first = yield* adapter.sendTurn({ threadId, input: "first" });
      yield* waitFor(
        () =>
          events.filter((event) => event.type === "turn.completed" && event.turnId === first.turnId)
            .length === 1,
      );
      const second = yield* adapter.sendTurn({ threadId, input: "second" });
      yield* waitFor(
        () =>
          events.filter(
            (event) => event.type === "turn.completed" && event.turnId === second.turnId,
          ).length === 1,
      );

      expect((yield* adapter.readThread(threadId)).turns).toHaveLength(2);
      expect((yield* adapter.rollbackThread(threadId, 1)).turns).toHaveLength(1);
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(2);
    }),
  );

  it.effect("allows an enterprise turn after an ordinary turn in one conversation", () =>
    Effect.gen(function* () {
      const enterpriseClient = enterpriseClientWith(async function* () {
        yield {
          type: "turn.started",
          turnId: enterpriseTurnId,
          conversationId: 7,
          model: "deepseek-v4-flash",
        };
        yield {
          type: "turn.completed",
          turnId: enterpriseTurnId,
          message: {
            id: 8,
            conversationId: 7,
            role: "assistant",
            text: "Enterprise completed",
            createdAt: "2026-08-11T00:00:00Z",
          },
          toolCalls: 0,
          usage: { inputTokens: 3, outputTokens: 2 },
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([completed])),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession(startInput);
      const first = yield* adapter.sendTurn({ threadId, input: "ordinary work" });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === first.turnId),
      );

      const second = yield* adapter.sendTurn({
        threadId,
        input: "enterprise work",
        fdSkillVersionId: 10004,
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === second.turnId),
      );
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(2);
    }),
  );

  it.effect("allows an ordinary turn after an enterprise turn in one conversation", () =>
    Effect.gen(function* () {
      const localStream = vi.fn(async function* () {
        for (const event of completed) yield event;
      });
      const enterpriseClient = enterpriseClientWith(async function* () {
        yield {
          type: "turn.started",
          turnId: enterpriseTurnId,
          conversationId: 7,
          model: "deepseek-v4-flash",
        };
        yield {
          type: "assistant.delta",
          turnId: enterpriseTurnId,
          delta: "Enterprise completed",
        };
        yield {
          type: "turn.completed",
          turnId: enterpriseTurnId,
          message: {
            id: 8,
            conversationId: 7,
            role: "assistant",
            text: "Enterprise completed",
            createdAt: "2026-08-11T00:00:00Z",
          },
          toolCalls: 0,
          usage: { inputTokens: 3, outputTokens: 2 },
        };
      });
      const fdSkillCatalog = new FdSkillCatalog(enterpriseClient);
      yield* Effect.promise(() => fdSkillCatalog.refresh());
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel({ stream: localStream }),
        fdSkillCatalog,
        enterpriseClient,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession(startInput);
      const first = yield* adapter.sendTurn({
        threadId,
        input: "enterprise work",
        fdSkillVersionId: 10004,
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === first.turnId),
      );

      const second = yield* adapter.sendTurn({ threadId, input: "ordinary work" });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === second.turnId),
      );
      expect(localStream).toHaveBeenCalledOnce();
    }),
  );

  it.effect("restarts Codex with isolated runtime profiles when FD Skill selection changes", () =>
    Effect.gen(function* () {
      const codexProvider = ProviderDriverKind.make("codex");
      const startedInputs: Array<Record<string, unknown>> = [];
      const sentInputs: Array<Record<string, unknown>> = [];
      const stopSession = vi.fn(() => Effect.void);
      let sessionIndex = 0;
      const ordinaryAdapter: ProviderAdapterShape<never> = {
        provider: codexProvider,
        capabilities: { sessionModelSwitch: "in-session" },
        startSession: (input) => {
          startedInputs.push(input);
          sessionIndex += 1;
          return Effect.succeed({
            provider: codexProvider,
            providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
            status: "ready" as const,
            runtimeMode: input.runtimeMode,
            model: "deepseek-v4-flash",
            threadId: input.threadId,
            resumeCursor: { threadId: `codex-profile-${sessionIndex}` },
            createdAt: "2026-08-11T00:00:00.000Z",
            updatedAt: "2026-08-11T00:00:00.000Z",
          });
        },
        sendTurn: (input) => {
          sentInputs.push(input);
          return Effect.succeed({
            threadId: input.threadId,
            turnId: TurnId.make(`codex-turn-${sentInputs.length}`),
            resumeCursor: { threadId: `codex-profile-${sessionIndex}` },
          });
        },
        interruptTurn: () => Effect.void,
        respondToRequest: () => Effect.void,
        respondToUserInput: () => Effect.void,
        stopSession,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(false),
        readThread: (requestedThreadId) =>
          Effect.succeed({ threadId: requestedThreadId, turns: [] }),
        rollbackThread: (requestedThreadId) =>
          Effect.succeed({ threadId: requestedThreadId, turns: [] }),
        stopAll: () => Effect.void,
        streamEvents: Stream.empty,
      };
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(streamer([])),
        ordinaryAdapter,
      });

      yield* adapter.startSession(startInput);
      yield* adapter.sendTurn({ threadId, input: "ordinary question" });
      yield* adapter.sendTurn({
        threadId,
        input: "enterprise question",
        fdSkillVersionId: 10004,
      });
      yield* adapter.sendTurn({ threadId, input: "web search" });

      expect(startedInputs).toHaveLength(3);
      expect(startedInputs[0]).not.toHaveProperty("fdSkillVersionId");
      expect(startedInputs[1]).toMatchObject({ fdSkillVersionId: 10004 });
      expect(startedInputs[1]).not.toHaveProperty("resumeCursor");
      expect(startedInputs[2]).toMatchObject({
        resumeCursor: { threadId: "codex-profile-1" },
      });
      expect(startedInputs[2]).not.toHaveProperty("fdSkillVersionId");
      expect(sentInputs).toHaveLength(3);
      expect(stopSession).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect(
    "routes ordinary turns through Codex and reprojects them as the hidden FD provider",
    () =>
      Effect.gen(function* () {
        const codexProvider = ProviderDriverKind.make("codex");
        const codexTurnId = TurnId.make("codex-turn");
        const startedInputs: unknown[] = [];
        const sentInputs: unknown[] = [];
        const interruptTurn = vi.fn(() => Effect.void);
        const respondToRequest = vi.fn(() => Effect.void);
        const respondToUserInput = vi.fn(() => Effect.void);
        const stopSession = vi.fn(() => Effect.void);
        const ordinaryAdapter: ProviderAdapterShape<never> = {
          provider: codexProvider,
          capabilities: { sessionModelSwitch: "in-session" },
          startSession: (input) => {
            startedInputs.push(input);
            return Effect.succeed({
              provider: codexProvider,
              providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
              status: "ready" as const,
              runtimeMode: input.runtimeMode,
              ...(input.cwd ? { cwd: input.cwd } : {}),
              model: "deepseek-v4-flash",
              threadId: input.threadId,
              resumeCursor: { threadId: "codex-provider-thread" },
              createdAt: "2026-08-11T00:00:00.000Z",
              updatedAt: "2026-08-11T00:00:00.000Z",
            });
          },
          sendTurn: (input) => {
            sentInputs.push(input);
            return Effect.succeed({
              threadId: input.threadId,
              turnId: codexTurnId,
              resumeCursor: { threadId: "codex-provider-thread" },
            });
          },
          interruptTurn,
          respondToRequest,
          respondToUserInput,
          stopSession,
          listSessions: () => Effect.succeed([]),
          hasSession: () => Effect.succeed(false),
          readThread: (requestedThreadId) =>
            Effect.succeed({ threadId: requestedThreadId, turns: [] }),
          rollbackThread: (requestedThreadId) =>
            Effect.succeed({ threadId: requestedThreadId, turns: [] }),
          stopAll: () => Effect.void,
          streamEvents: Stream.make(
            {
              eventId: EventId.make("codex-session-started"),
              provider: codexProvider,
              providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
              threadId,
              createdAt: "2026-08-11T00:00:00.000Z",
              type: "session.started" as const,
              payload: { resume: { threadId: "codex-provider-thread" } },
            },
            {
              eventId: EventId.make("codex-event"),
              provider: codexProvider,
              providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
              threadId,
              turnId: codexTurnId,
              createdAt: "2026-08-11T00:00:00.000Z",
              type: "turn.started" as const,
              payload: { model: "deepseek-v4-flash" },
            },
          ),
        };
        const adapter = yield* makeFdDeepSeekAdapter({
          kernel: new FdAgentKernel({
            stream: async function* () {
              throw new Error("transitional kernel must not run");
            },
          }),
          ordinaryAdapter,
          ordinarySessionInput: (input) =>
            Effect.succeed({ ...input, runtimeMode: "approval-required" as const }),
        });
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession(startInput);
        const turn = yield* adapter.sendTurn({
          threadId,
          input: "$local summarize",
          modelSelection: {
            instanceId: FD_DEEPSEEK_INSTANCE_ID,
            model: FD_RUNTIME_PRO_MODEL,
          },
        });
        yield* waitFor(() => events.some((event) => event.eventId === "codex-event"));

        yield* adapter.sendTurn({
          threadId,
          input: "$local continue",
          modelSelection: startInput.modelSelection,
        });

        expect(turn.turnId).toBe(codexTurnId);
        expect(turn.resumeCursor).toEqual({ threadId: "codex-provider-thread" });
        expect(sentInputs).toEqual([
          expect.objectContaining({
            modelSelection: expect.objectContaining({ model: FD_RUNTIME_PRO_MODEL }),
          }),
          expect.objectContaining({
            modelSelection: expect.objectContaining({ model: "deepseek-v4-flash" }),
          }),
        ]);
        expect((yield* adapter.listSessions())[0]?.model).toBe("deepseek-v4-flash");
        expect(startedInputs).toHaveLength(1);
        expect(startedInputs[0]).toMatchObject({ runtimeMode: "approval-required" });
        expect(sentInputs).toHaveLength(2);
        expect(sentInputs[0]).toMatchObject({ input: "$local summarize" });
        expect(sentInputs[1]).toMatchObject({ input: "$local continue" });
        expect(events.find((event) => event.eventId === "codex-event")).toMatchObject({
          provider: FD_DEEPSEEK_DRIVER_KIND,
          providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
          type: "turn.started",
        });
        expect(events.find((event) => event.eventId === "codex-session-started")).toMatchObject({
          provider: FD_DEEPSEEK_DRIVER_KIND,
          providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
          type: "session.started",
          payload: { resume: { threadId: "codex-provider-thread" } },
        });
        expect(events.filter((event) => event.type === "content.delta")).toHaveLength(0);

        const requestId = ApprovalRequestId.make("codex-request");
        const answers = { question: ["continue"] };
        yield* adapter.respondToRequest(threadId, requestId, "accept");
        yield* adapter.respondToUserInput(threadId, requestId, answers);
        yield* adapter.interruptTurn(threadId, codexTurnId);
        expect(respondToRequest).toHaveBeenCalledWith(threadId, requestId, "accept");
        expect(respondToUserInput).toHaveBeenCalledWith(threadId, requestId, answers);
        expect(interruptTurn).toHaveBeenCalledWith(threadId, codexTurnId);

        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          ...startInput,
          resumeCursor: turn.resumeCursor,
        });
        yield* adapter.sendTurn({ threadId, input: "continue" });
        expect(startedInputs).toHaveLength(2);
        expect(startedInputs[1]).toMatchObject({
          resumeCursor: { threadId: "codex-provider-thread" },
          runtimeMode: "approval-required",
        });
        expect(stopSession).toHaveBeenCalledWith(threadId);

        yield* adapter.stopSession(threadId);
        yield* adapter.startSession(startInput);
        yield* adapter.sendTurn({
          threadId,
          input: "enterprise query",
          fdSkillVersionId: 10004,
        });
        expect(startedInputs).toHaveLength(3);
        expect(startedInputs[2]).toMatchObject({
          runtimeMode: "approval-required",
          fdSkillVersionId: 10004,
        });
        expect(sentInputs[3]).toMatchObject({
          input: "enterprise query",
          fdSkillVersionId: 10004,
        });
      }),
  );

  it.effect("routes approval through canonical request events without private tool data", () =>
    Effect.gen(function* () {
      vi.clearAllMocks();
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(
          streamer([
            [
              metadata,
              {
                type: "output-item",
                item: {
                  type: "function_call",
                  call_id: "call",
                  name: "write_file",
                  arguments: '{"contents":"private"}',
                },
              },
              {
                type: "function-call",
                callId: "call",
                name: "write_file",
                argumentsJson: '{"contents":"private"}',
                arguments: { valid: true, value: { contents: "private" } },
              },
              { type: "completed", finishReason: "tool-calls" },
            ],
            completed,
          ]),
        ),
        toolsForSession: () => Effect.succeed([writeTool]),
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({ ...startInput, runtimeMode: "approval-required" });
      const turn = yield* adapter.sendTurn({ threadId, input: "edit" });
      yield* waitFor(() => events.some((event) => event.type === "request.opened"));

      const opened = events.find((event) => event.type === "request.opened");
      expect(opened).toMatchObject({
        type: "request.opened",
        payload: { requestType: "file_change_approval", detail: "write_file" },
      });
      expect(opened?.type === "request.opened" && "args" in opened.payload).toBe(false);
      expect(writeTool.execute).not.toHaveBeenCalled();
      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make(opened!.requestId!),
        "accept",
      );
      yield* waitFor(
        () =>
          events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId)
            .length === 1,
      );
      expect(writeTool.execute).toHaveBeenCalledTimes(1);
      expect(events.some((event) => event.type === "request.resolved")).toBe(true);
      expect(
        events.some(
          (event) =>
            (event.type === "item.started" || event.type === "item.completed") &&
            "data" in event.payload,
        ),
      ).toBe(false);
    }),
  );

  it.effect("forwards text+image and image-only turns as bounded multimodal user input", () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const client: FdResponsesStreamer = {
        stream: async function* (request) {
          requests.push(request);
          for (const event of completed) yield event;
        },
      };
      const resolveAttachments = vi.fn(() =>
        Effect.succeed([{ type: "input_image" as const, image_url: "data:image/png;base64,cG5n" }]),
      );
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(client),
        resolveAttachments,
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession(startInput);
      const attachment = {
        type: "image" as const,
        id: "fd-thread-12345678-1234-1234-1234-123456789abc",
        name: "private.png",
        mimeType: "image/png",
        sizeBytes: 3,
      };

      const textTurn = yield* adapter.sendTurn({
        threadId,
        input: "inspect",
        attachments: [attachment],
      });
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === textTurn.turnId),
      );
      const imageTurn = yield* adapter.sendTurn({ threadId, attachments: [attachment] });
      yield* waitFor(() =>
        events.some(
          (event) => event.type === "turn.completed" && event.turnId === imageTurn.turnId,
        ),
      );

      expect(resolveAttachments).toHaveBeenCalledTimes(2);
      expect(resolveAttachments).toHaveBeenCalledWith([attachment]);
      expect(requests[0]).toMatchObject({
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "inspect" },
              { type: "input_image", image_url: "data:image/png;base64,cG5n" },
            ],
          },
        ],
      });
      expect(requests[1]).toMatchObject({
        input: expect.arrayContaining([
          {
            role: "user",
            content: [{ type: "input_image", image_url: "data:image/png;base64,cG5n" }],
          },
        ]),
      });
      expect(requests[0]).not.toHaveProperty("attachments");
      expect(requests[1]).not.toHaveProperty("attachments");
    }),
  );

  it.effect("interrupts once and ignores a late successful terminal event", () =>
    Effect.gen(function* () {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const client: FdResponsesStreamer = {
        stream: async function* () {
          yield metadata;
          yield { type: "text-delta", text: "before" };
          await gate;
          yield { type: "text-delta", text: "late" };
          yield { type: "completed", finishReason: "stop" };
        },
      };
      const adapter = yield* makeFdDeepSeekAdapter({ kernel: new FdAgentKernel(client) });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession(startInput);
      const turn = yield* adapter.sendTurn({ threadId, input: "wait" });
      yield* waitFor(() => events.some((event) => event.type === "content.delta"));
      yield* adapter.interruptTurn(threadId, turn.turnId);
      release();
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const terminal = events.filter(
        (event) => event.type === "turn.completed" && event.turnId === turn.turnId,
      );
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({ payload: { state: "interrupted" } });
      expect(
        events.some((event) => event.type === "content.delta" && event.payload.delta === "late"),
      ).toBe(false);
    }),
  );

  it.effect("settles credential invalidation, timeout, and malformed transport once", () =>
    Effect.gen(function* () {
      for (const kind of ["credentials_invalidated", "timeout", "malformed_response"] as const) {
        const client: FdResponsesStreamer = {
          stream: async function* () {
            throw new FdResponsesError(kind);
          },
        };
        const localThreadId = ThreadId.make(`fd-${kind}`);
        const adapter = yield* makeFdDeepSeekAdapter({ kernel: new FdAgentKernel(client) });
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* adapter.startSession({ ...startInput, threadId: localThreadId });
        const turn = yield* adapter.sendTurn({ threadId: localThreadId, input: "run" });
        yield* waitFor(
          () =>
            events.filter(
              (event) => event.type === "turn.completed" && event.turnId === turn.turnId,
            ).length === 1,
        );
        expect(
          events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
        ).toHaveLength(1);
        expect(events.filter((event) => event.type === "runtime.error")).toHaveLength(1);
      }
    }),
  );

  it.effect("stopping an active session cannot double-settle its turn", () =>
    Effect.gen(function* () {
      const client: FdResponsesStreamer = {
        stream: async function* () {
          yield metadata;
          await new Promise<void>(() => undefined);
        },
      };
      const adapter = yield* makeFdDeepSeekAdapter({ kernel: new FdAgentKernel(client) });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession(startInput);
      const turn = yield* adapter.sendTurn({ threadId, input: "run" });
      yield* adapter.stopSession(threadId);
      yield* waitFor(() =>
        events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      );
      expect(
        events.filter((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
      ).toHaveLength(1);
      expect(yield* adapter.hasSession(threadId)).toBe(false);
    }),
  );
});
