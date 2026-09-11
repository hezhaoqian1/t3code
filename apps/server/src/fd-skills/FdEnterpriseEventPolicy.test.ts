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
