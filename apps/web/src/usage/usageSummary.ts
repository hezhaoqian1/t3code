/**
 * Derives renderer totals from the primary local service's usage summary.
 *
 * @module usageSummary
 */
import type { UsageBucket, UsageProviderKind, UsageSummary } from "@t3tools/contracts";

export interface ProviderTotals {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface UsageTotals {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly costQuality: CostQuality;
}

function bucketTokens(bucket: UsageBucket): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

const EMPTY_USAGE: UsageTotals = {
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  models: [],
  daily: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
};

export function summarizeUsage(summary: UsageSummary | null): UsageTotals {
  if (summary === null) return EMPTY_USAGE;

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let cacheSavingsUsd = 0;
  let providerReportedRecords = 0;
  let unpricedRecords = 0;

  const providerAccumulator = new Map<
    UsageProviderKind,
    { costUsd: number; totalTokens: number; records: number }
  >();
  const modelAccumulator = new Map<
    string,
    { provider: UsageProviderKind; costUsd: number; totalTokens: number; records: number }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();

  for (const bucket of summary.buckets) {
    const tokens = bucketTokens(bucket);

    costUsd += bucket.costUsd;
    cacheSavingsUsd += bucket.cacheSavingsUsd;
    uncachedInputTokens += bucket.totals.uncachedInputTokens;
    cachedInputTokens += bucket.totals.cachedInputTokens;
    cacheCreationTokens += bucket.totals.cacheCreationTokens;
    outputTokens += bucket.totals.outputTokens;
    reasoningTokens += bucket.totals.reasoningTokens;
    records += bucket.records;
    unpricedRecords += bucket.unpricedRecords;
    if (bucket.costSource === "providerReported") providerReportedRecords += bucket.records;

    const provider = providerAccumulator.get(bucket.provider) ?? {
      costUsd: 0,
      totalTokens: 0,
      records: 0,
    };
    provider.costUsd += bucket.costUsd;
    provider.totalTokens += tokens;
    provider.records += bucket.records;
    providerAccumulator.set(bucket.provider, provider);

    const modelKey = `${bucket.provider} ${bucket.model}`;
    const model = modelAccumulator.get(modelKey) ?? {
      provider: bucket.provider,
      costUsd: 0,
      totalTokens: 0,
      records: 0,
    };
    model.costUsd += bucket.costUsd;
    model.totalTokens += tokens;
    model.records += bucket.records;
    modelAccumulator.set(modelKey, model);

    const day = dailyAccumulator.get(bucket.day) ?? {
      costUsd: 0,
      totalTokens: 0,
      byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
    };
    day.costUsd += bucket.costUsd;
    day.totalTokens += tokens;
    const dayProvider = day.byProvider.get(bucket.provider) ?? { costUsd: 0, totalTokens: 0 };
    dayProvider.costUsd += bucket.costUsd;
    dayProvider.totalTokens += tokens;
    day.byProvider.set(bucket.provider, dayProvider);
    dailyAccumulator.set(bucket.day, day);
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
  const providers: ProviderTotals[] = [...providerAccumulator.entries()]
    .map(([provider, totals]) => ({
      provider,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
      tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const models: ModelTotals[] = [...modelAccumulator.entries()]
    .map(([key, totals]) => ({
      model: key.slice(key.indexOf(" ") + 1),
      provider: totals.provider,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
  const daily: DailyTotals[] = [...dailyAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const sessions = summary.sources.reduce(
    (total, source) => total + (source.status === "missing" ? 0 : source.distinctSessions),
    0,
  );

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions,
    providers,
    models,
    daily,
    costQuality: {
      providerReportedShare: records === 0 ? 0 : providerReportedRecords / records,
      unpricedShare: records === 0 ? 0 : unpricedRecords / records,
      modelPricedShare:
        records === 0 ? 0 : (records - providerReportedRecords - unpricedRecords) / records,
      cacheSavingsUsd,
    },
  };
}
