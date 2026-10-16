import { EventId, ProviderDriverKind, RuntimeItemId, ThreadId, TurnId } from "@t3tools/contracts";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { projectFdEnterpriseEvent } from "./FdEnterpriseEventPolicy.ts";
import {
  FdEnterpriseThreadRuntime,
  FdEnterpriseThreadRuntimeLive,
} from "./FdEnterpriseThreadRuntime.ts";

const base = {
  eventId: EventId.make("event"),
  provider: ProviderDriverKind.make("fd-deepseek"),
  threadId: ThreadId.make("thread"),
  turnId: TurnId.make("turn"),
  itemId: RuntimeItemId.make("item"),
  createdAt: "2026-09-11T00:00:00.000Z",
};

it.each([
  '503 {"code":"model_not_found","message":"secret"}',
  "当前分组下对于模型 qwen3.8-max 无可用渠道 secret",
  "No available channel for model secret",
  "当前模型已不可用，请切换 Flash 重试。",
])("explains unavailable models without exposing provider details: %s", (errorMessage) => {
  const event = projectFdEnterpriseEvent(
    {
      ...base,
      type: "turn.completed",
      payload: { state: "failed", errorMessage },
    },
    0,
  );
  expect(event.payload).toEqual({
    state: "failed",
    errorMessage: "当前模型已不可用，请切换 Flash 重试。",
  });
});

it.each([
  ["HTTP 429: Too many requests", "模型服务暂时繁忙（限流）。请稍后在当前任务中继续。"],
  [
    "Allocated quota exceeded, please increase your quota limit",
    "模型服务触发 Token 吞吐限流。请等待约一分钟后在当前任务中继续；频繁发生时请联系管理员调整调用速率。",
  ],
  [
    "Throttling.AllocationQuota",
    "模型服务触发 Token 吞吐限流。请等待约一分钟后在当前任务中继续；频繁发生时请联系管理员调整调用速率。",
  ],
  ["insufficient_quota", "模型服务配额或调用速率已达上限。请联系管理员确认具体限制后继续。"],
  [
    "403 insufficient_user_quota",
    "你的 FD 个人可用额度不足以继续此任务。请联系管理员调整 FD 额度后继续。",
  ],
  [
    "预扣费额度失败, 用户剩余额度: private",
    "你的 FD 个人可用额度不足以继续此任务。请联系管理员调整 FD 额度后继续。",
  ],
  ["用户额度不足", "你的 FD 个人可用额度不足以继续此任务。请联系管理员调整 FD 额度后继续。"],
  [
    "429 BudgetLimitExceeded insufficient_quota",
    "模型服务的账务或预算限制阻止了调用。请联系管理员检查上游账户设置后继续。",
  ],
  ["429 Arrearage", "模型服务的账务或预算限制阻止了调用。请联系管理员检查上游账户设置后继续。"],
  [
    "Free allocated quota exceeded",
    "模型服务配额或调用速率已达上限。请联系管理员确认具体限制后继续。",
  ],
  [
    "hour allocated quota exceeded",
    "模型服务配额或调用速率已达上限。请联系管理员确认具体限制后继续。",
  ],
  ["429 Throttling.RateQuota", "模型服务暂时繁忙（限流）。请稍后在当前任务中继续。"],
  ["context window exceeded", "当前任务内容超出模型上下文上限。请压缩上下文，或新建任务后继续。"],
  ["stream disconnected before completion", "模型连接中断。请稍后在当前任务中继续。"],
  ["request timed out", "模型响应超时。请稍后在当前任务中继续。"],
  [
    "private SQL SELECT * FROM clients; token=secret",
    "FD 技能执行失败。请重试；若仍失败，请联系管理员并提供任务名称和报错时间。",
  ],
])("explains enterprise failure without persisting raw details: %s", (errorMessage, expected) => {
  const event = projectFdEnterpriseEvent(
    {
      ...base,
      type: "turn.completed",
      payload: { state: "failed", errorMessage },
    },
    0,
  );
  expect(event.payload).toEqual({ state: "failed", errorMessage: expected });
  expect(JSON.stringify(event)).not.toContain("secret");
});

it("does not add an error to a successful enterprise turn", () => {
  expect(
    projectFdEnterpriseEvent(
      {
        ...base,
        type: "turn.completed",
        payload: { state: "completed" },
      },
      0,
    ).payload,
  ).toEqual({ state: "completed" });
});

it.effect("persists a Codex final answer through the existing T3 durable-message path", () =>
  Effect.gen(function* () {
    const runtime = yield* FdEnterpriseThreadRuntime;
    const event = projectFdEnterpriseEvent(
      {
        ...base,
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          data: {
            item: { type: "agentMessage", text: "394 candidates", phase: "final_answer" },
            internal: "must-not-be-persisted",
          },
        },
      },
      0,
    );
    const message = yield* runtime.applyRuntimeEvent(event);
    expect(message).toMatchObject({ text: "394 candidates", turnId: base.turnId });
    expect(event.type === "item.completed" && event.payload.data).toEqual({
      finalText: "394 candidates",
    });
  }).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
);

it("keeps reasoning, tool results and commentary out of durable history", () => {
  for (const itemType of ["reasoning", "dynamic_tool_call", "assistant_message"] as const) {
    const result = projectFdEnterpriseEvent(
      {
        ...base,
        type: "item.completed",
        payload: {
          itemType,
          data: { item: { type: "agentMessage", text: "private", phase: "commentary" } },
        },
      },
      7,
    );
    expect(result.persistence).toBe("memory-only");
    expect(result.volatileGeneration).toBe(7);
    expect(result.type === "item.completed" && result.payload.data).not.toHaveProperty("finalText");
  }
});

it("preserves approval identity without storing enterprise arguments", () => {
  const event = projectFdEnterpriseEvent(
    {
      ...base,
      type: "request.opened",
      payload: {
        requestType: "dynamic_tool_call",
        args: { credential: "private" },
        detail: "private",
      },
    },
    0,
  );
  expect(event.persistence).toBeUndefined();
  expect(event.payload).toEqual({ requestType: "dynamic_tool_call" });
});
