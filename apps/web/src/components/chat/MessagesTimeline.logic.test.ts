import { MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  deriveMessagesTimelineRowsWithState,
  normalizeCompactToolLabel,
  reconcileTurnDisclosureState,
  resolveAssistantMessageCopyState,
  resolveUnsettledTurnId,
  workEntryEmployeeSummary,
} from "./MessagesTimeline.logic";
import {
  deriveTimelineEntries,
  deriveTimelineEntriesWithState,
  type WorkLogEntry,
} from "../../session-logic";
import type { ChatMessage, TurnDiffSummary } from "../../types";

describe("streaming row projection", () => {
  function fixture(text = "") {
    const turnId = TurnId.make("live-turn");
    const historyTurnId = TurnId.make("history-turn");
    const time = (second: number) => new Date(Date.UTC(2026, 8, 4, 0, 0, second)).toISOString();
    const messages: ChatMessage[] = [
      {
        id: MessageId.make("history-user"),
        role: "user",
        text: "整理这份报告",
        turnId: null,
        createdAt: time(0),
        updatedAt: time(0),
        streaming: false,
      },
      {
        id: MessageId.make("history-assistant"),
        role: "assistant",
        text: "已完成",
        turnId: historyTurnId,
        createdAt: time(3),
        updatedAt: time(4),
        streaming: false,
      },
      {
        id: MessageId.make("live-user"),
        role: "user",
        text: "继续",
        turnId: null,
        createdAt: time(5),
        updatedAt: time(5),
        streaming: false,
      },
      {
        id: MessageId.make("live-assistant"),
        role: "assistant",
        text,
        turnId,
        createdAt: time(7),
        updatedAt: time(7),
        streaming: true,
      },
    ];
    const work: WorkLogEntry[] = [
      {
        id: "history-work",
        turnId: historyTurnId,
        createdAt: time(1),
        label: "Ran command",
        tone: "tool",
        command: "vp test",
        toolLifecycleStatus: "failed",
        sourceActivityKind: "tool.completed",
      },
      {
        id: "live-work",
        turnId,
        createdAt: time(6),
        label: "Read file",
        tone: "tool",
        changedFiles: ["/repo/src/index.ts"],
        toolLifecycleStatus: "completed",
        sourceActivityKind: "tool.completed",
      },
    ];
    const timeline = deriveTimelineEntriesWithState(messages, [], work);
    const input = {
      timelineEntries: timeline.entries,
      latestTurn: { turnId, state: "running" as const, startedAt: time(5), completedAt: null },
      runningTurnId: turnId,
      isWorking: true,
      activeTurnStartedAt: time(5),
      turnDiffSummaryByAssistantMessageId: new Map<MessageId, TurnDiffSummary>(),
      revertTurnCountByUserMessageId: new Map<MessageId, number>(),
    } satisfies Parameters<typeof deriveMessagesTimelineRows>[0];
    return { messages, work, timeline, input, time };
  }

  it.each([
    ["", "第一段"],
    [" \n", "第一段"],
    ["第一段", "第一段\n\n第二段"],
    ["第一段", ""],
  ])("keeps row parity and history identity when text changes from %j to %j", (before, after) => {
    const initial = fixture(before);
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    Object.freeze(previous.rows);
    for (const row of previous.rows) Object.freeze(row);
    const last = initial.messages.at(-1)!;
    const messages = [
      ...initial.messages.slice(0, -1),
      { ...last, text: after, updatedAt: initial.time(8) },
    ];
    const timeline = deriveTimelineEntriesWithState(
      messages,
      [],
      initial.work,
      [],
      initial.timeline,
    );
    const input = { ...initial.input, timelineEntries: timeline.entries };
    const next = deriveMessagesTimelineRowsWithState(input, previous);

    expect(next.rows).toEqual(
      deriveMessagesTimelineRows({
        ...input,
        timelineEntries: deriveTimelineEntries(messages, [], initial.work),
      }),
    );
    for (const [index, row] of previous.rows.entries()) {
      if (row.kind === "message" && row.message === last) {
        expect(next.rows[index]).toMatchObject({ message: { text: after } });
        expect(row.message.text).toBe(before);
      } else {
        expect(next.rows[index]).toBe(row);
      }
    }
  });

  it("re-derives every row for a structural change", () => {
    const initial = fixture("第一段");
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    const completed = initial.messages.map((message, index) =>
      index === initial.messages.length - 1 ? { ...message, streaming: false } : message,
    );
    const timeline = deriveTimelineEntriesWithState(
      completed,
      [],
      initial.work,
      [],
      initial.timeline,
    );
    const completedInput = { ...initial.input, timelineEntries: timeline.entries };
    const next = deriveMessagesTimelineRowsWithState(completedInput, previous);
    expect(next.rows).toEqual(deriveMessagesTimelineRows(completedInput));

    const settledInput = { ...initial.input, isWorking: false };
    expect(deriveMessagesTimelineRowsWithState(settledInput, previous).rows).toEqual(
      deriveMessagesTimelineRows(settledInput),
    );
  });

  it("keeps reusing rows when the thread list resends an equal latest turn", () => {
    const initial = fixture("第一段");
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    const last = initial.messages.at(-1)!;
    const messages = [...initial.messages.slice(0, -1), { ...last, text: "第一段\n\n第二段" }];
    const timeline = deriveTimelineEntriesWithState(
      messages,
      [],
      initial.work,
      [],
      initial.timeline,
    );
    const input = {
      ...initial.input,
      timelineEntries: timeline.entries,
      latestTurn: { ...initial.input.latestTurn },
    };
    const next = deriveMessagesTimelineRowsWithState(input, previous);
    expect(next.rows).toEqual(deriveMessagesTimelineRows(input));
    expect(next.rows[0]).toBe(previous.rows[0]);

    const settled = { ...input, latestTurn: { ...input.latestTurn, state: "completed" as const } };
    expect(deriveMessagesTimelineRowsWithState(settled, next).rows).toEqual(
      deriveMessagesTimelineRows(settled),
    );
  });

  it("returns the previous rows when nothing changed", () => {
    const initial = fixture("第一段");
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    expect(deriveMessagesTimelineRowsWithState({ ...initial.input }, previous).rows).toBe(
      previous.rows,
    );
  });
});

