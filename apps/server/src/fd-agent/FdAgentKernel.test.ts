import { beforeEach, describe, expect, it, vi } from "@effect/vitest";

import {
  FD_AGENT_LIMITS,
  FdAgentKernel,
  type FdAgentEvent,
  type FdAgentTool,
  type FdResponsesStreamer,
} from "./FdAgentKernel.ts";
import { FdResponsesError, type FdResponsesEvent } from "./FdResponsesProtocol.ts";

const metadata: FdResponsesEvent = {
  type: "response-metadata",
  responseId: "resp-1",
  model: "deepseek-v4-flash",
};

async function collect(kernel: FdAgentKernel, signal?: AbortSignal) {
  const events: FdAgentEvent[] = [];
  for await (const event of kernel.run({
    input: [{ role: "user", content: "hello" }],
    runtimeMode: "full-access",
    ...(signal ? { signal } : {}),
  })) {
    events.push(event);
  }
  return events;
}

function streamer(rounds: ReadonlyArray<ReadonlyArray<FdResponsesEvent>>): FdResponsesStreamer {
  let index = 0;
  return {
    stream: async function* () {
      for (const event of rounds[index++] ?? []) yield event;
    },
  };
}

const tool: FdAgentTool = {
  definition: {
    name: "write_file",
    description: "write",
    parameters: { type: "object", properties: {} },
  },
  itemType: "file_change",
  approval: "permission-mode",
  execute: vi.fn(async () => ({ ok: true, value: { path: "a.ts" } })),
};

