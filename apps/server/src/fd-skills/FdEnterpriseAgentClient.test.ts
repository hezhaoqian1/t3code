import { describe, expect, it, vi } from "@effect/vitest";

import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import {
  FdEnterpriseAgentClient,
  FdEnterpriseAgentError,
  FdSkillCatalog,
  parseFdEnterpriseHistory,
  parseFdEnterpriseAgentStream,
  parseFdSkillCatalog,
} from "./FdEnterpriseAgentClient.ts";

const credentials: FdServerRuntimeCredentialProjection = {
  userId: 7,
  runtimeTokenId: 45,
  newApiOrigin: "https://fd.invalid",
  runtimeApiKey: "runtime-secret",
  accessToken: "access-secret",
  accessExpiresAt: 4_102_444_800,
  policy: {
    version: 1,
    capability: "general_assistant",
    model: "deepseek-v4-flash",
    expiresAt: 4_102_444_800,
  },
  generation: 1,
};

const clientThreadId = "550e8400-e29b-41d4-a716-446655440000";
const enterpriseTurnId = "550e8400-e29b-41d4-a716-446655440001";

function stream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

const terminalStream = [
  `event: turn.started\ndata: {"turn_id":"${enterpriseTurnId}","conversation_id":0,"model":"deepseek-v4-flash"}\n\n`,
  `event: assistant.delta\ndata: {"turn_id":"${enterpriseTurnId}","delta":"done"}\n\n`,
  `event: turn.completed\ndata: {"turn_id":"${enterpriseTurnId}","message":{"id":10,"conversation_id":0,"role":"assistant","text":"done","created_at":1786320000},"tool_calls":0,"usage":{"input_tokens":2,"output_tokens":1}}\n\n`,
].join("");

