export const FD_RESPONSES_MODEL = "deepseek-v4-flash" as const;
export const FD_RESPONSES_CAPABILITY = "general_assistant" as const;

export const FD_RESPONSES_LIMITS = {
  maxRounds: 8,
  maxInputItems: 256,
  maxInputBytes: 768 * 1_024,
  maxRequestBytes: 1 * 1_024 * 1_024,
  maxResponseBytes: 8 * 1_024 * 1_024,
  maxSseEventBytes: 256 * 1_024,
  maxInstructionsBytes: 128 * 1_024,
  maxTextBytes: 256 * 1_024,
  maxReasoningBytes: 256 * 1_024,
  maxToolArgumentsBytes: 128 * 1_024,
  maxToolOutputBytes: 256 * 1_024,
  maxTools: 32,
  maxToolSchemaBytes: 256 * 1_024,
  maxToolDefinitionsBytes: 256 * 1_024,
  toolRequestOverheadReserveBytes: 64 * 1_024,
  maxOutputItemArrayItems: 256,
  maxOutputItemDepth: 16,
  maxEvents: 10_000,
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 300_000,
  maxOutputTokens: 8_192,
  maxInputContentParts: 9,
  maxImageBytes: 640 * 1_024,
  maxImageDataUrlBytes: 896 * 1_024,
} as const;

export interface FdResponsesInputTextContentPart {
  readonly type: "input_text";
  readonly text: string;
}

export interface FdResponsesInputImageContentPart {
  readonly type: "input_image";
  readonly image_url: string;
}

export type FdResponsesInputContentPart =
  | FdResponsesInputTextContentPart
  | FdResponsesInputImageContentPart;

export interface FdResponsesMessageInputItem {
  readonly role: "user" | "assistant" | "developer";
  readonly content: string | ReadonlyArray<FdResponsesInputContentPart>;
}

export interface FdResponsesFunctionCallInputItem {
  readonly type: "function_call";
  readonly id?: string;
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
  readonly [key: string]: unknown;
}

export interface FdResponsesFunctionCallOutputInputItem {
  readonly type: "function_call_output";
  readonly call_id: string;
  readonly output: string;
}

export interface FdResponsesReasoningOutputItem {
  readonly type: "reasoning";
  readonly [key: string]: unknown;
}

export interface FdResponsesMessageOutputItem {
  readonly type: "message";
  readonly [key: string]: unknown;
}

export type FdResponsesOutputItem =
  | FdResponsesReasoningOutputItem
  | FdResponsesFunctionCallInputItem
  | FdResponsesMessageOutputItem;

export type FdResponsesInputItem =
  | FdResponsesMessageInputItem
  | FdResponsesFunctionCallInputItem
  | FdResponsesFunctionCallOutputInputItem
  | FdResponsesOutputItem;

export interface FdResponsesToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Parameters<typeof import("ai").jsonSchema>[0];
}

export interface FdResponsesRequest {
  readonly round: number;
  readonly input: ReadonlyArray<FdResponsesInputItem>;
  readonly instructions?: string;
  readonly tools?: ReadonlyArray<FdResponsesToolDefinition>;
  readonly toolChoice?: string;
  readonly reasoningEffort?: "none" | "low" | "medium" | "high";
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface FdResponsesFunctionOutput {
  readonly callId: string;
  readonly output: string;
}

export type FdResponsesEvent =
  | { readonly type: "response-metadata"; readonly responseId: string; readonly model: string }
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | {
      readonly type: "function-call-arguments-delta";
      readonly callId: string;
      readonly delta: string;
    }
  | {
      readonly type: "function-call";
      readonly callId: string;
      readonly name: string;
      readonly argumentsJson: string;
      readonly arguments:
        | { readonly valid: true; readonly value: unknown }
        | { readonly valid: false };
    }
  | { readonly type: "output-item"; readonly item: FdResponsesOutputItem }
  | {
      readonly type: "usage";
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly reasoningTokens?: number;
    }
  | {
      readonly type: "completed";
      readonly finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "other";
    };

export type FdResponsesErrorKind =
  | "credentials_unavailable"
  | "credentials_expired"
  | "credentials_invalidated"
  | "policy_invalid"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "timeout"
  | "cancelled"
  | "premature_close"
  | "malformed_response"
  | "response_too_large";

export class FdResponsesError extends Error {
  readonly kind: FdResponsesErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(kind: FdResponsesErrorKind, options: { status?: number; retryable?: boolean } = {}) {
    super(errorMessage(kind));
    this.name = "FdResponsesError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryable(kind);
  }
}

export function appendFdResponsesFunctionOutputs(
  input: ReadonlyArray<FdResponsesInputItem>,
  outputItems: ReadonlyArray<FdResponsesOutputItem>,
  outputs: ReadonlyArray<FdResponsesFunctionOutput>,
): ReadonlyArray<FdResponsesInputItem> {
  const calls = new Set(
    outputItems.flatMap((item) =>
      item.type === "function_call" && typeof item.call_id === "string" ? [item.call_id] : [],
    ),
  );
  for (const output of outputs) {
    if (!calls.has(output.callId)) {
      throw new FdResponsesError("invalid_request");
    }
  }
  return [
    ...input,
    ...outputItems,
    ...outputs.map(
      (output): FdResponsesFunctionCallOutputInputItem => ({
        type: "function_call_output",
        call_id: output.callId,
        output: output.output,
      }),
    ),
  ];
}

function errorMessage(kind: FdResponsesErrorKind): string {
  switch (kind) {
    case "credentials_unavailable":
      return "FD runtime credentials are unavailable";
    case "credentials_expired":
      return "FD runtime credentials have expired";
    case "credentials_invalidated":
      return "FD runtime credentials changed during the request";
    case "policy_invalid":
      return "FD runtime policy does not authorize this request";
    case "invalid_request":
      return "FD Responses request is invalid";
    case "unauthorized":
      return "FD Responses authentication failed";
    case "forbidden":
      return "FD Responses request is forbidden";
    case "rate_limited":
      return "FD Responses request was rate limited";
    case "upstream_error":
      return "FD Responses upstream failed";
    case "network_error":
      return "FD Responses network request failed";
    case "timeout":
      return "FD Responses request timed out";
    case "cancelled":
      return "FD Responses request was cancelled";
    case "premature_close":
      return "FD Responses stream closed before completion";
    case "malformed_response":
      return "FD Responses returned malformed protocol data";
    case "response_too_large":
      return "FD Responses exceeded a protocol size limit";
  }
}

function isRetryable(kind: FdResponsesErrorKind): boolean {
  return (
    kind === "rate_limited" ||
    kind === "upstream_error" ||
    kind === "network_error" ||
    kind === "timeout" ||
    kind === "premature_close"
  );
}