describe("turn disclosure lifecycle", () => {
  const turnId = "turn-1" as never;
  const runningTurn = {
    turnId,
    state: "running" as const,
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
  };

  it("uses the running turn as the active disclosure owner", () => {
    expect(resolveUnsettledTurnId(runningTurn, null)).toBe(turnId);
    expect(
      resolveUnsettledTurnId(
        { ...runningTurn, completedAt: "2026-01-01T00:00:01Z", state: "completed" },
        null,
      ),
    ).toBeNull();
  });

  it("folds a turn when it changes from running to completed", () => {
    const result = reconcileTurnDisclosureState({
      previousLatestTurn: runningTurn,
      latestTurn: { ...runningTurn, state: "completed", completedAt: "2026-01-01T00:00:10Z" },
      previousUnsettledTurnId: turnId,
      unsettledTurnId: null,
      expandedTurnIds: new Set([turnId]),
      collapsedTurnIds: new Set(),
    });

    expect(result.expandedTurnIds).toEqual(new Set());
    expect(result.collapsedTurnIds).toEqual(new Set());
  });

  it("keeps an interrupted turn expanded for error inspection", () => {
    const result = reconcileTurnDisclosureState({
      previousLatestTurn: runningTurn,
      latestTurn: { ...runningTurn, state: "interrupted", completedAt: "2026-01-01T00:00:05Z" },
      previousUnsettledTurnId: turnId,
      unsettledTurnId: null,
      expandedTurnIds: new Set(),
      collapsedTurnIds: new Set([turnId]),
    });

    expect(result.expandedTurnIds).toEqual(new Set([turnId]));
    expect(result.collapsedTurnIds).toEqual(new Set());
  });
});

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        updatedAt: "2026-01-01T00:00:10Z",
        streaming: false,
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous completed assistant updatedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:40Z",
        streaming: true,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "u2",
        role: "user",
        createdAt: "2026-01-01T00:01:00Z",
        updatedAt: "2026-01-01T00:01:00Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        updatedAt: "2026-01-01T00:01:20Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "s1",
        role: "system",
        createdAt: "2026-01-01T00:00:01Z",
        updatedAt: "2026-01-01T00:00:01Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("workEntryEmployeeSummary", () => {
  it.each([
    ["rg -n TODO src", "搜索代码"],
    ["pnpm test", "运行测试"],
    ["pnpm build", "构建项目"],
    ["pnpm typecheck", "检查项目"],
    ["git diff", "查看代码变更"],
  ])("maps %s to %s", (command, expected) => {
    expect(workEntryEmployeeSummary({ command, label: "Ran command" })).toBe(expected);
  });

  it("uses typed tool metadata before command heuristics", () => {
    expect(
      workEntryEmployeeSummary({
        command: "node script.mjs",
        label: "tool",
        itemType: "mcp_tool_call",
      }),
    ).toBe("调用企业工具");
  });

  it("names the PDF page tools and keeps other dynamic tools generic", () => {
    const tool = (toolTitle: string) =>
      workEntryEmployeeSummary({ label: "Tool call", toolTitle, itemType: "dynamic_tool_call" });
    expect(tool("fd_pdf_view_pages")).toBe("查看 PDF 页面");
    expect(tool("fd_pdf_read_pages")).toBe("读取 PDF 页面");
    expect(tool("fd_sheet_read_rows")).toBe("读取表格行");
    expect(tool("fd_document_read")).toBe("读取文档内容");
    expect(tool("query_holdings")).toBe("调用工具");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
  });

  it("expands the active turn so its non-streaming commentary is visible", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-one" as never,
            role: "assistant",
            text: "Earlier response.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-two-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-two" as never,
            role: "assistant",
            text: "Active response.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:19Z",
        completedAt: null,
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.message.id).toBe("assistant-one");
    expect(assistantRows[0]?.assistantCopyStreaming).toBe(false);
    expect(assistantRows[1]?.message.id).toBe("assistant-two");
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-2",
        active: true,
        expanded: true,
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-2",
        active: true,
      }),
    );
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      checkpointRef: "checkpoint-1" as never,
      status: "ready" as const,
      files: [{ path: "src/index.ts", kind: "modified", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });

  it("folds settled-turn commentary and work behind a Worked-for row", () => {
    const timelineEntries = [
      {
        id: "user-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "user-1" as never,
          role: "user" as const,
          text: "Build it",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
      },
      {
        id: "assistant-thought-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:05Z",
        message: {
          id: "assistant-thought" as never,
          role: "assistant" as const,
          text: "Looking around first.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:06Z",
          streaming: false,
        },
      },
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:08Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:08Z",
          turnId: "turn-1" as never,
          label: "Ran command",
          tone: "tool" as const,
        },
      },
      {
        id: "assistant-final-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:20Z",
        message: {
          id: "assistant-final" as never,
          role: "assistant" as const,
          text: "Done",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:20Z",
          updatedAt: "2026-01-01T00:00:22Z",
          streaming: false,
        },
      },
    ];

    const collapsedRows = deriveMessagesTimelineRows({
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = collapsedRows.find(
      (row): row is Extract<(typeof collapsedRows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.expanded).toBe(false);
    // User message boundary (00:00:00) → terminal message updatedAt (00:00:22).
    expect(foldRow?.label).toBe("已处理 22s");
    expect(foldRow?.lastWorkEntry).toMatchObject({ id: "work-1" });
    expect(collapsedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "turn-fold:turn-1",
      "assistant-final-entry",
    ]);

    const expandedRows = deriveMessagesTimelineRows({
      timelineEntries,
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(expandedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "turn-fold:turn-1",
      "assistant-thought-entry",
      "work-entry-1",
      "assistant-final-entry",
    ]);
    expect(
      expandedRows.find((row) => row.kind === "turn-fold" && row.expanded === true),
    ).toBeDefined();
  });

  it("derives a sane duration for a steer-superseded turn with one instant commentary message", () => {
    // A steer ends the previous turn early: its only message completes the
    // instant it is created, and trailing work entries land after it. The
    // fold duration must span from the user message that started the turn to
    // the last entry, not message createdAt → message updatedAt (~0ms).
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user" as const,
            text: "do it once more",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:09Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant" as const,
            text: "Kicking off call 1.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:09Z",
            updatedAt: "2026-01-01T00:00:09Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:12Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:12Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "steer-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:14Z",
          message: {
            id: "user-2" as never,
            role: "user" as const,
            text: "actually do 15",
            turnId: null,
            createdAt: "2026-01-01T00:00:14Z",
            updatedAt: "2026-01-01T00:00:14Z",
            streaming: false,
          },
        },
        {
          id: "assistant-next-turn-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:17Z",
          message: {
            id: "assistant-next" as never,
            role: "assistant" as const,
            text: "One down — adjusting.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:17Z",
            updatedAt: "2026-01-01T00:00:17Z",
            streaming: true,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:14Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:14Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    // User message (00:00:00) → trailing work entry (00:00:12).
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.label).toBe("已处理 12s");
  });

  it("uses latest-turn timings and the stopped label for an interrupted latest turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "interrupted",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:47Z",
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-1",
        label: "已停止 · 47s",
        expanded: false,
        active: false,
        startedAt: null,
      }),
    ]);
  });

  it("keeps the previous turn folded while a newly sent message awaits its turn", () => {
    // Right after send, isWorking is true but latestTurn still points at the
    // previous, settled turn — it must stay folded through that window.
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:22Z",
            streaming: false,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "yooo",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:22Z",
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-fold:turn-1",
      "assistant-final-entry",
      "user-followup-entry",
      "working-indicator-row",
    ]);
    const finalRow = rows.find((row) => row.id === "assistant-final-entry");
    expect(finalRow?.kind === "message" && finalRow.showAssistantMeta).toBe(true);
  });

  it("keeps the active turn's concise work rows visible below its progress row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:05Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:05Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:08Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:08Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-fold:turn-1",
      "assistant-thought-entry",
      "work-entry-1",
    ]);
    expect(rows[0]).toMatchObject({
      kind: "turn-fold",
      label: "正在处理",
      active: true,
      lastWorkEntry: expect.objectContaining({ id: "work-1" }),
    });
  });

  it("keeps the latest four active work summaries visible", () => {
    const turnId = "turn-active-list" as never;
    const rows = deriveMessagesTimelineRows({
      timelineEntries: Array.from({ length: 5 }, (_, index) => ({
        id: `work-entry-${index}`,
        kind: "work" as const,
        createdAt: `2026-01-01T00:00:0${index}Z`,
        entry: {
          id: `work-${index}`,
          createdAt: `2026-01-01T00:00:0${index}Z`,
          turnId,
          label: "Ran command",
          tone: "tool" as const,
          command: `echo ${index}`,
        },
      })),
      latestTurn: {
        turnId,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "work").map((row) => row.id)).toEqual([
      "work-1",
      "work-2",
      "work-3",
      "work-4",
    ]);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({
      hiddenCount: 1,
    });
  });

  it("does not fold the session's running turn when latestTurn regresses", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "previous-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "previous-work",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Read files",
            tone: "tool" as const,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "continue",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
        {
          id: "running-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:01:05Z",
          entry: {
            id: "running-work",
            createdAt: "2026-01-01T00:01:05Z",
            turnId: "turn-2" as never,
            label: "Searched files",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:25Z",
      },
      runningTurnId: "turn-2" as never,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "turn-fold").map((row) => row.turnId)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(rows.map((row) => row.id)).toContain("running-work-entry");
  });

  it("only shows assistant metadata on the terminal assistant message", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Checking first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows.map((row) => row.showAssistantMeta)).toEqual([false, true]);
  });

  it("keeps active assistant commentary inside the progress fold", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-1",
        active: true,
        expanded: true,
      }),
      expect.objectContaining({
        kind: "message",
        message: expect.objectContaining({ id: "assistant-thought" }),
      }),
    ]);
  });

  it("honors an explicit collapse while the turn is active", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:12Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:12Z",
            turnId: "turn-1" as never,
            label: "Searched the web",
            tone: "tool",
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      collapsedTurnIds: new Set(["turn-1" as never]),
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-1",
        active: true,
        expanded: false,
      }),
    ]);
  });

  it("keeps a streaming assistant answer visible below the active progress fold", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "assistant-answer-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-answer" as never,
            role: "assistant",
            text: "Here is the answer",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: true,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-fold:turn-1",
      "work-entry",
      "assistant-answer-entry",
    ]);
    const assistantRow = rows[2];
    expect(assistantRow?.kind === "message" && assistantRow.assistantCopyStreaming).toBe(true);
  });

  it("models work log overflow expansion as inserted list rows", () => {
    const timelineEntries = [
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:01Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:01Z",
          label: "read",
          detail: "Reading package.json",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-2",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:02Z",
        entry: {
          id: "work-2",
          createdAt: "2026-01-01T00:00:02Z",
          label: "edit",
          detail: "Editing MessagesTimeline.tsx",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-3",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:03Z",
        entry: {
          id: "work-3",
          createdAt: "2026-01-01T00:00:03Z",
          label: "test",
          detail: "Running tests",
          tone: "tool" as const,
        },
      },
    ];

    const baseInput = {
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    };
    const collapsedRows = deriveMessagesTimelineRows(baseInput);
    const expandedRows = deriveMessagesTimelineRows({
      ...baseInput,
      expandedWorkGroupIds: new Set(["work-group:work-entry-1"]),
    });

    expect(collapsedRows.map((row) => row.id)).toEqual(["work-3", "work-toggle:work-entry-1"]);
    expect(collapsedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      groupId: "work-group:work-entry-1",
      hiddenCount: 2,
      expanded: false,
      onlyToolEntries: true,
    });
    expect(expandedRows.map((row) => row.id)).toEqual([
      "work-1",
      "work-2",
      "work-3",
      "work-toggle:work-entry-1",
    ]);
    expect(expandedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      expanded: true,
    });
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("reuses work rows when equivalent timeline derivations create new grouped arrays", () => {
    const firstWorkEntry = {
      id: "work-1",
      createdAt: "2026-01-01T00:00:00Z",
      label: "thinking",
      detail: "Inspecting repository state",
      tone: "thinking" as const,
    };
    const secondWorkEntry = {
      id: "work-2",
      createdAt: "2026-01-01T00:00:01Z",
      label: "read",
      detail: "Reading package.json",
      tone: "tool" as const,
    };

    const createRows = () =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "entry-work-1",
            kind: "work",
            createdAt: firstWorkEntry.createdAt,
            entry: firstWorkEntry,
          },
          {
            id: "entry-work-2",
            kind: "work",
            createdAt: secondWorkEntry.createdAt,
            entry: secondWorkEntry,
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows();
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });
    const secondRows = createRows();

    expect(secondRows[0]).not.toBe(firstRows[0]);

    const repeated = computeStableMessagesTimelineRows(secondRows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result[0]).toBe(initial.result[0]);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});