describe("FdEnterpriseAgentClient", () => {
  it("bounds catalog requests with the client timeout", async () => {
    const fetch = vi.fn(
      async (_url: URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const client = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch,
      requestTimeoutMs: 5,
    });

    await expect(client.getCatalog()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sends the Desktop trust-boundary request without runtime secret or local policy", async () => {
    const fetch = vi.fn(
      async (_url: URL, init?: RequestInit) =>
        new Response(stream(terminalStream), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    const client = new FdEnterpriseAgentClient({ credentials: async () => credentials, fetch });
    const events = [];
    for await (const event of client.streamTurn({
      clientThreadId,
      skillVersionId: 10004,
      message: "hello",
      idempotencyKey: "turn_1234567890123456",
    }))
      events.push(event);

    const init = fetch.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      client_thread_id: "550e8400-e29b-41d4-a716-446655440000",
      model: "deepseek-v4-flash",
      token_id: 45,
      skill_version_ids: [10004],
      message: "hello",
      client: "fd_desktop",
    });
    expect(JSON.stringify(body)).not.toContain(credentials.runtimeApiKey);
    expect(init.headers).toMatchObject({ Authorization: "Bearer access-secret" });
    expect(events.at(-1)?.type).toBe("turn.completed");
  });

  it("loads only display/version metadata and exact model capability", async () => {
    const parsed = parseFdSkillCatalog({
      data: {
        skills: [
          {
            id: 4,
            version_id: 10004,
            name: "company-database-query",
            display_name: "管理部数据查询",
            description: "query",
            kind: "database",
            risk_tier: "high",
            instructions: "must-not-store",
            resources: ["view-secret"],
          },
        ],
        model_capabilities: {
          "deepseek-v4-flash": {
            fd_skills: true,
            fd_skill_protocol: "enterprise-agent-v1",
            view_policy: "secret",
          },
        },
      },
    });
    expect(parsed.skills[0]).toEqual({
      id: 4,
      versionId: 10004,
      name: "company-database-query",
      displayName: "管理部数据查询",
      description: "query",
      kind: "database",
      riskTier: "high",
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-store");
    expect(JSON.stringify(parsed)).not.toContain("view-secret");
    const catalog = new FdSkillCatalog({
      getCatalog: async () => parsed,
    } as FdEnterpriseAgentClient);
    await catalog.refresh();
    expect(catalog.authorized).toBe(true);
    expect(catalog.findVersion(10004)?.name).toBe("company-database-query");
  });

  it("loads bounded server-authoritative Desktop history without reasoning or tool metadata", async () => {
    const parsed = parseFdEnterpriseHistory({
      data: {
        client_thread_id: "550e8400-e29b-41d4-a716-446655440000",
        conversation_id: 0,
        truncated: false,
        messages: [
          {
            id: 1,
            conversation_id: 0,
            role: "user",
            text: "查询客户持仓",
            created_at: 1786320000,
            reasoning: "must-not-expose",
          },
          {
            id: 2,
            conversation_id: 0,
            role: "assistant",
            text: "查询结果",
            created_at: 1786320001,
            audit_id: "must-not-expose",
          },
        ],
      },
    });
    expect(parsed.messages).toEqual([
      {
        id: 1,
        conversationId: 0,
        role: "user",
        text: "查询客户持仓",
        createdAt: "2026-08-10T00:00:00.000Z",
      },
      {
        id: 2,
        conversationId: 0,
        role: "assistant",
        text: "查询结果",
        createdAt: "2026-08-10T00:00:01.000Z",
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("must-not-expose");
  });

  it("requests Desktop history by UUID and keeps it out of the local skill catalog", async () => {
    const fetch = vi.fn(
      async (url: URL, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              client_thread_id: "550e8400-e29b-41d4-a716-446655440000",
              conversation_id: 0,
              messages: [],
              truncated: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new FdEnterpriseAgentClient({ credentials: async () => credentials, fetch });
    const history = await client.getHistory(clientThreadId);
    expect(history?.messages).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        "/api/agent/desktop/threads/550e8400-e29b-41d4-a716-446655440000/history",
        credentials.newApiOrigin,
      ),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-secret" }),
      }),
    );
  });

  it("classifies only a confirmed missing Desktop history as absent", async () => {
    const missing = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () => new Response(null, { status: 404 }),
    });
    await expect(missing.getHistory(clientThreadId)).resolves.toBeUndefined();

    const transient = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () => new Response(null, { status: 503 }),
    });
    await expect(transient.getHistory(clientThreadId)).rejects.toMatchObject({
      code: "history_http_error",
      status: 503,
    });
  });

  it("rejects oversized catalog and history responses before buffering the full body", async () => {
    const oversized = (bytes: number) =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(bytes));
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const catalog = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () => oversized(600 * 1_024),
    });
    await expect(catalog.getCatalog()).rejects.toMatchObject({ code: "catalog_too_large" });

    const history = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () => oversized(600 * 1_024),
    });
    await expect(history.getHistory(clientThreadId)).rejects.toMatchObject({
      code: "history_too_large",
    });
  });

  it("rejects a successful history response with no messages array", () => {
    let error: unknown;
    try {
      parseFdEnterpriseHistory({
        data: {
          client_thread_id: clientThreadId,
          conversation_id: 0,
          truncated: false,
        },
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: "invalid_history" });
  });

  it("ignores events after the first terminal event", async () => {
    const events = [];
    for await (const event of parseFdEnterpriseAgentStream(
      stream(
        `${terminalStream}event: assistant.delta\ndata: {"turn_id":"${enterpriseTurnId}","delta":"late"}\n\n`,
      ),
    ))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "assistant.delta",
      "turn.completed",
    ]);
  });

  it.each([
    [
      "missing terminal",
      `event: assistant.delta\ndata: {"turn_id":"${enterpriseTurnId}","delta":"x"}\n\n`,
      "incomplete_stream",
    ],
    [
      "unsupported event",
      `event: raw.sql\ndata: {"turn_id":"${enterpriseTurnId}"}\n\n`,
      "unsupported_event",
    ],
    [
      "invalid event",
      'event: turn.started\ndata: {"turn_id":"","conversation_id":0,"model":"x"}\n\n',
      "invalid_event",
    ],
  ])("rejects %s", async (_label, input, code) => {
    const run = async () => {
      for await (const _event of parseFdEnterpriseAgentStream(stream(input))) void _event;
    };
    await expect(run()).rejects.toMatchObject({ code } satisfies Partial<FdEnterpriseAgentError>);
  });

  it("rejects stale credentials and invalid Desktop IDs before network access", async () => {
    const fetch = vi.fn();
    const client = new FdEnterpriseAgentClient({
      credentials: async () => ({ ...credentials, accessExpiresAt: 1 }),
      fetch,
    });
    const run = async () => {
      for await (const _event of client.streamTurn({
        clientThreadId: "bad",
        skillVersionId: 1,
        message: "x",
        idempotencyKey: "short",
      }))
        void _event;
    };
    await expect(run()).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when Desktop history identity does not match the request or conversation", async () => {
    const responseFor = (data: Record<string, unknown>) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const mismatchedThread = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () =>
        responseFor({
          client_thread_id: "550e8400-e29b-41d4-a716-446655440099",
          conversation_id: 7,
          messages: [],
          truncated: false,
        }),
    });
    await expect(mismatchedThread.getHistory(clientThreadId)).rejects.toMatchObject({
      code: "invalid_history",
    });

    const mismatchedConversation = new FdEnterpriseAgentClient({
      credentials: async () => credentials,
      fetch: async () =>
        responseFor({
          client_thread_id: clientThreadId,
          conversation_id: 7,
          messages: [
            {
              id: 1,
              conversation_id: 8,
              role: "assistant",
              text: "wrong conversation",
              created_at: 1_786_320_000,
            },
          ],
          truncated: false,
        }),
    });
    await expect(mismatchedConversation.getHistory(clientThreadId)).rejects.toMatchObject({
      code: "invalid_history",
    });
  });

  it("accepts only event-specific bounded IDs and the documented pre-start failure key", async () => {
    const run = async (input: string) => {
      const events = [];
      for await (const event of parseFdEnterpriseAgentStream(stream(input))) events.push(event);
      return events;
    };
    await expect(
      run(
        'event: turn.started\ndata: {"turn_id":"not-a-uuid","conversation_id":0,"model":"deepseek-v4-flash"}\n\n',
      ),
    ).rejects.toMatchObject({ code: "invalid_event" });
    await expect(
      run(
        `event: turn.started\ndata: {"turn_id":"${enterpriseTurnId}","conversation_id":0,"model":"deepseek-v4-flash"}\n\nevent: tool.started\ndata: {"turn_id":"${enterpriseTurnId}","call_id":"${"x".repeat(129)}","tool":"fd_data_query","tool_class":"data_read","label":"query"}\n\n`,
      ),
    ).rejects.toMatchObject({ code: "invalid_event" });
    await expect(
      run(
        `event: turn.started\ndata: {"turn_id":"${enterpriseTurnId}","conversation_id":0,"model":"deepseek-v4-flash"}\n\nevent: tool.started\ndata: {"turn_id":"${enterpriseTurnId}","call_id":"call-1","tool":"fd_data_query","tool_class":"data_read","label":"query"}\n\nevent: tool.completed\ndata: {"turn_id":"${enterpriseTurnId}","call_id":"call-1","tool":"fd_data_query","tool_class":"data_read","status":"succeeded","audit_id":"${"a".repeat(129)}"}\n\n`,
      ),
    ).rejects.toMatchObject({ code: "invalid_event" });

    await expect(
      run(
        'event: turn.failed\ndata: {"turn_id":"turn_1234567890123456","code":"agent_request_invalid","message":"invalid","retryable":false,"user_message_persisted":false}\n\n',
      ),
    ).resolves.toMatchObject([{ type: "turn.failed", turnId: "turn_1234567890123456" }]);
    await expect(
      run(
        `event: turn.started\ndata: {"turn_id":"${enterpriseTurnId}","conversation_id":0,"model":"deepseek-v4-flash","replayed":true}\n\nevent: turn.completed\ndata: {"turn_id":"${enterpriseTurnId}","replayed":true,"message":{"id":10,"conversation_id":0,"role":"assistant","text":"done","created_at":1786320000},"tool_calls":1,"usage":{"input_tokens":2,"output_tokens":1}}\n\n`,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ type: "turn.started", replayed: true }),
      expect.objectContaining({ type: "turn.completed", replayed: true, toolCalls: 1 }),
    ]);
  });
});
