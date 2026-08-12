import { describe, expect, it, vi } from "@effect/vitest";

import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import { FdEnterpriseCodexClient } from "./FdEnterpriseCodexClient.ts";

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
const providerThreadId = "550e8400-e29b-41d4-a716-446655440001";
const turnId = "550e8400-e29b-41d4-a716-446655440002";
const releaseDigest = "a".repeat(64);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FdEnterpriseCodexClient", () => {
  it("loads an authorized runtime projection without sending authority inputs", async () => {
    const fetch = vi.fn(async (_url: URL, init?: RequestInit) =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          protocol: "fd-codex-runtime-v1",
          release_digest: releaseDigest,
          skill: {
            version_id: 9,
            version: "1.0.0",
            name: "company-database-query",
            display_name: "管理部数据查询",
            kind: "database",
            risk_tier: "high",
          },
          developer_instructions: "Use only authorized FD tools.",
          references: [],
          tools: [
            {
              name: "fd_data_list_resources",
              description: "List resources",
              input_schema: { type: "object", properties: {}, required: [] },
            },
          ],
        },
      }),
    );
    const client = new FdEnterpriseCodexClient({ credentials: async () => credentials, fetch });

    const context = await client.getRuntimeContext({ skillVersionId: 9, clientThreadId });

    expect(context.release_digest).toBe(releaseDigest);
    const request = fetch.mock.calls[0]![1]!;
    expect(request.headers).toMatchObject({ Authorization: "Bearer access-secret" });
    const body = String(request.body);
    expect(body).toContain('"skill_version_id":9');
    expect(body).not.toContain("user_id");
    expect(body).not.toContain("connector_id");
    expect(body).not.toContain("runtime-secret");
  });

  it("executes a bounded tool call and preserves audit metadata", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          tool_name: "fd_data_list_resources",
          audit_id: "audit-1",
          content: { resources: [] },
          row_count: 0,
          truncated: false,
        },
      }),
    );
    const client = new FdEnterpriseCodexClient({ credentials: async () => credentials, fetch });

    const result = await client.executeToolCall({
      skillVersionId: 9,
      releaseDigest,
      clientThreadId,
      providerThreadId,
      turnId,
      callId: "call-1",
      tool: "fd_data_list_resources",
      arguments: {},
    });

    expect(result.audit_id).toBe("audit-1");
    expect(result.content).toEqual({ resources: [] });
  });

  it("fails closed when the server returns a different tool", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          tool_name: "fd_data_query",
          audit_id: "audit-1",
          content: {},
        },
      }),
    );
    const client = new FdEnterpriseCodexClient({ credentials: async () => credentials, fetch });

    await expect(
      client.executeToolCall({
        skillVersionId: 9,
        releaseDigest,
        clientThreadId,
        providerThreadId,
        turnId,
        callId: "call-1",
        tool: "fd_data_list_resources",
        arguments: {},
      }),
    ).rejects.toMatchObject({ code: "invalid_tool_result" });
  });
});
