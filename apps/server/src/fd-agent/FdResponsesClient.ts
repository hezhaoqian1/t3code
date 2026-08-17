// @effect-diagnostics globalTimers:off nodeBuiltinImport:off
import { clearTimeout, setTimeout } from "node:timers";

import { createOpenAI } from "@ai-sdk/openai";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import { Ajv, type AnySchema, type ValidateFunction } from "ajv";
import * as addFormatsModule from "ajv-formats";
import { jsonSchema, streamText, tool, type ToolSet } from "ai";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { FdRuntimeCredentialStore } from "../fd/FdRuntimeCredentialStore.ts";
import {
  FD_RESPONSES_CAPABILITY,
  FD_RESPONSES_LIMITS,
  FD_RESPONSES_MODEL,
  FdResponsesError,
  isFdResponsesModel,
  type FdResponsesEvent,
  type FdResponsesInputItem,
  type FdResponsesMessageInputItem,
  type FdResponsesOutputItem,
  type FdResponsesRequest,
  type FdResponsesToolDefinition,
} from "./FdResponsesProtocol.ts";
import { parseBase64DataUrl } from "../imageMime.ts";

type SdkFetch = NonNullable<NonNullable<Parameters<typeof createOpenAI>[0]>["fetch"]>;
type Fetch = (...args: Parameters<SdkFetch>) => ReturnType<SdkFetch>;
type CredentialReader = Pick<FdRuntimeCredentialStore["Service"], "subscribe">;
type ProtocolTerminal = "completed" | "incomplete" | "failed";
type CredentialLeaseFailure = "credentials_expired" | "credentials_invalidated";

const FD_TOOL_VALIDATOR_CACHE_ENTRIES = 16;

interface PendingFunctionCall {
  readonly item: FdResponsesOutputItem & { readonly type: "function_call" };
  readonly callId: string;
  readonly name: string;
  readonly argumentsJson: string;
}

interface RawChunkResult {
  readonly events: ReadonlyArray<FdResponsesEvent>;
  readonly terminal?: ProtocolTerminal;
  readonly functionCall?: PendingFunctionCall;
}

export interface FdResponsesClientOptions {
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly toolValidatorCache?: FdToolValidatorCache;
}

export class FdToolValidatorCache {
  readonly #entries = new Map<string, ValidateFunction>();
  readonly #maximumEntries: number;

  constructor(maximumEntries: number = FD_TOOL_VALIDATOR_CACHE_ENTRIES) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 32) {
      throw new FdResponsesError("invalid_request");
    }
    this.#maximumEntries = maximumEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  validatorFor(definition: FdResponsesToolDefinition): ValidateFunction {
    const schemaJson = jsonStringify(definition.parameters, "invalid_request");
    const key = `${definition.name}\u0000${schemaJson}`;
    const cached = this.#entries.get(key);
    if (cached !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached;
    }

    const addFormats = addFormatsModule.default as unknown as (ajv: Ajv) => Ajv;
    const validator = addFormats(new Ajv({ allErrors: false, strict: true }));
    const compiled = validator.compile(definition.parameters as AnySchema);
    this.#entries.set(key, compiled);
    while (this.#entries.size > this.#maximumEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return compiled;
  }
}

const sharedToolValidatorCache = new FdToolValidatorCache();

export class FdResponsesClient {
  readonly #credentials: CredentialReader;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #toolValidatorCache: FdToolValidatorCache;

  constructor(credentials: CredentialReader, options: FdResponsesClientOptions = {}) {
    this.#credentials = credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#toolValidatorCache = options.toolValidatorCache ?? sharedToolValidatorCache;
  }

