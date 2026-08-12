import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeStore } from "../fd/FdRuntimeCredentialStore.ts";
import { FdResponsesClient, FdToolValidatorCache } from "./FdResponsesClient.ts";
import {
  FD_RESPONSES_LIMITS,
  FD_RESPONSES_MODEL,
  FdResponsesError,
  appendFdResponsesFunctionOutputs,
  type FdResponsesEvent,
  type FdResponsesInputItem,
  type FdResponsesOutputItem,
} from "./FdResponsesProtocol.ts";

describe("FdResponsesClient", () => {
  it("streams text, public reasoning summary, usage, and exact model metadata", async () => {
    let credentialReads = 0;
    let requestBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-runtime-key");
      requestBody = JSON.parse(String(init?.body));
      return sseResponse(textAndReasoningEvents());
    });
    const client = new FdResponsesClient(
      {
        subscribe: Effect.sync(() => {
          credentialReads += 1;
          return { current: Option.some(credentials()), changes: Stream.never };
        }),
      },
      { fetch },
    );

    const events = await collect(
      client.stream({
        round: 1,
        input: [{ role: "user", content: "private prompt" }],
        instructions: "private instructions",
      }),
    );

    expect(credentialReads).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://ai-api.fdsure.com/v1/responses");
    expect(requestBody).toMatchObject({
      model: FD_RESPONSES_MODEL,
      input: [{ role: "user", content: "private prompt" }],
      instructions: "private instructions",
      stream: true,
      store: false,
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(requestBody).not.toHaveProperty("previous_response_id");
    expect(requestBody).not.toHaveProperty("conversation");
    expect(events).toContainEqual({
      type: "response-metadata",
      responseId: "resp-1",
      model: FD_RESPONSES_MODEL,
    });
    expect(events).toContainEqual({ type: "reasoning-delta", text: "Public summary." });
    expect(events).toContainEqual({ type: "text-delta", text: "Hello" });
    expect(events).toContainEqual({
      type: "usage",
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      reasoningTokens: 2,
    });
    expect(events.at(-1)).toEqual({ type: "completed", finishReason: "stop" });
  });

  it("preserves bounded text and image input in the exact stateless request", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new FdResponsesClient(reader(), {
      fetch: vi.fn(async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return sseResponse(textEvents("resp-image", "seen"));
      }),
    });
    const imageUrl = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;

    await collect(
      client.stream({
        round: 1,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "inspect" },
              { type: "input_image", image_url: imageUrl },
            ],
          },
        ],
      }),
    );

    expect(requestBody).toMatchObject({
      model: FD_RESPONSES_MODEL,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "inspect" },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    });
    expect(requestBody).not.toHaveProperty("previous_response_id");
  });

  it.each([
    ["non-image data URL", "data:text/plain;base64,dGVzdA=="],
    ["remote image URL", "https://images.invalid/private.png"],
    ["malformed base64", "data:image/png;base64,not-base64"],
  ] as const)("rejects %s before transport", async (_case, imageUrl) => {
    const fetch = vi.fn(async () => sseResponse(textEvents("unused", "unused")));
    const result = await collectFailure(
      new FdResponsesClient(reader(), { fetch }).stream({
        round: 1,
        input: [{ role: "user", content: [{ type: "input_image", image_url: imageUrl }] }],
      }),
    );
    expect(result.error).toMatchObject({ kind: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("publishes function calls only after SDK JSON and schema validation", async () => {
    const validClient = clientForResponse(sseResponse(functionCallEvents('{"value":7}')));
    const valid = await collect(
      validClient.stream({ round: 1, input: userInput(), tools: [probeTool()] }),
    );
    expect(valid).toContainEqual({
      type: "function-call",
      callId: "call-1",
      name: "fd_protocol_probe",
      argumentsJson: '{"value":7}',
      arguments: { valid: true, value: { value: 7 } },
    });
    expect(valid).toContainEqual({
      type: "function-call-arguments-delta",
      callId: "call-1",
      delta: '{"value":7}',
    });

    const malformedClient = clientForResponse(sseResponse(functionCallEvents('{"value":')));
    const malformed = await collectFailure(
      malformedClient.stream({ round: 1, input: userInput(), tools: [probeTool()] }),
    );
    expect(validFunctionCalls(malformed.events)).toEqual([]);
    expect(malformed.error).toMatchObject({ kind: "malformed_response" });
  });

  it.each([
    ["wrong argument type", '{"value":"seven"}', "fd_protocol_probe"],
    ["missing required argument", "{}", "fd_protocol_probe"],
    ["unknown tool", '{"value":7}', "unregistered_probe"],
  ] as const)("rejects %s before publishing a valid function call", async (_case, args, name) => {
    const result = await collectFailure(
      clientForResponse(sseResponse(functionCallEvents(args, name))).stream({
        round: 1,
        input: userInput(),
        tools: [probeTool()],
      }),
    );

    expect(validFunctionCalls(result.events)).toEqual([]);
    expect(result.error).toMatchObject({ kind: "malformed_response" });
  });

  it("rejects a schema-valid function call before publishing it when metadata is missing", async () => {
    const result = await collectFailure(
      clientForResponse(sseResponse(functionCallEvents('{"value":7}').slice(1))).stream({
        round: 1,
        input: userInput(),
        tools: [probeTool()],
      }),
    );

    expect(validFunctionCalls(result.events)).toEqual([]);
    expect(
      result.events.filter(
        (event) => event.type === "output-item" && event.item.type === "function_call",
      ),
    ).toEqual([]);
    expect(result.error).toMatchObject({ kind: "malformed_response" });
  });

  it.each([
    [
      "message",
      {
        type: "message",
        id: "msg-malformed",
        role: "assistant",
        content: [{ type: "output_text", text: 7 }],
      },
    ],
    [
      "reasoning",
      {
        type: "reasoning",
        id: "reasoning-malformed",
        summary: [{ type: "summary_text", text: false }],
      },
    ],
  ] as const)("rejects malformed %s output items before publishing them", async (_type, item) => {
    const result = await collectFailure(
      clientForResponse(
        sseResponse([
          created("resp-malformed-item"),
          { type: "response.output_item.done", output_index: 0, item },
          ...completed(),
        ]),
      ).stream({ round: 1, input: userInput() }),
    );

    expect(result.events.filter((event) => event.type === "output-item")).toEqual([]);
    expect(result.error).toMatchObject({ kind: "malformed_response" });
  });

  it("accepts response.incomplete and preserves the SDK max-token finish mapping", async () => {
    const events = await collect(
      clientForResponse(
        sseResponse([
          ...textEvents("resp-incomplete", "bounded", false),
          ...incomplete("max_output_tokens"),
        ]),
      ).stream({ round: 1, input: userInput() }),
    );

    expect(events.at(-1)).toEqual({ type: "completed", finishReason: "length" });
  });

  it("maps response.failed to an explicit upstream error", async () => {
    const result = await collectFailure(
      clientForResponse(
        sseResponse([...textEvents("resp-failed", "partial", false), ...failed()]),
      ).stream({ round: 1, input: userInput() }),
    );

    expect(result.error).toMatchObject({ kind: "upstream_error" });
    expect(result.error).not.toMatchObject({ kind: "premature_close" });
  });

  it("sends accumulated output items and function_call_output without response IDs", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new FdResponsesClient(reader(), {
      fetch: vi.fn(async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return sseResponse(textEvents("resp-2", "done"));
      }),
    });
    const outputItems: FdResponsesOutputItem[] = [
      {
        type: "reasoning",
        id: "reasoning-1",
        content: [{ type: "reasoning_text", text: "bounded prior reasoning" }],
      },
      {
        type: "function_call",
        id: "function-1",
        call_id: "call-1",
        name: "fd_protocol_probe",
        arguments: '{"value":7}',
        status: "completed",
      },
    ];
    const accumulated = appendFdResponsesFunctionOutputs(userInput(), outputItems, [
      { callId: "call-1", output: '{"ok":true}' },
    ]);

    await collect(client.stream({ round: 2, input: accumulated, tools: [probeTool()] }));

    expect(body?.input).toEqual([
      ...userInput(),
      ...outputItems,
      { type: "function_call_output", call_id: "call-1", output: '{"ok":true}' },
    ]);
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("conversation");
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "upstream_error"],
    [503, "upstream_error"],
  ] as const)("maps HTTP %s to %s without response body leakage", async (status, kind) => {
    const client = clientForResponse(
      new Response(
        JSON.stringify({ error: { message: "private upstream detail", type: "fd_error" } }),
        { status, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await collectFailure(client.stream({ round: 1, input: userInput() }));
    expect(result.error).toMatchObject({ kind, status });
    expect(result.error?.message).not.toContain("private upstream detail");
  });

  it("distinguishes caller cancellation from timeout", async () => {
    const cancellation = new AbortController();
    const cancelledClient = new FdResponsesClient(reader(), { fetch: abortableFetch() });
    const cancelled = collectFailure(
      cancelledClient.stream({ round: 1, input: userInput(), signal: cancellation.signal }),
    );
    queueMicrotask(() => cancellation.abort());
    await expect(cancelled).resolves.toMatchObject({ error: { kind: "cancelled" } });

    const timeoutClient = new FdResponsesClient(reader(), { fetch: abortableFetch() });
    await expect(
      collectFailure(timeoutClient.stream({ round: 1, input: userInput(), timeoutMs: 5 })),
    ).resolves.toMatchObject({ error: { kind: "timeout" } });
  });

  it.each(["clear", "replacement"] as const)(
    "invalidates an active request after credential %s",
    async (change) => {
      const store = await makePopulatedStore();
      const started = Promise.withResolvers<void>();
      const client = new FdResponsesClient(store.service, {
        fetch: abortableFetch(() => started.resolve()),
      });
      const pending = collectFailure(client.stream({ round: 1, input: userInput() }));
      await started.promise;

      if (change === "clear") {
        await Effect.runPromise(store.clear);
      } else {
        await Effect.runPromise(
          store.apply({
            version: 1,
            type: "set",
            credentials: {
              ...credentials(),
              runtimeApiKey: "replacement-runtime-key",
              generation: 2,
            },
          }),
        );
      }

      const result = await pending;
      expect(result.events.some((event) => event.type === "completed")).toBe(false);
      expect(result.error).toMatchObject({ kind: "credentials_invalidated" });
    },
  );

  it("continues an active request after a generation-only republish", async () => {
    const store = await makePopulatedStore();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const client = new FdResponsesClient(store.service, {
      fetch: vi.fn(async () => {
        started.resolve();
        return response.promise;
      }),
    });
    const pending = collectFailure(client.stream({ round: 1, input: userInput() }));
    await started.promise;

    await Effect.runPromise(
      store.apply({
        version: 1,
        type: "set",
        credentials: { ...credentials(), generation: 2 },
      }),
    );
    await Effect.runPromise(Effect.sleep("10 millis"));
    response.resolve(sseResponse(textEvents("resp-generation-refresh", "done")));

    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(result.events.at(-1)).toEqual({ type: "completed", finishReason: "stop" });
  });

  it("keeps listening after an equivalent refresh and aborts on a later replacement", async () => {
    const store = await makePopulatedStore();
    const started = Promise.withResolvers<void>();
    const onAbort = vi.fn();
    const client = new FdResponsesClient(store.service, {
      fetch: abortableFetch(() => started.resolve(), onAbort),
    });
    const pending = collectFailure(client.stream({ round: 1, input: userInput() }));
    await started.promise;

    await Effect.runPromise(
      store.apply({
        version: 1,
        type: "set",
        credentials: {
          ...credentials(),
          accessToken: "refreshed-access-token",
          accessExpiresAt: 2_000_000_100,
          policy: { ...credentials().policy, expiresAt: 2_000_000_100 },
          generation: 2,
        },
      }),
    );
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(onAbort).not.toHaveBeenCalled();

    await Effect.runPromise(
      store.apply({
        version: 1,
        type: "set",
        credentials: {
          ...credentials(),
          runtimeApiKey: "replacement-runtime-key",
          generation: 3,
        },
      }),
    );
    const result = await pending;
    expect(result.error).toMatchObject({ kind: "credentials_invalidated" });
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("uses a renewed deadline instead of the prior credential expiry", async () => {
    const startedAt = performance.now();
    const initial = credentials({ accessExpiresAt: 2, policyExpiresAt: 100 });
    const store = await makePopulatedStore(initial);
    const started = Promise.withResolvers<void>();
    const onAbort = vi.fn();
    const client = new FdResponsesClient(store.service, {
      now: () => 1_900 + (performance.now() - startedAt),
      fetch: abortableFetch(() => started.resolve(), onAbort),
    });
    const pending = collectFailure(client.stream({ round: 1, input: userInput() }));
    await started.promise;

    await Effect.runPromise(
      store.apply({
        version: 1,
        type: "set",
        credentials: {
          ...initial,
          accessToken: "renewed-access-token",
          accessExpiresAt: 10,
          generation: 2,
        },
      }),
    );
    await Effect.runPromise(Effect.sleep("150 millis"));
    expect(onAbort).not.toHaveBeenCalled();

    await Effect.runPromise(store.clear);
    const result = await pending;
    expect(result.error).toMatchObject({ kind: "credentials_invalidated" });
  });

  it("expires when an equivalent refresh shortens the deadline into the past", async () => {
    const initial = credentials({ accessExpiresAt: 100, policyExpiresAt: 100 });
    const store = await makePopulatedStore(initial);
    const started = Promise.withResolvers<void>();
    const client = new FdResponsesClient(store.service, {
      now: () => 5_000,
      fetch: abortableFetch(() => started.resolve()),
    });
    const pending = collectFailure(client.stream({ round: 1, input: userInput() }));
    await started.promise;

    await Effect.runPromise(
      store.apply({
        version: 1,
        type: "set",
        credentials: {
          ...initial,
          accessToken: "short-lived-access-token",
          accessExpiresAt: 4,
          generation: 2,
        },
      }),
    );

    const result = await pending;
    expect(result.error).toMatchObject({ kind: "credentials_expired" });
  });

  it("expires credentials during an active request with a distinct error", async () => {
    const startedAt = performance.now();
    const client = new FdResponsesClient(
      reader(credentials({ accessExpiresAt: 2, policyExpiresAt: 100 })),
      { now: () => 1_950 + (performance.now() - startedAt), fetch: abortableFetch() },
    );

    const result = await collectFailure(client.stream({ round: 1, input: userInput() }));
    expect(result.events.some((event) => event.type === "completed")).toBe(false);
    expect(result.error).toMatchObject({ kind: "credentials_expired" });
  });

  it("closes the credential subscription when the generator completes", async () => {
    let activeSubscriptions = 0;
    const subscribe = Effect.acquireRelease(
      Effect.sync(() => {
        activeSubscriptions += 1;
        return { current: Option.some(credentials()), changes: Stream.never };
      }),
      () =>
        Effect.sync(() => {
          activeSubscriptions -= 1;
        }),
    );
    const client = new FdResponsesClient(
      { subscribe },
      { fetch: vi.fn(async () => sseResponse(textEvents("resp-cleanup", "done"))) },
    );

    await collect(client.stream({ round: 1, input: userInput() }));
    expect(activeSubscriptions).toBe(0);
  });

  it("does not emit a terminal success when credentials clear between stream events", async () => {
    const store = await makePopulatedStore();
    const client = new FdResponsesClient(store.service, {
      fetch: vi.fn(async () => sseResponse(textEvents("resp-race", "done"))),
    });
    const iterator = client.stream({ round: 1, input: userInput() })[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({
      type: "response-metadata",
      responseId: "resp-race",
      model: FD_RESPONSES_MODEL,
    });

    await Effect.runPromise(store.clear);
    const result = await collectFailure({ [Symbol.asyncIterator]: () => iterator });
    expect(result.events.some((event) => event.type === "completed")).toBe(false);
    expect(result.error).toMatchObject({ kind: "credentials_invalidated" });
  });

  it("rejects premature close, malformed data, missing metadata, and wrong model identity", async () => {
    await expectKind(
      clientForResponse(sseResponse(textEvents("resp-short", "partial", false))),
      "premature_close",
    );
    await expectKind(
      clientForResponse(new Response("data: {not-json}\n\n", sseInit())),
      "malformed_response",
    );
    await expectKind(
      clientForResponse(
        new Response('data: {"type":"response.created","response":{"id":7}}\n\n', sseInit()),
      ),
      "malformed_response",
    );
    await expectKind(
      clientForResponse(sseResponse([created("resp-wrong", "another-model"), ...completed()])),
      "malformed_response",
    );
    await expectKind(
      clientForResponse(sseResponse(textEvents("resp-missing-metadata", "text").slice(1))),
      "malformed_response",
    );
  });

  it("bounds requests, rounds, SSE events, and credential/policy lifetime", async () => {
    const neverFetch = vi.fn(async () => sseResponse(textEvents("unused", "unused")));
    const client = new FdResponsesClient(reader(), { fetch: neverFetch });
    await expectKind(client, "invalid_request", {
      round: FD_RESPONSES_LIMITS.maxRounds + 1,
      input: userInput(),
    });
    await expectKind(client, "invalid_request", {
      round: 1,
      input: [
        { role: "user", content: "hi" },
        {
          type: "function_call_output",
          call_id: "missing-call",
          output: "x".repeat(FD_RESPONSES_LIMITS.maxToolOutputBytes + 1),
        },
      ],
    });
    expect(neverFetch).not.toHaveBeenCalled();

    const oversizedClient = clientForResponse(
      sseResponse([
        created("resp-large"),
        { type: "response.output_text.delta", item_id: "msg-1", delta: "x".repeat(300_000) },
      ]),
    );
    await expectKind(oversizedClient, "response_too_large");

    const expiredClient = new FdResponsesClient(
      reader(credentials({ accessExpiresAt: 1, policyExpiresAt: 1 })),
      { now: () => 2_000, fetch: neverFetch },
    );
    await expectKind(expiredClient, "credentials_expired");
    const unavailable = new FdResponsesClient({
      subscribe: Effect.succeed({ current: Option.none(), changes: Stream.never }),
    });
    await expectKind(unavailable, "credentials_unavailable");
    const invalidPolicy = new FdResponsesClient(
      reader({
        ...credentials(),
        policy: { ...credentials().policy, model: "deepseek-v4-flash-alias" },
      } as unknown as FdServerRuntimeCredentialProjection),
    );
    await expectKind(invalidPolicy, "policy_invalid");
  });

  it("rejects aggregate tool schemas before compilation", async () => {
    const cache = new FdToolValidatorCache(2);
    const neverFetch = vi.fn(async () => sseResponse(textEvents("unused", "unused")));
    const schemaPadding = "x".repeat(FD_RESPONSES_LIMITS.maxToolDefinitionsBytes / 2);
    const client = new FdResponsesClient(reader(), {
      fetch: neverFetch,
      toolValidatorCache: cache,
    });

    const result = await collectFailure(
      client.stream({
        round: 1,
        input: userInput(),
        tools: [
          { ...probeTool(), name: "large_probe_one", parameters: largeSchema(schemaPadding) },
          { ...probeTool(), name: "large_probe_two", parameters: largeSchema(schemaPadding) },
        ],
      }),
    );

    expect(result.error).toMatchObject({ kind: "invalid_request" });
    expect(cache.size).toBe(0);
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it("reuses tool validators and bounds the LRU cache", () => {
    const cache = new FdToolValidatorCache(2);
    const first = cache.validatorFor(probeTool());
    expect(cache.validatorFor(probeTool())).toBe(first);

    const renamed = { ...probeTool(), name: "renamed_probe" };
    expect(cache.validatorFor(renamed)).not.toBe(first);
    cache.validatorFor({ ...probeTool(), name: "third_probe" });
    expect(cache.size).toBe(2);
    expect(cache.validatorFor(probeTool())).not.toBe(first);
    expect(cache.size).toBe(2);
  });
});

function credentials(
  overrides: { accessExpiresAt?: number; policyExpiresAt?: number } = {},
): FdServerRuntimeCredentialProjection {
  return {
    userId: 31,
    runtimeTokenId: 41,
    newApiOrigin: "https://ai-api.fdsure.com",
    runtimeApiKey: "test-runtime-key",
    accessToken: "test-access-token",
    accessExpiresAt: overrides.accessExpiresAt ?? 2_000_000_000,
    policy: {
      version: 1,
      capability: "general_assistant",
      model: FD_RESPONSES_MODEL,
      expiresAt: overrides.policyExpiresAt ?? 2_000_000_000,
    },
    generation: 1,
  };
}

function reader(value = credentials()) {
  return {
    subscribe: Effect.succeed({ current: Option.some(value), changes: Stream.never }),
  };
}

function clientForResponse(response: Response): FdResponsesClient {
  return new FdResponsesClient(reader(), { fetch: vi.fn(async () => response) });
}

function userInput(): FdResponsesInputItem[] {
  return [{ role: "user", content: "run the protocol probe" }];
}

function probeTool() {
  return {
    name: "fd_protocol_probe",
    description: "Returns a deterministic bounded protocol result.",
    parameters: {
      type: "object" as const,
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    },
  };
}

function largeSchema(padding: string) {
  return {
    type: "object" as const,
    description: padding,
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  };
}

async function makePopulatedStore(value = credentials()) {
  const store = await Effect.runPromise(makeStore());
  await Effect.runPromise(store.apply({ version: 1, type: "set", credentials: value }));
  return store;
}

async function collect(stream: AsyncIterable<FdResponsesEvent>): Promise<FdResponsesEvent[]> {
  const events: FdResponsesEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function collectFailure(stream: AsyncIterable<FdResponsesEvent>): Promise<{
  events: FdResponsesEvent[];
  error: FdResponsesError | undefined;
}> {
  const events: FdResponsesEvent[] = [];
  try {
    for await (const event of stream) events.push(event);
    return { events, error: undefined };
  } catch (error) {
    return { events, error: error instanceof FdResponsesError ? error : undefined };
  }
}

function validFunctionCalls(events: ReadonlyArray<FdResponsesEvent>): FdResponsesEvent[] {
  return events.filter((event) => event.type === "function-call" && event.arguments.valid);
}

async function expectKind(
  client: FdResponsesClient,
  kind: FdResponsesError["kind"],
  request: { round: number; input: ReadonlyArray<FdResponsesInputItem> } = {
    round: 1,
    input: userInput(),
  },
): Promise<void> {
  await expect(collectFailure(client.stream(request))).resolves.toMatchObject({ error: { kind } });
}

function sseResponse(events: ReadonlyArray<unknown>): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, sseInit());
}

function sseInit(): ResponseInit {
  return { status: 200, headers: { "content-type": "text/event-stream" } };
}

function created(id: string, model: string = FD_RESPONSES_MODEL) {
  return {
    type: "response.created",
    response: { id, created_at: 1_800_000_000, model },
  };
}

function completed() {
  return [
    {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
  ];
}

function incomplete(reason: string) {
  return [
    {
      type: "response.incomplete",
      response: {
        incomplete_details: { reason },
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
  ];
}

function failed() {
  return [
    {
      type: "response.failed",
      sequence_number: 8,
      response: {
        error: null,
        incomplete_details: null,
        usage: {
          input_tokens: 12,
          output_tokens: 2,
          output_tokens_details: { reasoning_tokens: 1 },
        },
      },
    },
  ];
}

function textEvents(id: string, text: string, terminal = true): unknown[] {
  const events: unknown[] = [
    created(id),
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-1" } },
    { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, delta: text },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg-1",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    },
  ];
  if (terminal) events.push(...completed());
  return events;
}

function textAndReasoningEvents(): unknown[] {
  return [
    created("resp-1"),
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: "reasoning-1" },
    },
    {
      type: "response.reasoning_summary_part.added",
      item_id: "reasoning-1",
      output_index: 0,
      summary_index: 0,
    },
    {
      type: "response.reasoning_summary_text.delta",
      item_id: "reasoning-1",
      output_index: 0,
      summary_index: 0,
      delta: "Public summary.",
    },
    {
      type: "response.reasoning_summary_part.done",
      item_id: "reasoning-1",
      output_index: 0,
      summary_index: 0,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: "reasoning-1",
        content: [{ type: "reasoning_text", text: "Public summary." }],
      },
    },
    ...textEvents("resp-ignored", "Hello").slice(1),
  ];
}

function functionCallEvents(argumentsJson: string, name: string = "fd_protocol_probe"): unknown[] {
  return [
    created("resp-tool"),
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: "function-1",
        call_id: "call-1",
        name,
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "function-1",
      output_index: 0,
      delta: argumentsJson,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: "function-1",
        call_id: "call-1",
        name,
        arguments: argumentsJson,
        status: "completed",
      },
    },
    ...completed(),
  ];
}

function abortableFetch(
  onStart: () => void = () => undefined,
  onAbort: () => void = () => undefined,
) {
  return vi.fn(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        onStart();
        const rejectAbort = () => {
          onAbort();
          reject(new DOMException("aborted", "AbortError"));
        };
        if (init?.signal?.aborted) rejectAbort();
        else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
      }),
  );
}
