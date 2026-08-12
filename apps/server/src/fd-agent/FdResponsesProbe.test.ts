import { FdResponsesError, type FdResponsesEvent } from "./FdResponsesProtocol.ts";
import { readProbeCredentials, runFdResponsesProbe } from "./FdResponsesProbe.ts";
import { Readable } from "node:stream";
import { describe, expect, it } from "vite-plus/test";

describe("FD Responses real probe", () => {
  it("reports only a redacted capability matrix", async () => {
    let call = 0;
    const client = {
      async *stream(request: { signal?: AbortSignal }): AsyncGenerator<FdResponsesEvent> {
        call += 1;
        yield {
          type: "response-metadata",
          responseId: `response-${call}`,
          model: "deepseek-v4-flash",
        };
        if (call === 1) {
          yield { type: "reasoning-delta", text: "private reasoning summary" };
          yield { type: "text-delta", text: "private response" };
          yield { type: "usage", inputTokens: 2, outputTokens: 3 };
          yield { type: "completed", finishReason: "stop" };
          return;
        }
        if (call === 2) {
          yield {
            type: "output-item",
            item: {
              type: "function_call",
              call_id: "call-1",
              name: "fd_protocol_probe",
              arguments: '{"value":7}',
            },
          };
          yield {
            type: "function-call",
            callId: "call-1",
            name: "fd_protocol_probe",
            argumentsJson: '{"value":7}',
            arguments: { valid: true, value: { value: 7 } },
          };
          yield { type: "completed", finishReason: "tool-calls" };
          return;
        }
        if (call === 3) {
          yield { type: "text-delta", text: "private final response" };
          yield { type: "completed", finishReason: "stop" };
          return;
        }
        if (request.signal) {
          await new Promise<void>((resolve) => {
            if (request.signal?.aborted) resolve();
            else request.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        throw new FdResponsesError("cancelled");
      },
    };

    const matrix = await runFdResponsesProbe(client);
    expect(matrix).toEqual({
      status: "PASS",
      exactModelIdentity: true,
      textStreaming: true,
      usage: true,
      reasoningSummary: "emitted",
      deterministicFunctionCall: true,
      statelessFunctionOutputRound: true,
      cancellation: true,
    });
    expect(JSON.stringify(matrix)).not.toContain("private");
    expect(JSON.stringify(matrix)).not.toContain("call-1");
  });

  it("decodes the private stdin projection without accepting renderer-safe substitutes", async () => {
    const credentials = await readProbeCredentials(
      Readable.from([
        JSON.stringify({
          userId: 31,
          runtimeTokenId: 41,
          newApiOrigin: "http://127.0.0.1:3001",
          runtimeApiKey: "test-runtime-key",
          accessToken: "test-access-token",
          accessExpiresAt: 2_000_000_000,
          policy: {
            version: 1,
            capability: "general_assistant",
            model: "deepseek-v4-flash",
            expiresAt: 2_000_000_000,
          },
          generation: 1,
        }),
      ]),
    );
    expect(credentials.newApiOrigin).toBe("http://127.0.0.1:3001");
    await expect(
      readProbeCredentials(Readable.from([JSON.stringify({ model: "deepseek-v4-flash" })])),
    ).rejects.toMatchObject({ kind: "invalid_request" });
  });
});
