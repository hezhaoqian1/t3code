import {
  CheckpointRef,
  EventId,
  MessageId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  planConversationRewind,
  type ConversationRewindTurnRow,
} from "./conversationRewindPlan.ts";

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  createdAt: string,
  turnId: string | null = null,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text: id,
  turnId: turnId === null ? null : TurnId.make(turnId),
  streaming: false,
  createdAt,
  updatedAt: createdAt,
});

const turn = (
  turnId: string,
  pendingMessageId: string | null,
  requestedAt: string,
  checkpointTurnCount: number | null = null,
): ConversationRewindTurnRow => ({
  turnId: TurnId.make(turnId),
  pendingMessageId: pendingMessageId === null ? null : MessageId.make(pendingMessageId),
  requestedAt,
  checkpointTurnCount,
});

const emptyThread: Pick<
  OrchestrationThread,
  "messages" | "activities" | "proposedPlans" | "checkpoints"
> = { messages: [], activities: [], proposedPlans: [], checkpoints: [] };

// Three turns in a task folder without Git: no checkpoints anywhere.
const threeTurns = {
  ...emptyThread,
  messages: [
    message("user-1", "user", "2026-10-01T01:00:00.000Z"),
    message("assistant-1", "assistant", "2026-10-01T01:00:05.000Z", "turn-1"),
    message("user-2", "user", "2026-10-01T02:00:00.000Z"),
    message("assistant-2", "assistant", "2026-10-01T02:00:05.000Z", "turn-2"),
    message("user-3", "user", "2026-10-01T03:00:00.000Z"),
    message("assistant-3", "assistant", "2026-10-01T03:00:05.000Z", "turn-3"),
  ],
};
const threeTurnRows = [
  turn("turn-1", "user-1", "2026-10-01T01:00:00.000Z"),
  turn("turn-2", "user-2", "2026-10-01T02:00:00.000Z"),
  turn("turn-3", "user-3", "2026-10-01T03:00:00.000Z"),
];

describe("planConversationRewind", () => {
  it("removes the anchor's turn and every later turn without checkpoints", () => {
    expect(
      planConversationRewind({
        thread: threeTurns,
        turns: threeTurnRows,
        messageId: MessageId.make("user-2"),
      }),
    ).toEqual({
      _tag: "Planned",
      messageId: "user-2",
      messageCreatedAt: "2026-10-01T02:00:00.000Z",
      removedTurnIds: ["turn-2", "turn-3"],
      retainedCheckpointTurnCount: 0,
      staleCheckpointRefs: [],
    });
  });

  it("removes turns the projection never recorded when their entries follow the anchor", () => {
    const plan = planConversationRewind({
      thread: {
        ...threeTurns,
        activities: [
          {
            id: EventId.make("late-tool"),
            tone: "tool",
            kind: "tool.completed",
            summary: "tool",
            payload: {},
            turnId: TurnId.make("unrecorded-turn"),
            createdAt: "2026-10-01T03:30:00.000Z",
          },
          {
            id: EventId.make("old-tool"),
            tone: "tool",
            kind: "tool.completed",
            summary: "tool",
            payload: {},
            turnId: TurnId.make("old-unrecorded-turn"),
            createdAt: "2026-10-01T00:30:00.000Z",
          },
        ],
      },
      turns: threeTurnRows,
      messageId: MessageId.make("user-3"),
    });
    expect(plan._tag === "Planned" && plan.removedTurnIds).toEqual(["turn-3", "unrecorded-turn"]);
  });

  it("keeps a turn requested before the anchor even when it wrote after it", () => {
    const plan = planConversationRewind({
      thread: {
        ...threeTurns,
        messages: [
          ...threeTurns.messages,
          message("steered-late", "assistant", "2026-10-01T03:00:10.000Z", "turn-2"),
        ],
      },
      turns: threeTurnRows,
      messageId: MessageId.make("user-3"),
    });
    expect(plan._tag === "Planned" && plan.removedTurnIds).toEqual(["turn-3"]);
  });

  it("drops checkpoints of removed turns and counts the ones that stay", () => {
    const plan = planConversationRewind({
      thread: {
        ...threeTurns,
        checkpoints: [1, 2, 3].map((count) => ({
          turnId: TurnId.make(`turn-${count}`),
          checkpointTurnCount: count,
          checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${count}`),
          status: "ready" as const,
          files: [],
          assistantMessageId: MessageId.make(`assistant-${count}`),
          completedAt: `2026-10-01T0${count}:00:06.000Z`,
        })),
      },
      turns: threeTurnRows.map((row, index) => ({ ...row, checkpointTurnCount: index + 1 })),
      messageId: MessageId.make("user-2"),
    });
    expect(plan).toMatchObject({
      _tag: "Planned",
      removedTurnIds: ["turn-2", "turn-3"],
      retainedCheckpointTurnCount: 1,
      staleCheckpointRefs: ["refs/t3/checkpoints/2", "refs/t3/checkpoints/3"],
    });
  });

  it("also removes turns past the restored checkpoint when files are restored", () => {
    const plan = planConversationRewind({
      thread: threeTurns,
      turns: threeTurnRows.map((row, index) => ({ ...row, checkpointTurnCount: index + 1 })),
      messageId: MessageId.make("user-3"),
      maxCheckpointTurnCount: 1,
    });
    expect(plan._tag === "Planned" && plan.removedTurnIds).toEqual(["turn-2", "turn-3"]);
  });

  it("rejects unknown messages, assistant messages and FD Skill history", () => {
    expect(
      planConversationRewind({
        thread: threeTurns,
        turns: threeTurnRows,
        messageId: MessageId.make("missing"),
      }),
    ).toEqual({ _tag: "Rejected", reason: "message-not-found" });
    expect(
      planConversationRewind({
        thread: threeTurns,
        turns: threeTurnRows,
        messageId: MessageId.make("assistant-1"),
      }),
    ).toEqual({ _tag: "Rejected", reason: "not-user-message" });
    const withSkill = {
      ...threeTurns,
      messages: [
        ...threeTurns.messages,
        message("fd-enterprise-history:7:1", "user", "2026-10-01T04:00:00.000Z"),
        message("fd-enterprise-history:7:2", "assistant", "2026-10-01T04:00:05.000Z", "turn-4"),
      ],
    };
    expect(
      planConversationRewind({
        thread: withSkill,
        turns: threeTurnRows,
        messageId: MessageId.make("user-2"),
      }),
    ).toEqual({ _tag: "Rejected", reason: "fd-skill" });
    expect(
      planConversationRewind({
        thread: withSkill,
        turns: threeTurnRows,
        messageId: MessageId.make("fd-enterprise-history:7:1"),
      }),
    ).toEqual({ _tag: "Rejected", reason: "fd-skill" });
    // FD Skill history before the anchor stays and does not block the rewind.
    const skillFirst = {
      ...threeTurns,
      messages: [
        message("fd-enterprise-history:7:1", "user", "2026-10-01T00:10:00.000Z"),
        message("fd-enterprise-history:7:2", "assistant", "2026-10-01T00:10:05.000Z", "turn-0"),
        ...threeTurns.messages,
      ],
    };
    expect(
      planConversationRewind({
        thread: skillFirst,
        turns: threeTurnRows,
        messageId: MessageId.make("user-2"),
      })._tag,
    ).toBe("Planned");
  });
});
