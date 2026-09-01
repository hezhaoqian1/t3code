import { describe, expect, it, vi } from "vite-plus/test";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import { FdDesktopFeedbackClient } from "./FdDesktopFeedbackClient.ts";

const credentials: FdServerRuntimeCredentialProjection = {
  userId: 1,
  runtimeTokenId: 2,
  newApiOrigin: "https://ai-api.example.com",
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

describe("FdDesktopFeedbackClient", () => {
  it("submits the exact rated pair with server-owned credentials", async () => {
    const fetch = vi.fn(
      async (_url: URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ success: true, data: { conversation_id: 7, message_id: 8 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new FdDesktopFeedbackClient({ credentials: async () => credentials, fetch });

    await expect(
      client.submit({
        clientThreadId: "c72c37fe-d6c0-43b4-9fae-e1a3e56261dd",
        clientMessageId: "assistant-1",
        rating: "dislike",
        userInput: "question",
        assistantOutput: "answer",
        model: "deepseek-chat",
        requestId: "assistant-1",
      }),
    ).resolves.toEqual({ conversationId: 7, messageId: 8, rating: "dislike" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.toString()).toBe("https://ai-api.example.com/api/agent/desktop/feedback");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer access-secret" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      client_thread_id: "c72c37fe-d6c0-43b4-9fae-e1a3e56261dd",
      client_message_id: "assistant-1",
      rating: "dislike",
      user_input: "question",
      assistant_output: "answer",
    });
  });

  it("sends an empty rating when feedback is cancelled", async () => {
    const fetch = vi.fn(
      async (_url: URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ success: true, data: { conversation_id: 7, message_id: 8 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new FdDesktopFeedbackClient({ credentials: async () => credentials, fetch });
    await client.submit({
      clientThreadId: "c72c37fe-d6c0-43b4-9fae-e1a3e56261dd",
      clientMessageId: "assistant-1",
      rating: null,
      userInput: "question",
      assistantOutput: "answer",
      model: "",
      requestId: "assistant-1",
    });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ rating: "" });
  });
});