  async *stream(request: FdResponsesRequest): AsyncGenerator<FdResponsesEvent> {
    validateRequest(request);
    const credentialLease = await openCredentialLease(this.#credentials, this.#now);
    const timeoutMs = request.timeoutMs ?? FD_RESPONSES_LIMITS.defaultTimeoutMs;
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signals = [timeoutController.signal, credentialLease.signal];
    if (request.signal !== undefined) signals.unshift(request.signal);
    const signal = AbortSignal.any(signals);
    try {
      const credentials = credentialLease.credentials;
      if (!authorizedModels(credentials).includes(request.model)) {
        throw new FdResponsesError("policy_invalid");
      }
      const exactFetch = makeExactFetch(this.#fetch, credentials, request);
      const provider = createOpenAI({
        name: "fd-new-api",
        baseURL: `${credentials.newApiOrigin}/v1`,
        apiKey: credentials.runtimeApiKey,
        // Bun augments global fetch with `preconnect`; the SDK invokes only the callable surface.
        fetch: exactFetch as SdkFetch,
      });
      const sdkTools = makeTools(request, this.#toolValidatorCache);
      const result = streamText({
        model: provider.responses(request.model),
        messages: [{ role: "user", content: "FD protocol request" }],
        tools: sdkTools,
        ...(request.toolChoice
          ? { toolChoice: { type: "tool", toolName: request.toolChoice } }
          : {}),
        maxOutputTokens: FD_RESPONSES_LIMITS.maxOutputTokens,
        maxRetries: 0,
        abortSignal: signal,
        includeRawChunks: true,
        reasoning: request.reasoningEffort ?? "high",
        providerOptions: {
          openai: {
            store: false,
            forceReasoning: true,
            reasoningEffort: request.reasoningEffort ?? "high",
            ...((request.reasoningEffort ?? "high") === "none" ? {} : { reasoningSummary: "auto" }),
            strictJsonSchema: true,
            parallelToolCalls: false,
          },
        },
      });

      let completed = false;
      let protocolTerminal: ProtocolTerminal | undefined;
      let sawExactModelMetadata = false;
      let eventCount = 0;
      let textBytes = 0;
      let reasoningBytes = 0;
      const argumentBytes = new Map<string, number>();
      const pendingFunctionCalls = new Map<string, PendingFunctionCall>();
      for await (const part of result.fullStream) {
        credentialLease.assertActive();
        eventCount += 1;
        if (eventCount > FD_RESPONSES_LIMITS.maxEvents) {
          throw new FdResponsesError("response_too_large");
        }
        switch (part.type) {
          case "raw": {
            const raw = parseRawChunk(part.rawValue);
            if (raw.terminal !== undefined) {
              if (protocolTerminal !== undefined) {
                throw new FdResponsesError("malformed_response");
              }
              protocolTerminal = raw.terminal;
            }
            if (raw.functionCall !== undefined) {
              if (pendingFunctionCalls.has(raw.functionCall.callId)) {
                throw new FdResponsesError("malformed_response");
              }
              pendingFunctionCalls.set(raw.functionCall.callId, raw.functionCall);
            }
            for (const event of raw.events) {
              if (event.type === "response-metadata" && event.model !== request.model) {
                throw new FdResponsesError("malformed_response");
              }
              if (event.type === "response-metadata") sawExactModelMetadata = true;
              credentialLease.assertActive();
              yield event;
            }
            break;
          }
          case "text-delta":
            textBytes = addBoundedBytes(textBytes, part.text, FD_RESPONSES_LIMITS.maxTextBytes);
            credentialLease.assertActive();
            yield { type: "text-delta", text: part.text };
            break;
          case "reasoning-delta":
            reasoningBytes = addBoundedBytes(
              reasoningBytes,
              part.text,
              FD_RESPONSES_LIMITS.maxReasoningBytes,
            );
            credentialLease.assertActive();
            yield { type: "reasoning-delta", text: part.text };
            break;
          case "tool-input-delta": {
            const bytes = addBoundedBytes(
              argumentBytes.get(part.id) ?? 0,
              part.delta,
              FD_RESPONSES_LIMITS.maxToolArgumentsBytes,
            );
            argumentBytes.set(part.id, bytes);
            credentialLease.assertActive();
            yield { type: "function-call-arguments-delta", callId: part.id, delta: part.delta };
            break;
          }
          case "tool-call": {
            if (!sawExactModelMetadata) {
              throw new FdResponsesError("malformed_response");
            }
            if ("invalid" in part && part.invalid) {
              throw new FdResponsesError("malformed_response");
            }
            const pending = pendingFunctionCalls.get(part.toolCallId);
            if (pending === undefined || pending.name !== part.toolName) {
              throw new FdResponsesError("malformed_response");
            }
            pendingFunctionCalls.delete(part.toolCallId);
            credentialLease.assertActive();
            yield { type: "output-item", item: pending.item };
            credentialLease.assertActive();
            yield {
              type: "function-call",
              callId: pending.callId,
              name: pending.name,
              argumentsJson: pending.argumentsJson,
              arguments: { valid: true, value: part.input },
            };
            break;
          }
          case "finish":
            if (protocolTerminal === undefined) {
              throw new FdResponsesError("premature_close");
            }
            if (protocolTerminal === "failed") {
              throw new FdResponsesError("upstream_error");
            }
            if (!sawExactModelMetadata || pendingFunctionCalls.size > 0) {
              throw new FdResponsesError("malformed_response");
            }
            if (part.finishReason === "error") {
              throw new FdResponsesError("malformed_response");
            }
            credentialLease.assertActive();
            yield {
              type: "usage",
              ...(part.totalUsage.inputTokens !== undefined
                ? { inputTokens: part.totalUsage.inputTokens }
                : {}),
              ...(part.totalUsage.outputTokens !== undefined
                ? { outputTokens: part.totalUsage.outputTokens }
                : {}),
              ...(part.totalUsage.totalTokens !== undefined
                ? { totalTokens: part.totalUsage.totalTokens }
                : {}),
              ...(part.totalUsage.outputTokenDetails.reasoningTokens !== undefined
                ? { reasoningTokens: part.totalUsage.outputTokenDetails.reasoningTokens }
                : {}),
            };
            credentialLease.assertActive();
            completed = true;
            yield {
              type: "completed",
              finishReason:
                part.finishReason === "stop" ||
                part.finishReason === "length" ||
                part.finishReason === "content-filter" ||
                part.finishReason === "tool-calls"
                  ? part.finishReason
                  : "other",
            };
            break;
          case "abort":
            throw abortError(request.signal, timeoutController.signal, credentialLease);
          case "error":
            if (protocolTerminal === "failed" && isResponseFailedError(part.error)) {
              throw new FdResponsesError("upstream_error");
            }
            throw normalizeError(
              part.error,
              request.signal,
              timeoutController.signal,
              credentialLease,
            );
        }
      }
      credentialLease.assertActive();
      if (!completed) throw new FdResponsesError("premature_close");
    } catch (error) {
      throw normalizeError(error, request.signal, timeoutController.signal, credentialLease);
    } finally {
      clearTimeout(timeoutTimer);
      await credentialLease.close();
    }
  }
}

interface CredentialLease {
  readonly credentials: FdServerRuntimeCredentialProjection;
  readonly signal: AbortSignal;
  readonly failure: () => CredentialLeaseFailure | undefined;
  readonly assertActive: () => void;
  readonly close: () => Promise<void>;
}

async function openCredentialLease(
  reader: CredentialReader,
  now: () => number,
): Promise<CredentialLease> {
  const scope = await Effect.runPromise(Scope.make());
  try {
    const subscription = await Effect.runPromise(
      reader.subscribe.pipe(Effect.provideService(Scope.Scope, scope)),
    );
    if (Option.isNone(subscription.current)) {
      throw new FdResponsesError("credentials_unavailable");
    }
    const credentials = subscription.current.value;
    validateCredentials(credentials, now());

    const abortController = new AbortController();
    let failure: CredentialLeaseFailure | undefined;
    let closed = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let currentCredentials = credentials;
    let expiresAtMs = credentialDeadlineMs(credentials);
    const invalidate = (kind: CredentialLeaseFailure) => {
      if (closed || failure !== undefined) return;
      failure = kind;
      abortController.abort();
    };
    const scheduleExpiry = () => {
      const remaining = expiresAtMs - now();
      if (remaining <= 0) {
        invalidate("credentials_expired");
        return;
      }
      expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
    };
    const updateDeadline = (nextDeadlineMs: number) => {
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer);
        expiryTimer = undefined;
      }
      expiresAtMs = nextDeadlineMs;
      scheduleExpiry();
    };
    scheduleExpiry();

    const changeFiber = Effect.runFork(
      subscription.changes.pipe(
        Stream.runForEach((change) =>
          Effect.sync(() => {
            Option.match(change, {
              onNone: () => invalidate("credentials_invalidated"),
              onSome: (next) => {
                if (!sameCredentialSafetyIdentity(currentCredentials, next)) {
                  invalidate("credentials_invalidated");
                  return;
                }
                currentCredentials = next;
                updateDeadline(credentialDeadlineMs(next));
              },
            });
          }),
        ),
      ),
    );

    return {
      credentials,
      signal: abortController.signal,
      failure: () => failure,
      assertActive: () => {
        if (failure === undefined && expiresAtMs <= now()) {
          invalidate("credentials_expired");
        }
        if (failure !== undefined) throw new FdResponsesError(failure);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        if (expiryTimer !== undefined) clearTimeout(expiryTimer);
        await Effect.runPromise(Fiber.interrupt(changeFiber).pipe(Effect.ignore));
        await Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.ignore));
      },
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.ignore));
    throw error;
  }
}