describe("FdAgentKernel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text and returns one completed typed result", async () => {
    const events = await collect(
      new FdAgentKernel(
        streamer([
          [
            metadata,
            { type: "text-delta", text: "Hi" },
            { type: "completed", finishReason: "stop" },
          ],
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["text-delta", "terminal"]);
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      result: { status: "completed", rounds: 1 },
    });
  });

  it("accumulates each usage dimension exactly once", async () => {
    const events = await collect(
      new FdAgentKernel(
        streamer([
          [
            metadata,
            {
              type: "usage",
              inputTokens: 2,
              outputTokens: 3,
              totalTokens: 5,
              reasoningTokens: 1,
            },
            { type: "completed", finishReason: "stop" },
          ],
        ]),
      ),
    );
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, reasoningTokens: 1 },
    });
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      result: { usage: { reasoningTokens: 1 } },
    });
  });

  it("continues statelessly with function call output", async () => {
    const requests: unknown[] = [];
    const client: FdResponsesStreamer = {
      stream: async function* (request) {
        requests.push(request);
        if (request.round === 1) {
          yield metadata;
          yield {
            type: "output-item",
            item: { type: "function_call", call_id: "call-1", name: "write_file", arguments: "{}" },
          };
          yield {
            type: "function-call",
            callId: "call-1",
            name: "write_file",
            argumentsJson: "{}",
            arguments: { valid: true, value: {} },
          };
          yield { type: "completed", finishReason: "tool-calls" };
          return;
        }
        yield metadata;
        yield { type: "completed", finishReason: "stop" };
      },
    };
    const events: FdAgentEvent[] = [];
    for await (const event of new FdAgentKernel(client).run({
      input: [{ role: "user", content: "edit" }],
      runtimeMode: "full-access",
      tools: [tool],
    }))
      events.push(event);

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain("function_call_output");
    expect(events.map((event) => event.type)).toEqual([
      "tool-started",
      "tool-completed",
      "terminal",
    ]);
  });

  it("waits for canonical approval and records decline as structured tool output", async () => {
    let release!: (decision: "decline") => void;
    const approval = new Promise<"decline">((resolve) => {
      release = resolve;
    });
    const client = streamer([
      [
        metadata,
        {
          type: "output-item",
          item: { type: "function_call", call_id: "c", name: "write_file", arguments: "{}" },
        },
        {
          type: "function-call",
          callId: "c",
          name: "write_file",
          argumentsJson: "{}",
          arguments: { valid: true, value: {} },
        },
        { type: "completed", finishReason: "tool-calls" },
      ],
      [metadata, { type: "completed", finishReason: "stop" }],
    ]);
    const events: FdAgentEvent[] = [];
    const run = (async () => {
      for await (const event of new FdAgentKernel(client).run({
        input: [{ role: "user", content: "edit" }],
        runtimeMode: "approval-required",
        tools: [tool],
        requestApproval: () => approval,
      }))
        events.push(event);
    })();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(tool.execute).not.toHaveBeenCalled();
    release("decline");
    await run;
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool-completed", status: "declined" }),
    );
  });

  it("maps cancellation to one interrupted terminal result and ignores late events", async () => {
    const client: FdResponsesStreamer = {
      stream: async function* () {
        throw new FdResponsesError("cancelled");
        yield { type: "text-delta", text: "late" };
      },
    };
    const events = await collect(new FdAgentKernel(client));
    expect(events).toEqual([
      expect.objectContaining({
        type: "terminal",
        result: expect.objectContaining({ status: "interrupted", kind: "cancelled" }),
      }),
    ]);
  });

  it.each(["timeout", "credentials_invalidated", "malformed_response"] as const)(
    "retains the typed %s transport failure in one terminal result",
    async (kind) => {
      const client: FdResponsesStreamer = {
        stream: async function* () {
          throw new FdResponsesError(kind);
        },
      };
      const events = await collect(new FdAgentKernel(client));
      expect(events).toEqual([
        expect.objectContaining({
          type: "terminal",
          result: expect.objectContaining({ status: "failed", kind }),
        }),
      ]);
    },
  );

  it("rejects a stream that closes without a protocol completion", async () => {
    const events = await collect(new FdAgentKernel(streamer([[metadata]])));
    expect(events).toEqual([
      expect.objectContaining({
        type: "terminal",
        result: expect.objectContaining({ status: "failed", kind: "premature_close" }),
      }),
    ]);
  });

  it("maps cancellation during a local tool to one interrupted result", async () => {
    const controller = new AbortController();
    const cancellingTool: FdAgentTool = {
      ...tool,
      execute: async () => {
        controller.abort();
        throw new Error("late tool failure");
      },
    };
    const events: FdAgentEvent[] = [];
    for await (const event of new FdAgentKernel(
      streamer([
        [
          metadata,
          {
            type: "output-item",
            item: {
              type: "function_call",
              call_id: "c",
              name: "write_file",
              arguments: "{}",
            },
          },
          {
            type: "function-call",
            callId: "c",
            name: "write_file",
            argumentsJson: "{}",
            arguments: { valid: true, value: {} },
          },
          { type: "completed", finishReason: "tool-calls" },
        ],
      ]),
    ).run({
      input: [{ role: "user", content: "edit" }],
      runtimeMode: "full-access",
      tools: [cancellingTool],
      signal: controller.signal,
    })) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === "terminal")).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "interrupted", kind: "cancelled" }),
      }),
    ]);
  });

  it("fails within the bounded round count", async () => {
    const callRound = [
      metadata,
      {
        type: "output-item",
        item: { type: "function_call", call_id: "c", name: "write_file", arguments: "{}" },
      },
      {
        type: "function-call",
        callId: "c",
        name: "write_file",
        argumentsJson: "{}",
        arguments: { valid: true, value: {} },
      },
      { type: "completed", finishReason: "tool-calls" },
    ] satisfies ReadonlyArray<FdResponsesEvent>;
    const events: FdAgentEvent[] = [];
    for await (const event of new FdAgentKernel(
      streamer(Array(FD_AGENT_LIMITS.maxRounds).fill(callRound)),
    ).run({
      input: [{ role: "user", content: "loop" }],
      runtimeMode: "full-access",
      tools: [tool],
    }))
      events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      result: { status: "failed", kind: "round_limit", rounds: FD_AGENT_LIMITS.maxRounds },
    });
  });

  it("rejects a single over-budget user message without issuing a request", async () => {
    const stream = vi.fn(async function* () {
      yield metadata;
    });
    const events: FdAgentEvent[] = [];
    for await (const event of new FdAgentKernel({ stream }).run({
      input: [{ role: "user", content: "x".repeat(FD_AGENT_LIMITS.maxContextBytes + 1) }],
      runtimeMode: "full-access",
    }))
      events.push(event);
    expect(stream).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      result: { status: "failed", kind: "context_limit" },
    });
  });

  it.each([
    ["approval-required", "file_change", true],
    ["approval-required", "command_execution", true],
    ["approval-required", "dynamic_tool_call", true],
    ["auto-accept-edits", "file_change", false],
    ["auto-accept-edits", "command_execution", true],
    ["auto-accept-edits", "dynamic_tool_call", true],
    ["auto", "file_change", true],
    ["auto", "command_execution", true],
    ["auto", "dynamic_tool_call", true],
    ["full-access", "file_change", false],
    ["full-access", "command_execution", false],
    ["full-access", "dynamic_tool_call", false],
  ] as const)(
    "%s mode maps %s approval without reinterpreting the runtime label",
    async (runtimeMode, itemType, expectedApproval) => {
      const requestApproval = vi.fn(async () => "accept" as const);
      const matrixTool: FdAgentTool = { ...tool, itemType };
      const events: FdAgentEvent[] = [];
      for await (const event of new FdAgentKernel(
        streamer([
          [
            metadata,
            {
              type: "output-item",
              item: {
                type: "function_call",
                call_id: "matrix-call",
                name: "write_file",
                arguments: "{}",
              },
            },
            {
              type: "function-call",
              callId: "matrix-call",
              name: "write_file",
              argumentsJson: "{}",
              arguments: { valid: true, value: {} },
            },
            { type: "completed", finishReason: "tool-calls" },
          ],
          [metadata, { type: "completed", finishReason: "stop" }],
        ]),
      ).run({
        input: [{ role: "user", content: "matrix" }],
        runtimeMode,
        tools: [matrixTool],
        requestApproval,
      })) {
        events.push(event);
      }

      expect(requestApproval).toHaveBeenCalledTimes(expectedApproval ? 1 : 0);
      expect(events.at(-1)).toMatchObject({ type: "terminal", result: { status: "completed" } });
    },
  );

  it.each([
    ["approval-required", "file_change", false],
    ["approval-required", "command_execution", false],
    ["approval-required", "dynamic_tool_call", false],
    ["auto-accept-edits", "file_change", false],
    ["auto-accept-edits", "command_execution", false],
    ["auto-accept-edits", "dynamic_tool_call", false],
    ["auto", "file_change", false],
    ["auto", "command_execution", false],
    ["auto", "dynamic_tool_call", false],
    ["full-access", "file_change", false],
    ["full-access", "command_execution", false],
    ["full-access", "dynamic_tool_call", false],
  ] as const)(
    "%s mode applies routine policy to %s without changing its label",
    async (runtimeMode, itemType, expectedApproval) => {
      const requestApproval = vi.fn(async () => "accept" as const);
      const routineTool: FdAgentTool = {
        ...tool,
        itemType,
        approval: "automatic",
      };
      for await (const _event of new FdAgentKernel(
        streamer([
          [
            metadata,
            {
              type: "output-item",
              item: {
                type: "function_call",
                call_id: "routine-call",
                name: "write_file",
                arguments: "{}",
              },
            },
            {
              type: "function-call",
              callId: "routine-call",
              name: "write_file",
              argumentsJson: "{}",
              arguments: { valid: true, value: {} },
            },
            { type: "completed", finishReason: "tool-calls" },
          ],
          [metadata, { type: "completed", finishReason: "stop" }],
        ]),
      ).run({
        input: [{ role: "user", content: "routine" }],
        runtimeMode,
        tools: [routineTool],
        requestApproval,
      })) {
        // Drain the typed terminal result.
      }
      expect(requestApproval).toHaveBeenCalledTimes(expectedApproval ? 1 : 0);
    },
  );

  it.each([
    ["approval-required", "file_change"],
    ["approval-required", "command_execution"],
    ["approval-required", "dynamic_tool_call"],
    ["auto-accept-edits", "file_change"],
    ["auto-accept-edits", "command_execution"],
    ["auto-accept-edits", "dynamic_tool_call"],
    ["auto", "file_change"],
    ["auto", "command_execution"],
    ["auto", "dynamic_tool_call"],
    ["full-access", "file_change"],
    ["full-access", "command_execution"],
    ["full-access", "dynamic_tool_call"],
  ] as const)("%s mode cannot bypass explicit approval for %s", async (runtimeMode, itemType) => {
    const requestApproval = vi.fn(async () => "accept" as const);
    const explicitTool: FdAgentTool = {
      ...tool,
      itemType,
      approval: "explicit",
    };
    for await (const _event of new FdAgentKernel(
      streamer([
        [
          metadata,
          {
            type: "output-item",
            item: {
              type: "function_call",
              call_id: "explicit-call",
              name: "write_file",
              arguments: "{}",
            },
          },
          {
            type: "function-call",
            callId: "explicit-call",
            name: "write_file",
            argumentsJson: "{}",
            arguments: { valid: true, value: {} },
          },
          { type: "completed", finishReason: "tool-calls" },
        ],
        [metadata, { type: "completed", finishReason: "stop" }],
      ]),
    ).run({
      input: [{ role: "user", content: "explicit" }],
      runtimeMode,
      tools: [explicitTool],
      requestApproval,
    })) {
      // Drain the typed terminal result.
    }
    expect(requestApproval).toHaveBeenCalledTimes(1);
  });

  it("does not persist an accept-for-session decision for an explicit tool", async () => {
    const requestApproval = vi.fn(async () => "acceptForSession" as const);
    const explicitTool: FdAgentTool = { ...tool, approval: "explicit" };
    const callRound = (callId: string): ReadonlyArray<FdResponsesEvent> => [
      metadata,
      {
        type: "output-item",
        item: { type: "function_call", call_id: callId, name: "write_file", arguments: "{}" },
      },
      {
        type: "function-call",
        callId,
        name: "write_file",
        argumentsJson: "{}",
        arguments: { valid: true, value: {} },
      },
      { type: "completed", finishReason: "tool-calls" },
    ];

    for await (const _event of new FdAgentKernel(
      streamer([
        callRound("explicit-call-1"),
        callRound("explicit-call-2"),
        [metadata, { type: "completed", finishReason: "stop" }],
      ]),
    ).run({
      input: [{ role: "user", content: "explicit twice" }],
      runtimeMode: "full-access",
      tools: [explicitTool],
      requestApproval,
    })) {
      // Drain the typed terminal result.
    }
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });
});
