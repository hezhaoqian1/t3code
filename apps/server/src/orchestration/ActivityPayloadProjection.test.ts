import { describe, expect, it } from "vite-plus/test";
import {
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
  ThreadId,
} from "@t3tools/contracts";
import {
  projectActivityEvent,
  projectActivityPayload,
  projectReasoningMessageEvent,
  projectReasoningOverlay,
  projectThreadDetailSnapshot,
} from "./ActivityPayloadProjection.ts";

function activity(payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id: "activity-1",
    tone: "tool",
    kind: "tool.completed",
    summary: "Tool",
    payload,
    turnId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
}

/**
 * Wire-survival regression: the slimming pass rewrites payload.data but must
 * never strip the top-level per-agent fields the subagent fold depends on.
 * If slimming ever moves to an allowlist over the whole payload, these
 * assertions are the tripwire.
 */
describe("projectActivityPayload agent-field survival", () => {
  it("preserves tool attribution (agentId/parentToolUseId) through data slimming", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        agentId: "task-123",
        parentToolUseId: "toolu_abc",
        data: {
          toolName: "Bash",
          input: { command: "ls" },
          command: "ls",
          rawOutput: { content: "x".repeat(10) },
          somethingClientNeverReads: { big: "blob" },
        },
      }),
    );
    const payload = projected.payload as Record<string, unknown>;
    expect(payload.agentId).toBe("task-123");
    expect(payload.parentToolUseId).toBe("toolu_abc");
    // Slimming itself still applies to data.
    const data = payload.data as Record<string, unknown>;
    expect(data.somethingClientNeverReads).toBeUndefined();
  });

  it("slims Codex-shaped mcp_tool_call items to rendered fields plus a result summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          item: {
            type: "mcpToolCall",
            id: "item-1",
            tool: "fetch_pr",
            server: "github",
            status: "completed",
            arguments: { pr: 42 },
            durationMs: 1200,
            result: {
              content: [{ type: "text", text: `PR body line one\n${"x".repeat(5000)}` }],
              structuredContent: { huge: "y".repeat(5000) },
            },
            _meta: { internal: true },
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const item = data.item as Record<string, unknown>;
    expect(item.tool).toBe("fetch_pr");
    expect(item.server).toBe("github");
    expect(item.arguments).toEqual({ pr: 42 });
    expect(item._meta).toBeUndefined();
    expect(item.result).toEqual({ content: "PR body line one" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("slims Claude-shaped mcp_tool_call data (toolName/input/result block)", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__github__fetch_pr",
          input: { pr: 42 },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: `first line of output\n${"z".repeat(5000)}` }],
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.toolName).toBe("mcp__github__fetch_pr");
    expect(data.input).toEqual({ pr: 42 });
    expect(data.result).toEqual({ content: "first line of output" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("passes task lifecycle payloads (no data field) through untouched", () => {
    const source = activity({
      taskId: "task-9",
      title: "Audit auth",
      role: "explorer",
      model: "opus",
      effort: "high",
      workflowName: "audit-flow",
      phases: [{ index: 0, title: "Audit" }],
      typedUsage: { totalTokens: 1200 },
      runHandles: { runId: "run-1", scriptPath: "/tmp/wf.js" },
      timelineBypass: true,
    });
    const projected = projectActivityPayload(source);
    expect(projected.payload).toEqual(source.payload);
  });
});

describe("reasoning wire compatibility", () => {
  const reasoning = {
    id: MessageId.make("reasoning:raw:item-1"),
    role: "reasoning" as const,
    text: "Checking the available evidence.",
    turnId: null,
    streaming: false,
    createdAt: "2026-08-01T10:00:01.000Z",
    updatedAt: "2026-08-01T10:00:01.000Z",
  };
  const answer = {
    ...reasoning,
    id: MessageId.make("assistant:item-2"),
    role: "assistant" as const,
    text: "Here is the answer.",
  };
  const event = {
    sequence: 2,
    eventId: EventId.make("thinking-event"),
    aggregateKind: "thread" as const,
    aggregateId: ThreadId.make("thread-1"),
    occurredAt: reasoning.createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.message-sent" as const,
    payload: {
      threadId: ThreadId.make("thread-1"),
      messageId: reasoning.id,
      role: reasoning.role,
      text: reasoning.text,
      turnId: null,
      streaming: false,
      createdAt: reasoning.createdAt,
      updatedAt: reasoning.updatedAt,
    },
  } satisfies OrchestrationEvent;

  it("keeps reasoning for clients that opted in", () => {
    expect(projectActivityEvent(event, true)).toBe(event);
    expect(projectReasoningMessageEvent(event, true)).toBe(event);
  });

  it("downgrades reasoning to a system message for older clients instead of dropping it", () => {
    // Keeping the event preserves the client's sequence watermark.
    expect(projectActivityEvent(event, false)).toEqual({
      ...event,
      payload: { ...event.payload, role: "system" },
    });
    const assistantEvent = {
      ...event,
      payload: { ...event.payload, messageId: answer.id, role: "assistant" as const },
    };
    expect(projectReasoningMessageEvent(assistantEvent, false)).toBe(assistantEvent);
  });

  it("projects snapshots and volatile overlays the same way", () => {
    const thread = { messages: [reasoning, answer], activities: [] };
    const snapshot = { snapshotSequence: 2, thread } as unknown as Parameters<
      typeof projectThreadDetailSnapshot
    >[0];
    expect(
      projectThreadDetailSnapshot(snapshot, false).thread.messages.map((entry) => entry.role),
    ).toEqual(["system", "assistant"]);
    expect(
      projectThreadDetailSnapshot(snapshot, true).thread.messages.map((entry) => entry.role),
    ).toEqual(["reasoning", "assistant"]);
    const overlay = {
      threadId: ThreadId.make("thread-1"),
      revision: 3,
      messages: [reasoning, answer],
      activities: [],
    };
    expect(projectReasoningOverlay(overlay, true)).toBe(overlay);
    expect(projectReasoningOverlay(overlay, false).messages.map((entry) => entry.role)).toEqual([
      "system",
      "assistant",
    ]);
  });
});