function credentialDeadlineMs(credentials: FdServerRuntimeCredentialProjection): number {
  return Math.min(credentials.accessExpiresAt, credentials.policy.expiresAt) * 1_000;
}

function sameCredentialSafetyIdentity(
  current: FdServerRuntimeCredentialProjection,
  next: FdServerRuntimeCredentialProjection,
): boolean {
  return (
    current.userId === next.userId &&
    current.runtimeTokenId === next.runtimeTokenId &&
    current.newApiOrigin === next.newApiOrigin &&
    current.runtimeApiKey === next.runtimeApiKey &&
    current.policy.version === next.policy.version &&
    current.policy.capability === next.policy.capability &&
    current.policy.model === next.policy.model &&
    sameModels(current.policy.models, next.policy.models)
  );
}

function sameModels(
  current: FdServerRuntimeCredentialProjection["policy"]["models"],
  next: FdServerRuntimeCredentialProjection["policy"]["models"],
): boolean {
  if (current === undefined || next === undefined) return current === next;
  return current.length === next.length && current.every((model, index) => model === next[index]);
}

function authorizedModels(credentials: FdServerRuntimeCredentialProjection): ReadonlyArray<string> {
  return credentials.policy.models ?? [credentials.policy.model];
}

function validateCredentials(
  credentials: FdServerRuntimeCredentialProjection,
  nowMs: number,
): void {
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (credentials.accessExpiresAt <= nowSeconds || credentials.policy.expiresAt <= nowSeconds) {
    throw new FdResponsesError("credentials_expired");
  }
  if (
    credentials.policy.version !== 1 ||
    credentials.policy.capability !== FD_RESPONSES_CAPABILITY ||
    credentials.policy.model !== FD_RESPONSES_MODEL
  ) {
    throw new FdResponsesError("policy_invalid");
  }
}

