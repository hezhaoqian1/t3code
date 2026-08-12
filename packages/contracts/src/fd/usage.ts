import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const FdUsagePeriod = Schema.Struct({
  limit: NonNegativeNumber,
  used: NonNegativeNumber,
  reserved: NonNegativeNumber,
  remaining: NonNegativeNumber,
  unlimited: Schema.Boolean,
  resetsAt: NonNegativeInt,
}).annotate(strict);
export type FdUsagePeriod = typeof FdUsagePeriod.Type;

export const FdUsageDailyPoint = Schema.Struct({
  day: NonNegativeInt,
  tokens: NonNegativeInt,
}).annotate(strict);
export type FdUsageDailyPoint = typeof FdUsageDailyPoint.Type;

export const FdUsageModelPoint = Schema.Struct({
  model: TrimmedNonEmptyString,
  tokens: NonNegativeInt,
}).annotate(strict);
export type FdUsageModelPoint = typeof FdUsageModelPoint.Type;

export const FdUsageSummary = Schema.Struct({
  readAt: TrimmedNonEmptyString,
  quota: NonNegativeNumber,
  promptTokens: NonNegativeInt,
  completionTokens: NonNegativeInt,
  requestCount: NonNegativeInt,
  failedCount: NonNegativeInt,
  rpm: NonNegativeNumber,
  tpm: NonNegativeNumber,
  averageUseTime: NonNegativeNumber,
  daily: Schema.Array(FdUsageDailyPoint),
  models: Schema.Array(FdUsageModelPoint),
  dailyQuota: FdUsagePeriod,
  monthlyQuota: FdUsagePeriod,
  quotaPerUnit: NonNegativeNumber,
  usdExchangeRate: NonNegativeNumber,
}).annotate(strict);
export type FdUsageSummary = typeof FdUsageSummary.Type;

export const FdUsageGetSummaryPayload = Schema.Void;
export const FdUsageGetSummaryResponse = FdUsageSummary;
