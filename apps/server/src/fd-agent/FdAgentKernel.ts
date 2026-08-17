import type { RuntimeMode } from "@t3tools/contracts";

import {
  appendFdResponsesFunctionOutputs,
  FD_RESPONSES_LIMITS,
  FdResponsesError,
  type FdResponsesEvent,
  type FdResponsesErrorKind,
  type FdResponsesInputItem,
  type FdResponsesOutputItem,
  type FdResponsesRequest,
  type FdResponsesModel,
  type FdResponsesToolDefinition,
} from "./FdResponsesProtocol.ts";

export const FD_AGENT_LIMITS = {
  maxRounds: FD_RESPONSES_LIMITS.maxRounds,
  maxContextBytes: 640 * 1_024,
  maxToolCalls: 32,
  maxToolOutputBytes: FD_RESPONSES_LIMITS.maxToolOutputBytes,
} as const;

export type FdAgentToolItemType = "command_execution" | "file_change" | "dynamic_tool_call";

export type FdAgentToolApproval = "automatic" | "permission-mode" | "explicit";

export interface FdAgentToolResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface FdAgentTool {
  readonly definition: FdResponsesToolDefinition;
  readonly itemType: FdAgentToolItemType;
  readonly approval: FdAgentToolApproval;
  readonly execute: (argumentsValue: unknown, signal: AbortSignal) => Promise<FdAgentToolResult>;
}

export interface FdAgentApprovalRequest {
  readonly callId: string;
  readonly toolName: string;
  readonly itemType: FdAgentToolItemType;
}

export type FdAgentApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface FdResponsesStreamer {
  readonly stream: (request: FdResponsesRequest) => AsyncGenerator<FdResponsesEvent>;
}

export interface FdAgentRunInput {
  readonly model: FdResponsesModel;
  readonly input: ReadonlyArray<FdResponsesInputItem>;
  readonly runtimeMode: RuntimeMode;
  readonly instructions?: string;
  readonly tools?: ReadonlyArray<FdAgentTool>;
  readonly requestApproval?: (request: FdAgentApprovalRequest) => Promise<FdAgentApprovalDecision>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface FdAgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

export type FdAgentFailureKind =
  | "approval_cancelled"
  | "cancelled"
  | "context_limit"
  | "round_limit"
  | "tool_call_limit"
  | FdResponsesErrorKind
  | "transport_error";

export type FdAgentResult =
  | {
      readonly status: "completed";
      readonly finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "other";
      readonly rounds: number;
      readonly usage: FdAgentUsage;
      readonly continuation: ReadonlyArray<FdResponsesInputItem>;
    }
  | {
      readonly status: "failed" | "interrupted";
      readonly kind: FdAgentFailureKind;
      readonly rounds: number;
      readonly usage: FdAgentUsage;
      readonly message: string;
    };

export type FdAgentEvent =
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | {
      readonly type: "tool-started";
      readonly callId: string;
      readonly toolName: string;
      readonly itemType: FdAgentToolItemType;
    }
  | {
      readonly type: "tool-completed";
      readonly callId: string;
      readonly toolName: string;
      readonly itemType: FdAgentToolItemType;
      readonly status: "completed" | "failed" | "declined";
    }
  | { readonly type: "usage"; readonly usage: FdAgentUsage }
  | { readonly type: "terminal"; readonly result: FdAgentResult };

const emptyUsage = (): FdAgentUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
});

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength <= FD_AGENT_LIMITS.maxToolOutputBytes) {
    return encoded;
  }
  return JSON.stringify({
    ok: false,
    error: { code: "tool_output_too_large", message: "Tool output exceeded the size limit." },
  });
}