function validateRequest(request: FdResponsesRequest): void {
  if (
    !isFdResponsesModel(request.model) ||
    !Number.isInteger(request.round) ||
    request.round < 1 ||
    request.round > FD_RESPONSES_LIMITS.maxRounds ||
    request.input.length === 0 ||
    request.input.length > FD_RESPONSES_LIMITS.maxInputItems ||
    (request.timeoutMs !== undefined &&
      (!Number.isInteger(request.timeoutMs) ||
        request.timeoutMs < 1 ||
        request.timeoutMs > FD_RESPONSES_LIMITS.maxTimeoutMs))
  ) {
    throw new FdResponsesError("invalid_request");
  }
  assertJsonBytes(request.input, FD_RESPONSES_LIMITS.maxInputBytes, "invalid_request");
  if (
    request.instructions !== undefined &&
    byteLength(request.instructions) > FD_RESPONSES_LIMITS.maxInstructionsBytes
  ) {
    throw new FdResponsesError("invalid_request");
  }
  let sawUser = false;
  const callIds = new Set<string>();
  for (const item of request.input) {
    validateInputItem(item);
    if ("role" in item && item.role === "user") sawUser = true;
    if ("type" in item && item.type === "function_call") callIds.add(item.call_id);
    if ("type" in item && item.type === "function_call_output" && !callIds.has(item.call_id)) {
      throw new FdResponsesError("invalid_request");
    }
  }
  if (!sawUser) throw new FdResponsesError("invalid_request");
  const tools = request.tools ?? [];
  if (tools.length > FD_RESPONSES_LIMITS.maxTools) {
    throw new FdResponsesError("invalid_request");
  }
  const toolDefinitionsBytes = byteLength(jsonStringify(tools, "invalid_request"));
  const requestBaseBytes = byteLength(
    jsonStringify(
      {
        model: request.model,
        input: request.input,
        ...(request.instructions ? { instructions: request.instructions } : {}),
        store: false,
        stream: true,
      },
      "invalid_request",
    ),
  );
  if (
    toolDefinitionsBytes > FD_RESPONSES_LIMITS.maxToolDefinitionsBytes ||
    requestBaseBytes + toolDefinitionsBytes + FD_RESPONSES_LIMITS.toolRequestOverheadReserveBytes >
      FD_RESPONSES_LIMITS.maxRequestBytes
  ) {
    throw new FdResponsesError("invalid_request");
  }
  const toolNames = new Set<string>();
  for (const definition of tools) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(definition.name) ||
      toolNames.has(definition.name) ||
      byteLength(definition.description) > 4_096
    ) {
      throw new FdResponsesError("invalid_request");
    }
    toolNames.add(definition.name);
    assertJsonBytes(
      definition.parameters,
      FD_RESPONSES_LIMITS.maxToolSchemaBytes,
      "invalid_request",
    );
  }
  if (request.toolChoice !== undefined && !toolNames.has(request.toolChoice)) {
    throw new FdResponsesError("invalid_request");
  }
}

