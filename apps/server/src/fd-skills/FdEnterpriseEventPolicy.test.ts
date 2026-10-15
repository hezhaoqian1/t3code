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
  ["HTTP 429: Too many requests", "模型服务暂时繁忙（限流）。请稍后在当前任务中继续。"],
  [
    "Allocated quota exceeded, please increase your quota limit",
    "模型服务额度已达上限。请联系管理员检查上游额度，或切换可用模型后继续。",
  ],
  ["insufficient_quota", "模型服务额度已达上限。请联系管理员检查上游额度，或切换可用模型后继续。"],
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
