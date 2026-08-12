/**
 * Display formatting for the usage page.
 *
 * @module usageFormat
 */
import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";

const CURRENCY = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("zh-CN");

const DEFAULT_QUOTA_PER_UNIT = 500_000;
const DEFAULT_USD_EXCHANGE_RATE = 7.3;
const AI_CREDITS_PER_CNY = 10_000;

export function formatQuotaAiCredits(
  quotaUnits: number,
  quotaPerUnit = DEFAULT_QUOTA_PER_UNIT,
  usdExchangeRate = DEFAULT_USD_EXCHANGE_RATE,
): string {
  const units = Number.isFinite(quotaUnits) ? Math.max(0, quotaUnits) : 0;
  const perUnit = quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT;
  const exchangeRate = usdExchangeRate > 0 ? usdExchangeRate : DEFAULT_USD_EXCHANGE_RATE;
  const credits = Math.max(0, Math.round((units / perUnit) * exchangeRate * AI_CREDITS_PER_CNY));
  return `${INTEGER.format(credits)} AI 点`;
}

export function formatUsd(value: number): string {
  return CURRENCY.format(value);
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

/**
 * Compacts a token count to three significant figures with a unit suffix, so
 * columns of numbers line up at a glance (`19.9B`, `76.7M`, `804K`).
 */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trim(value / 1e12)}T`;
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

function trim(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** `2026-08-07` to `8月7日`. */
export function formatDayShort(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map((part) => Number(part));
  if (year === undefined || month === undefined || dayOfMonth === undefined) return day;
  return `${month}月${dayOfMonth}日`;
}

/** Inclusive day list between two `YYYY-MM-DD` bounds. */
export function enumerateDays(sinceDay: string, untilDay: string): readonly string[] {
  const days: string[] = [];
  const start = Date.parse(`${sinceDay}T00:00:00Z`);
  const end = Date.parse(`${untilDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return days;

  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The window the page requests, expressed in the viewer's own time zone so days
 * line up with what they actually experienced.
 */
export function makeWindow(days: number, now = new Date()): UsageSummaryInput {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const untilDay = format.format(now);
  // Subtracting fixed milliseconds from `now` lands on the wrong calendar day
  // around a DST transition. Only "today" needs the zone; the window start is
  // pure calendar arithmetic on that day, done in UTC where days are uniform.
  const [year = 0, month = 1, dayOfMonth = 1] = untilDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));
  return {
    sinceDay: UsageDay.make(start.toISOString().slice(0, 10)),
    untilDay: UsageDay.make(untilDay),
    timeZone,
  };
}