function validateInputItem(item: FdResponsesInputItem): void {
  if (isMessageInputItem(item)) {
    validateMessageContent(item.content);
    return;
  }
  if (item.type === "function_call") {
    if (
      !validIdentifier(item.call_id, 128) ||
      !validIdentifier(item.name, 96) ||
      byteLength(item.arguments) > FD_RESPONSES_LIMITS.maxToolArgumentsBytes ||
      !parseJson(item.arguments).valid
    ) {
      throw new FdResponsesError("invalid_request");
    }
    return;
  }
  if (item.type === "function_call_output") {
    if (
      !validIdentifier(item.call_id, 128) ||
      byteLength(item.output) > FD_RESPONSES_LIMITS.maxToolOutputBytes
    ) {
      throw new FdResponsesError("invalid_request");
    }
    return;
  }
  validateOutputItem(item, "invalid_request");
}

function isMessageInputItem(item: FdResponsesInputItem): item is FdResponsesMessageInputItem {
  return (
    "role" in item &&
    (item.role === "user" || item.role === "assistant" || item.role === "developer")
  );
}

const FD_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function validateMessageContent(
  content: Extract<FdResponsesInputItem, { readonly role: string }>["content"],
): void;
function validateMessageContent(content: unknown): void {
  if (typeof content === "string") {
    if (byteLength(content) > FD_RESPONSES_LIMITS.maxTextBytes) {
      throw new FdResponsesError("invalid_request");
    }
    return;
  }
  if (
    !Array.isArray(content) ||
    content.length === 0 ||
    content.length > FD_RESPONSES_LIMITS.maxInputContentParts
  ) {
    throw new FdResponsesError("invalid_request");
  }
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") {
      throw new FdResponsesError("invalid_request");
    }
    if (part.type === "input_text") {
      if (
        Object.keys(part).some((key) => key !== "type" && key !== "text") ||
        typeof part.text !== "string" ||
        part.text.length === 0 ||
        byteLength(part.text) > FD_RESPONSES_LIMITS.maxTextBytes
      ) {
        throw new FdResponsesError("invalid_request");
      }
      continue;
    }
    if (part.type === "input_image") {
      if (
        Object.keys(part).some((key) => key !== "type" && key !== "image_url") ||
        typeof part.image_url !== "string" ||
        byteLength(part.image_url) > FD_RESPONSES_LIMITS.maxImageDataUrlBytes
      ) {
        throw new FdResponsesError("invalid_request");
      }
      const parsed = parseBase64DataUrl(part.image_url);
      if (
        !parsed ||
        !FD_SUPPORTED_IMAGE_MIME_TYPES.has(parsed.mimeType) ||
        decodedBase64Bytes(parsed.base64) < 1 ||
        decodedBase64Bytes(parsed.base64) > FD_RESPONSES_LIMITS.maxImageBytes
      ) {
        throw new FdResponsesError("invalid_request");
      }
      continue;
    }
    throw new FdResponsesError("invalid_request");
  }
}

function decodedBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function makeTools(request: FdResponsesRequest, validators: FdToolValidatorCache): ToolSet {
  try {
    return Object.fromEntries(
      (request.tools ?? []).map((definition) => {
        const validate = validators.validatorFor(definition);
        return [
          definition.name,
          tool({
            description: definition.description,
            inputSchema: jsonSchema(definition.parameters, {
              validate: makeToolInputValidator(validate),
            }),
            strict: true,
          }),
        ];
      }),
    );
  } catch {
    throw new FdResponsesError("invalid_request");
  }
}

function makeToolInputValidator(validate: ValidateFunction) {
  return (value: unknown) =>
    validate(value)
      ? { success: true as const, value }
      : {
          success: false as const,
          error: new Error("Tool input failed JSON Schema validation"),
        };
}

function makeExactFetch(
  fetchImplementation: Fetch,
  credentials: FdServerRuntimeCredentialProjection,
  request: FdResponsesRequest,
): Fetch {
  const endpoint = `${credentials.newApiOrigin}/v1/responses`;
  return async (input, init) => {
    if (String(input) !== endpoint || init?.method !== "POST" || typeof init.body !== "string") {
      throw new FdResponsesError("invalid_request");
    }
    let sdkBody: Record<string, unknown>;
    try {
      const decoded: unknown = JSON.parse(init.body);
      if (!isRecord(decoded)) throw new Error();
      sdkBody = decoded;
    } catch {
      throw new FdResponsesError("invalid_request");
    }
    const body = JSON.stringify({
      ...sdkBody,
      model: request.model,
      input: request.input,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      store: false,
      stream: true,
    });
    if (byteLength(body) > FD_RESPONSES_LIMITS.maxRequestBytes) {
      throw new FdResponsesError("invalid_request");
    }
    const response = await fetchImplementation(input, {
      ...init,
      body,
      redirect: "error",
    });
    return boundResponse(response);
  };
}