describe("thinking traces (思考过程)", () => {
  const turnId = TurnId.make("turn-think");
  const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString();
  const user = (second: number): ChatMessage => ({
    id: MessageId.make(`user-${second}`),
    role: "user",
    text: "Review the report",
    turnId: null,
    createdAt: at(second),
    updatedAt: at(second),
    streaming: false,
  });
  const thought = (second: number, text: string, streaming = false): ChatMessage => ({
    id: MessageId.make(`reasoning:raw:item-${second}`),
    role: "reasoning",
    text,
    turnId,
    createdAt: at(second),
    updatedAt: at(second),
    streaming,
  });
  const answer = (second: number, text = "Here is the review."): ChatMessage => ({
    id: MessageId.make(`assistant-${second}`),
    role: "assistant",
    text,
    turnId,
    createdAt: at(second),
    updatedAt: at(second),
    streaming: false,
  });
  const tool = (second: number): WorkLogEntry => ({
    id: `tool-${second}`,
    turnId,
    createdAt: at(second),
    label: "Read file",
    tone: "tool",
    itemType: "dynamic_tool_call",
    toolLifecycleStatus: "completed",
    sourceActivityKind: "tool.completed",
  });
  const running = {
    latestTurn: { turnId, state: "running" as const, startedAt: at(0), completedAt: null },
    runningTurnId: turnId,
    isWorking: true,
    activeTurnStartedAt: at(0),
  };
  const settled = {
    latestTurn: {
      turnId,
      state: "completed" as const,
      startedAt: at(0),
      completedAt: at(30),
    },
    runningTurnId: null,
    isWorking: false,
    activeTurnStartedAt: null,
  };
  type Rows = ReturnType<typeof deriveMessagesTimelineRows>;
  type ReasoningRow = Extract<Rows[number], { kind: "reasoning" }>;
  const rowsFor = (
    messages: ChatMessage[],
    work: WorkLogEntry[],
    context: typeof running | typeof settled,
    extra: Partial<Parameters<typeof deriveMessagesTimelineRows>[0]> = {},
  ): Rows =>
    deriveMessagesTimelineRows({
      timelineEntries: deriveTimelineEntries(messages, [], work),
      ...context,
      turnDiffSummaryByAssistantMessageId: new Map<MessageId, TurnDiffSummary>(),
      revertTurnCountByUserMessageId: new Map<MessageId, number>(),
      ...extra,
    });
  const reasoningRows = (rows: Rows) =>
    rows.filter((row): row is ReasoningRow => row.kind === "reasoning");

  it("groups a run of thoughts under one collapsed row without splitting its tools", () => {
    const rows = rowsFor(
      [user(0), thought(1, "Open the report first."), thought(3, "Now the chart.\n\n", true)],
      [tool(2), tool(4)],
      running,
    );

    expect(rows.map((row) => row.kind)).toEqual(["message", "turn-fold", "reasoning", "work"]);
    const [group] = reasoningRows(rows);
    expect(group).toMatchObject({
      id: "reasoning-group:reasoning:raw:item-1",
      expanded: false,
      live: true,
      thinking: true,
    });
    expect(group?.messages.map((message) => message.text)).toEqual([
      "Open the report first.",
      "Now the chart.\n\n",
    ]);
    // Both tool calls stay one work group below the thinking row.
    expect(rows.find((row) => row.kind === "work")).toMatchObject({
      groupedEntries: [{ id: "tool-2" }, { id: "tool-4" }],
    });
  });

  it("keeps the work overflow toggle when thoughts sit between tool calls", () => {
    const messages = [user(0)];
    const work: WorkLogEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      messages.push(thought(1 + index * 2, `Step ${index}.`));
      work.push(tool(2 + index * 2));
    }
    const rows = rowsFor(messages, work, running);

    expect(reasoningRows(rows)).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "work")).toHaveLength(4);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({ hiddenCount: 1 });
  });

  it("starts a new thinking row after visible commentary and marks only the newest live", () => {
    const rows = rowsFor(
      [
        user(0),
        thought(1, "First idea."),
        answer(3, "Checking the numbers."),
        thought(5, "Found the cause."),
      ],
      [tool(2), tool(6)],
      running,
    );

    const groups = reasoningRows(rows);
    expect(groups.map((group) => [group.messages.length, group.live, group.thinking])).toEqual([
      [1, false, false],
      [1, true, false],
    ]);
  });

  it("drops the live line once the model starts writing after its latest thought", () => {
    const streamingAnswer: ChatMessage = { ...answer(5, "Here is"), streaming: true };
    const rows = rowsFor(
      [user(0), thought(1, "Open the report."), streamingAnswer],
      [tool(2)],
      running,
    );
    expect(reasoningRows(rows)[0]).toMatchObject({ live: false, thinking: false });

    const collapsed = rowsFor(
      [user(0), thought(1, "Open the report."), streamingAnswer],
      [tool(2)],
      running,
      { collapsedTurnIds: new Set([turnId]) },
    );
    expect(collapsed.find((row) => row.kind === "turn-fold")).not.toHaveProperty("latestThought");
  });

  it("shows the latest thought on a running turn the user collapsed", () => {
    const latest = thought(3, "Compare the peers next.");
    const rows = rowsFor([user(0), thought(1, "Read it."), latest], [tool(2)], running, {
      collapsedTurnIds: new Set([turnId]),
    });

    expect(rows.map((row) => row.kind)).toEqual(["message", "turn-fold"]);
    expect(rows[1]).toMatchObject({ kind: "turn-fold", active: true, expanded: false });
    expect(rows[1]?.kind === "turn-fold" ? rows[1].latestThought : undefined).toBe(latest);
  });

  it("folds thoughts away with the tool work of a settled turn", () => {
    const messages = [user(0), thought(1, "Open the report."), answer(20)];
    const collapsed = rowsFor(messages, [tool(2)], settled);
    expect(collapsed.map((row) => row.kind)).toEqual(["message", "turn-fold", "message"]);

    const expanded = rowsFor(messages, [tool(2)], settled, {
      expandedTurnIds: new Set([turnId]),
    });
    expect(expanded.map((row) => row.kind)).toEqual([
      "message",
      "turn-fold",
      "reasoning",
      "work",
      "message",
    ]);
    expect(reasoningRows(expanded)[0]).toMatchObject({ expanded: false, live: false });
  });

  it("keeps a thought-only answer's row instead of an empty progress fold", () => {
    const rows = rowsFor([user(0), thought(1, "Simple question."), answer(5)], [], settled);

    expect(rows.map((row) => row.kind)).toEqual(["message", "reasoning", "message"]);
  });

  it("does not let a stranded streaming thought hold a settled turn open", () => {
    const messages = [user(0), thought(1, "Cut off mid-", true), answer(20)];
    const rows = rowsFor(messages, [tool(2)], settled);

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(true);
    const expanded = rowsFor(messages, [tool(2)], settled, {
      expandedTurnIds: new Set([turnId]),
    });
    expect(reasoningRows(expanded)[0]).toMatchObject({ live: false, thinking: false });
  });

  it("opens a thinking row through the shared disclosure state", () => {
    const rows = rowsFor([user(0), thought(1, "Read it.")], [], running, {
      expandedWorkGroupIds: new Set(["reasoning-group:reasoning:raw:item-1"]),
    });

    expect(reasoningRows(rows)[0]?.expanded).toBe(true);
  });

  it("drops a thinking block that never received text once the model moved on", () => {
    expect(reasoningRows(rowsFor([user(0), thought(1, "  "), answer(5)], [], settled))).toEqual([]);
    const live = rowsFor([user(0), thought(1, "", true)], [], running);
    expect(reasoningRows(live)[0]).toMatchObject({ thinking: true });
  });

  it("hides every thought when the setting is off", () => {
    const messages = [user(0), thought(1, "Open the report."), answer(20)];
    expect(
      rowsFor(messages, [tool(2)], settled, {
        showReasoning: false,
        expandedTurnIds: new Set([turnId]),
      }).map((row) => row.kind),
    ).toEqual(["message", "turn-fold", "work", "message"]);
    expect(
      rowsFor([user(0), thought(1, "Simple question."), answer(5)], [], settled, {
        showReasoning: false,
      }).map((row) => row.kind),
    ).toEqual(["message", "message"]);
    // A running turn with only thinking so far keeps the plain working row.
    expect(
      rowsFor([user(0), thought(1, "Thinking...", true)], [], running, {
        showReasoning: false,
      }).map((row) => row.kind),
    ).toEqual(["message", "working"]);
  });

  it("swaps only the thinking row while a thought streams a new paragraph", () => {
    const messages = [user(0), thought(1, "First paragraph.\n\n", true)];
    const initial = deriveTimelineEntriesWithState(messages, [], []);
    const input = {
      timelineEntries: initial.entries,
      ...running,
      turnDiffSummaryByAssistantMessageId: new Map<MessageId, TurnDiffSummary>(),
      revertTurnCountByUserMessageId: new Map<MessageId, number>(),
    };
    const previous = deriveMessagesTimelineRowsWithState(input);
    const grown = [messages[0]!, { ...messages[1]!, text: "First paragraph.\n\nSecond one.\n\n" }];
    const timeline = deriveTimelineEntriesWithState(grown, [], [], [], initial);
    const nextInput = { ...input, timelineEntries: timeline.entries };
    const next = deriveMessagesTimelineRowsWithState(nextInput, previous);

    expect(next.rows).toEqual(deriveMessagesTimelineRows(nextInput));
    expect(next.rows.some((row) => row.kind === "reasoning")).toBe(true);
    for (const [index, row] of previous.rows.entries()) {
      if (row.kind === "reasoning") {
        expect(next.rows[index]).toMatchObject({
          messages: [{ text: "First paragraph.\n\nSecond one.\n\n" }],
        });
      } else if (row.kind === "turn-fold") {
        expect(next.rows[index]).toMatchObject({
          latestThought: { text: "First paragraph.\n\nSecond one.\n\n" },
        });
      } else {
        expect(next.rows[index]).toBe(row);
      }
    }
  });
});
