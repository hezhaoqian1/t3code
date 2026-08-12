import { describe, expect, it } from "@effect/vitest";

import { initialCodexScanState, parseCodexLine, totalTokens } from "./usageTranscripts.ts";

const sessionMeta = JSON.stringify({
  type: "session_meta",
  timestamp: "2026-08-11T05:17:41.289Z",
  payload: { type: "session_meta", id: "019fbbc1-b12c-7360-a685-28c181f0025f" },
});

const turnContext = JSON.stringify({
  type: "turn_context",
  timestamp: "2026-08-11T05:17:42.694Z",
  payload: { type: "turn_context", model: "deepseek-chat" },
});

const tokenCount = (inputTokens: number, cached: number, output: number, reasoning: number) =>
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-08-11T05:17:49.919Z",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
        },
      },
    },
  });

describe("FD Codex transcript usage", () => {
  it("attributes App Server usage to the FD provider and active model", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);
    const record = parseCodexLine(tokenCount(19_239, 11_008, 299, 116), state);

    expect(record).toMatchObject({
      provider: "fd-deepseek",
      model: "deepseek-chat",
      sessionId: "019fbbc1-b12c-7360-a685-28c181f0025f",
      totals: {
        uncachedInputTokens: 8_231,
        cachedInputTokens: 11_008,
        outputTokens: 299,
        reasoningTokens: 116,
      },
    });
  });

  it("drops repeated token snapshots so Usage does not double count", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
  });

  it("does not add reasoning tokens twice", () => {
    expect(
      totalTokens({
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 30,
        outputTokens: 40,
        reasoningTokens: 25,
      }),
    ).toBe(100);
  });
});