function boundResponse(response: Response): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let totalBytes = 0;
  let eventBytes = 0;
  let lineBytes = 0;
  let readerReleased = false;
  const releaseReader = () => {
    if (readerReleased) return;
    readerReleased = true;
    reader.releaseLock();
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          releaseReader();
          controller.close();
          return;
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > FD_RESPONSES_LIMITS.maxResponseBytes) {
          throw new FdResponsesError("response_too_large");
        }
        for (const byte of result.value) {
          if (byte === 0x0a) {
            if (lineBytes === 0) eventBytes = 0;
            else {
              eventBytes += lineBytes + 1;
              lineBytes = 0;
            }
          } else if (byte !== 0x0d) {
            lineBytes += 1;
            if (eventBytes + lineBytes > FD_RESPONSES_LIMITS.maxSseEventBytes) {
              throw new FdResponsesError("response_too_large");
            }
          }
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        try {
          await reader.cancel().catch(() => undefined);
        } finally {
          releaseReader();
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
      }
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function parseRawChunk(raw: unknown): RawChunkResult {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new FdResponsesError("malformed_response");
  }
  if (
    raw.type === "response.completed" ||
    raw.type === "response.incomplete" ||
    raw.type === "response.failed"
  ) {
    return {
      events: [],
      terminal:
        raw.type === "response.completed"
          ? "completed"
          : raw.type === "response.incomplete"
            ? "incomplete"
            : "failed",
    };
  }
  if (raw.type === "response.created") {
    if (
      !isRecord(raw.response) ||
      typeof raw.response.id !== "string" ||
      typeof raw.response.model !== "string"
    ) {
      throw new FdResponsesError("malformed_response");
    }
    return {
      events: [
        {
          type: "response-metadata",
          responseId: boundedIdentifier(raw.response.id, 256),
          model: boundedIdentifier(raw.response.model, 128),
        },
      ],
    };
  }
  if (raw.type !== "response.output_item.done") return { events: [] };
  if (!isRecord(raw.item)) throw new FdResponsesError("malformed_response");
  const item = validateOutputItem(raw.item, "malformed_response");
  if (item.type !== "function_call") {
    return { events: [{ type: "output-item", item }] };
  }
  const callId = boundedIdentifier(item.call_id, 128);
  const name = boundedIdentifier(item.name, 96);
  const argumentsJson = boundedString(item.arguments, FD_RESPONSES_LIMITS.maxToolArgumentsBytes);
  return {
    events: [],
    functionCall: {
      item,
      callId,
      name,
      argumentsJson,
    },
  };
}

function validateOutputItem(
  value: unknown,
  structuralKind: "invalid_request" | "malformed_response",
): FdResponsesOutputItem {
  const sizeKind = structuralKind === "invalid_request" ? "invalid_request" : "response_too_large";
  if (
    !isRecord(value) ||
    !["reasoning", "function_call", "message"].includes(String(value.type)) ||
    !validIdentifier(value.id, 256)
  ) {
    throw new FdResponsesError(structuralKind);
  }
  assertJsonBytes(value, FD_RESPONSES_LIMITS.maxTextBytes, sizeKind);
  validateBoundedOutputJson(value, 0, sizeKind);

  if (value.type === "message") validateMessageOutputItem(value, structuralKind);
  if (value.type === "reasoning") validateReasoningOutputItem(value, structuralKind);
  return value as unknown as FdResponsesOutputItem;
}

function validateMessageOutputItem(
  value: Record<string, unknown>,
  kind: "invalid_request" | "malformed_response",
): void {
  if (
    (value.phase !== undefined &&
      value.phase !== null &&
      value.phase !== "commentary" &&
      value.phase !== "final_answer") ||
    (value.role !== undefined && value.role !== "assistant") ||
    (value.status !== undefined && !validIdentifier(value.status, 32))
  ) {
    throw new FdResponsesError(kind);
  }
  if (value.content === undefined) return;
  if (!Array.isArray(value.content)) throw new FdResponsesError(kind);
  for (const part of value.content) {
    if (
      !isRecord(part) ||
      part.type !== "output_text" ||
      typeof part.text !== "string" ||
      byteLength(part.text) > FD_RESPONSES_LIMITS.maxTextBytes
    ) {
      throw new FdResponsesError(kind);
    }
  }
}

function validateReasoningOutputItem(
  value: Record<string, unknown>,
  kind: "invalid_request" | "malformed_response",
): void {
  if (
    (value.encrypted_content !== undefined &&
      value.encrypted_content !== null &&
      (typeof value.encrypted_content !== "string" ||
        byteLength(value.encrypted_content) > FD_RESPONSES_LIMITS.maxReasoningBytes)) ||
    (value.status !== undefined && !validIdentifier(value.status, 32))
  ) {
    throw new FdResponsesError(kind);
  }
  validateReasoningParts(value.summary, "summary_text", kind);
  validateReasoningParts(value.content, "reasoning_text", kind);
}

function validateReasoningParts(
  value: unknown,
  expectedType: "summary_text" | "reasoning_text",
  kind: "invalid_request" | "malformed_response",
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new FdResponsesError(kind);
  for (const part of value) {
    if (
      !isRecord(part) ||
      part.type !== expectedType ||
      typeof part.text !== "string" ||
      byteLength(part.text) > FD_RESPONSES_LIMITS.maxReasoningBytes
    ) {
      throw new FdResponsesError(kind);
    }
  }
}