function fitInitialContext(
  input: ReadonlyArray<FdResponsesInputItem>,
): ReadonlyArray<FdResponsesInputItem> {
  if (jsonBytes(input) <= FD_AGENT_LIMITS.maxContextBytes) return [...input];

  const messages = input.filter(
    (item): item is Extract<FdResponsesInputItem, { readonly role: string }> => "role" in item,
  );
  const lastUserIndex = messages.findLastIndex((item) => item.role === "user");
  if (lastUserIndex < 0) throw new FdAgentKernelError("context_limit");

  const retained = messages.slice(lastUserIndex);
  for (let index = lastUserIndex - 1; index >= 0; index -= 1) {
    const candidate = [messages[index]!, ...retained];
    if (jsonBytes(candidate) > FD_AGENT_LIMITS.maxContextBytes) break;
    retained.unshift(messages[index]!);
  }
  if (jsonBytes(retained) > FD_AGENT_LIMITS.maxContextBytes) {
    throw new FdAgentKernelError("context_limit");
  }
  return retained;
}

function shouldRequestApproval(tool: FdAgentTool, input: FdAgentRunInput): boolean {
  if (tool.approval === "explicit") return true;
  if (tool.approval === "automatic") return false;
  if (input.runtimeMode === "full-access") return false;
  if (input.runtimeMode === "auto-accept-edits" && tool.itemType === "file_change") return false;
  return true;
}

function failureKind(error: unknown): FdAgentFailureKind {
  if (error instanceof FdAgentKernelError) return error.kind;
  if (error instanceof FdResponsesError) return error.kind;
  return "transport_error";
}

function failureMessage(error: unknown): string {
  if (error instanceof FdAgentKernelError || error instanceof FdResponsesError)
    return error.message;
  return "FD agent execution failed.";
}

export class FdAgentKernelError extends Error {
  readonly kind: FdAgentFailureKind;

  constructor(kind: FdAgentFailureKind) {
    super(
      kind === "context_limit"
        ? "FD agent context exceeded its budget."
        : kind === "round_limit"
          ? "FD agent exceeded its round limit."
          : kind === "tool_call_limit"
            ? "FD agent exceeded its tool-call limit."
            : kind === "approval_cancelled"
              ? "FD agent approval was cancelled."
              : kind === "cancelled"
                ? "FD agent execution was cancelled."
                : "FD agent transport failed.",
    );
    this.kind = kind;
    this.name = "FdAgentKernelError";
  }
}

export class FdAgentKernel {
  readonly #client: FdResponsesStreamer;

  constructor(client: FdResponsesStreamer) {
    this.#client = client;
  }

