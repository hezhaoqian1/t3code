import {
  USAGE_CONTRACT_VERSION,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeUsage } from "./usageSummary";

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider: "fd-deepseek",
    model: "deepseek-v4-flash",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 2,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    ...overrides,
  };
}

function summary(
  buckets: readonly UsageBucket[],
  sources: readonly {
    provider: UsageProviderKind;
    distinctSessions?: number;
  }[] = [{ provider: "fd-deepseek" }],
): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets,
    sources: sources.map((source) => ({
      fingerprint: {
        hostId: "primary",
        provider: source.provider,
        resolvedHomePath: `/home/user/.${source.provider}`,
        volumeId: "primary-volume",
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: source.distinctSessions ?? 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "fd-runtime", fetchedAt: null, knownModels: 1 },
    scanDurationMs: 1,
  };
}

describe("summarizeUsage", () => {
  it("derives provider, model, and daily totals from the primary summary", () => {
    const totals = summarizeUsage(
      summary(
        [bucket({ costUsd: 75 }), bucket({ model: "deepseek-v4-flash-batch", costUsd: 25 })],
        [{ provider: "fd-deepseek" }],
      ),
    );

    expect(totals.costUsd).toBe(100);
    expect(totals.records).toBe(10);
    expect(totals.providers.map((provider) => provider.provider)).toEqual(["fd-deepseek"]);
    expect(totals.models.map((model) => model.model)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-batch",
    ]);
    expect(totals.daily).toHaveLength(1);
  });

  it("derives provider shares and cost quality", () => {
    const totals = summarizeUsage(
      summary([
        bucket({ costUsd: 75 }),
        bucket({
          model: "deepseek-v4-flash-batch",
          costUsd: 25,
          unpricedRecords: 5,
        }),
      ]),
    );

    expect(totals.providers[0]?.costShare).toBeCloseTo(1, 5);
    expect(totals.costQuality.unpricedShare).toBeCloseTo(0.5, 5);
    expect(totals.costQuality.cacheSavingsUsd).toBe(4);
  });

  it("uses per-source distinct session counts instead of bucket counts", () => {
    const totals = summarizeUsage(
      summary(
        [bucket({ day: "2026-08-06" as UsageDay }), bucket()],
        [{ provider: "fd-deepseek", distinctSessions: 1 }],
      ),
    );

    expect(totals.sessions).toBe(1);
  });

  it("returns empty totals without a summary", () => {
    const totals = summarizeUsage(null);
    expect(totals.costUsd).toBe(0);
    expect(totals.daily).toHaveLength(0);
  });
});