function validateBoundedOutputJson(
  value: unknown,
  depth: number,
  kind: "invalid_request" | "response_too_large",
): void {
  if (depth > FD_RESPONSES_LIMITS.maxOutputItemDepth) {
    throw new FdResponsesError(kind);
  }
  if (typeof value === "string") {
    if (byteLength(value) > FD_RESPONSES_LIMITS.maxTextBytes) {
      throw new FdResponsesError(kind);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > FD_RESPONSES_LIMITS.maxOutputItemArrayItems) {
      throw new FdResponsesError(kind);
    }
    for (const item of value) validateBoundedOutputJson(item, depth + 1, kind);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (byteLength(key) > 256) throw new FdResponsesError(kind);
      validateBoundedOutputJson(item, depth + 1, kind);
    }
  }
}

function parseJson(
  value: string,
): { readonly valid: true; readonly value: unknown } | { readonly valid: false } {
  try {
    return { valid: true, value: JSON.parse(value) };
  } catch {
    return { valid: false };
  }
}

function addBoundedBytes(current: number, value: string, maximum: number): number {
  const next = current + byteLength(value);
  if (next > maximum) throw new FdResponsesError("response_too_large");
  return next;
}

function assertJsonBytes(
  value: unknown,
  maximum: number,
  kind: "invalid_request" | "response_too_large",
): void {
  const encoded = jsonStringify(value, kind);
  if (byteLength(encoded) > maximum) {
    throw new FdResponsesError(kind);
  }
}

function jsonStringify(value: unknown, kind: "invalid_request" | "response_too_large"): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error();
    return encoded;
  } catch {
    throw new FdResponsesError(kind);
  }
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || byteLength(value) > maximum) {
    throw new FdResponsesError("malformed_response");
  }
  return value;
}

function boundedIdentifier(value: unknown, maximum: number): string {
  const result = boundedString(value, maximum);
  if (result.length === 0) throw new FdResponsesError("malformed_response");
  return result;
}

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && byteLength(value) <= maximum;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeError(
  error: unknown,
  requestSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  credentialLease: CredentialLease,
): FdResponsesError {
  if (error instanceof FdResponsesError) return error;
  if (requestSignal?.aborted) return new FdResponsesError("cancelled");
  const credentialFailure = credentialLease.failure();
  if (credentialFailure !== undefined) return new FdResponsesError(credentialFailure);
  if (timeoutSignal.aborted) return new FdResponsesError("timeout");
  const status = errorStatus(error);
  if (status === 401) return new FdResponsesError("unauthorized", { status });
  if (status === 403) return new FdResponsesError("forbidden", { status });
  if (status === 429) return new FdResponsesError("rate_limited", { status });
  if (status !== undefined && status >= 500) {
    return new FdResponsesError("upstream_error", { status });
  }
  if (status !== undefined) return new FdResponsesError("malformed_response", { status });
  if (isAbortError(error)) return new FdResponsesError("cancelled");
  if (isProtocolError(error)) return new FdResponsesError("malformed_response");
  return new FdResponsesError("network_error");
}

function abortError(
  requestSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  credentialLease: CredentialLease,
): FdResponsesError {
  if (requestSignal?.aborted) return new FdResponsesError("cancelled");
  const credentialFailure = credentialLease.failure();
  if (credentialFailure !== undefined) return new FdResponsesError(credentialFailure);
  if (timeoutSignal.aborted) return new FdResponsesError("timeout");
  return new FdResponsesError("cancelled");
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.statusCode === "number") return error.statusCode;
  if (typeof error.status === "number") return error.status;
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isProtocolError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  return (
    name.includes("Parse") ||
    name.includes("Validation") ||
    name.includes("Invalid") ||
    name.includes("Response")
  );
}

function isResponseFailedError(error: unknown): boolean {
  return isRecord(error) && error.type === "response.failed";
}