  async *run(input: FdAgentRunInput): AsyncGenerator<FdAgentEvent> {
    const usage = emptyUsage();
    let rounds = 0;
    try {
      let continuation = fitInitialContext(input.input);
      const tools = input.tools ?? [];
      const toolByName = new Map(tools.map((entry) => [entry.definition.name, entry] as const));
      const acceptedForSession = new Set<string>();
      let toolCallCount = 0;

      for (let round = 1; round <= FD_AGENT_LIMITS.maxRounds; round += 1) {
        rounds = round;
        if (input.signal?.aborted) throw new FdAgentKernelError("cancelled");
        if (jsonBytes(continuation) > FD_AGENT_LIMITS.maxContextBytes) {
          throw new FdAgentKernelError("context_limit");
        }

        const outputItems: FdResponsesOutputItem[] = [];
        const functionCalls: Array<Extract<FdResponsesEvent, { readonly type: "function-call" }>> =
          [];
        let finishReason: Extract<FdAgentResult, { status: "completed" }>["finishReason"] = "other";
        let completed = false;

        for await (const event of this.#client.stream({
          model: input.model,
          round,
          input: continuation,
          ...(input.instructions ? { instructions: input.instructions } : {}),
          ...(tools.length > 0 ? { tools: tools.map((entry) => entry.definition) } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        })) {
          switch (event.type) {
            case "text-delta":
              yield event;
              break;
            case "reasoning-delta":
              yield event;
              break;
            case "output-item":
              outputItems.push(event.item);
              break;
            case "function-call":
              functionCalls.push(event);
              break;
            case "usage":
              usage.inputTokens += event.inputTokens ?? 0;
              usage.outputTokens += event.outputTokens ?? 0;
              usage.totalTokens += event.totalTokens ?? 0;
              usage.reasoningTokens += event.reasoningTokens ?? 0;
              yield { type: "usage", usage: { ...usage } };
              break;
            case "completed":
              finishReason = event.finishReason;
              completed = true;
              break;
            case "response-metadata":
            case "function-call-arguments-delta":
              break;
          }
          if (completed) break;
        }

        if (!completed) {
          throw new FdResponsesError("premature_close");
        }

        if (functionCalls.length === 0) {
          yield {
            type: "terminal",
            result: {
              status: "completed",
              finishReason,
              rounds,
              usage: { ...usage },
              continuation: [...continuation, ...outputItems],
            },
          };
          return;
        }

        toolCallCount += functionCalls.length;
        if (toolCallCount > FD_AGENT_LIMITS.maxToolCalls) {
          throw new FdAgentKernelError("tool_call_limit");
        }

        const outputs: Array<{ readonly callId: string; readonly output: string }> = [];
        for (const call of functionCalls) {
          if (input.signal?.aborted) throw new FdAgentKernelError("cancelled");
          const tool = toolByName.get(call.name);
          const itemType = tool?.itemType ?? "dynamic_tool_call";
          yield {
            type: "tool-started",
            callId: call.callId,
            toolName: call.name,
            itemType,
          };

          let result: FdAgentToolResult;
          let status: "completed" | "failed" | "declined";
          if (!tool) {
            result = {
              ok: false,
              error: { code: "unknown_tool", message: "The requested tool is unavailable." },
            };
            status = "failed";
          } else if (!call.arguments.valid) {
            result = {
              ok: false,
              error: { code: "invalid_arguments", message: "Tool arguments were invalid." },
            };
            status = "failed";
          } else {
            const needsApproval =
              shouldRequestApproval(tool, input) &&
              (tool.approval === "explicit" || !acceptedForSession.has(call.name));
            if (needsApproval) {
              const decision = input.requestApproval
                ? await input.requestApproval({
                    callId: call.callId,
                    toolName: call.name,
                    itemType,
                  })
                : "decline";
              if (decision === "cancel") throw new FdAgentKernelError("approval_cancelled");
              if (decision === "acceptForSession" && tool.approval !== "explicit") {
                acceptedForSession.add(call.name);
              }
              if (decision === "decline") {
                result = {
                  ok: false,
                  error: { code: "approval_declined", message: "Tool approval was declined." },
                };
                status = "declined";
              } else {
                result = await executeTool(tool, call.arguments.value, input.signal);
                status = result.ok ? "completed" : "failed";
              }
            } else {
              result = await executeTool(tool, call.arguments.value, input.signal);
              status = result.ok ? "completed" : "failed";
            }
          }

          outputs.push({ callId: call.callId, output: boundedJson(result) });
          yield {
            type: "tool-completed",
            callId: call.callId,
            toolName: call.name,
            itemType,
            status,
          };
        }

        continuation = appendFdResponsesFunctionOutputs(continuation, outputItems, outputs);
      }

      throw new FdAgentKernelError("round_limit");
    } catch (error) {
      const kind = failureKind(error);
      yield {
        type: "terminal",
        result: {
          status: kind === "cancelled" || kind === "approval_cancelled" ? "interrupted" : "failed",
          kind,
          rounds,
          usage: { ...usage },
          message: failureMessage(error),
        },
      };
    }
  }
}

async function executeTool(
  tool: FdAgentTool,
  argumentsValue: unknown,
  signal: AbortSignal | undefined,
): Promise<FdAgentToolResult> {
  const executionSignal = signal ?? new AbortController().signal;
  try {
    const result = await tool.execute(argumentsValue, executionSignal);
    if (executionSignal.aborted) throw new FdAgentKernelError("cancelled");
    return result;
  } catch (error) {
    if (executionSignal.aborted) throw new FdAgentKernelError("cancelled");
    throw error;
  }
}
