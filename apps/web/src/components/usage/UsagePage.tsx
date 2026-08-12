import type { FdUsageSummary, UsageProviderKind } from "@t3tools/contracts";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { useFdGatewayUsage, useUsage } from "../../state/usage";
import {
  enumerateDays,
  formatCount,
  formatDayShort,
  formatQuotaAiCredits,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "../../usage/usageFormat";
import { ScrollArea } from "../ui/scroll-area";
import { UsageChartLegend, UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { PROVIDER_COLOR, PROVIDER_LABEL, PROVIDER_MARK, PROVIDER_ORDER } from "./usageProviders";

const WINDOW_OPTIONS = [
  { days: 7, label: "近 7 天" },
  { days: 30, label: "近 30 天" },
  { days: 90, label: "近 90 天" },
] as const;

export function UsagePage() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const router = useRouter();

  // Recomputed only when the window length changes, so a re-render does not
  // shift the range and refetch the primary service.
  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const { merged, isPending, isRefreshing, error, refresh } = useUsage(window);
  const gatewayUsage = useFdGatewayUsage();

  if (gatewayUsage.supported) {
    return (
      <GatewayUsagePage
        usage={gatewayUsage}
        onBack={() => {
          if (canGoBack) {
            router.history.back();
            return;
          }
          void navigate({ to: "/" });
        }}
      />
    );
  }

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const recentDays = useMemo(() => merged.daily.toReversed().slice(0, 8), [merged.daily]);

  // Ranked by whatever the toggle is showing, so the bars always descend.
  const orderedProviders = useMemo(
    () =>
      merged.providers.toSorted((a, b) =>
        metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
      ),
    [merged.providers, metric],
  );

  const activeDays = merged.daily.filter((day) => day.totalTokens > 0).length;
  const dailyAverage = activeDays === 0 ? 0 : merged.totalTokens / activeDays;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="返回"
              onClick={() => {
                if (canGoBack) {
                  router.history.back();
                  return;
                }
                void navigate({ to: "/" });
              }}
              className="mt-1 cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-foreground">用量统计</h1>
              <p className="text-sm text-muted-foreground">
                {formatDayShort(window.sinceDay)} 至 {formatDayShort(window.untilDay)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  onClick={() => setWindowDays(option.days)}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-xs",
                    option.days === windowDays
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={isPending || isRefreshing}
              aria-label={isRefreshing ? "正在刷新用量" : "刷新用量"}
              className="cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-60"
            >
              <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </button>
          </div>
        </header>

        {isPending ? (
          <UsageSkeleton />
        ) : (
          <>
            {error ? (
              <div className="border border-border px-3 py-2 text-xs text-muted-foreground">
                {error}
              </div>
            ) : null}

            {/* Cost first: the financial answer, then the provider split. */}
            <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              {/* The summary follows the chart toggle, so the headline and the
                  series are always reading the same units. */}
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">
                    {metric === "cost" ? "Token 估算成本" : "已处理 Token"}
                  </span>
                  <span className="text-4xl font-semibold text-foreground tabular-nums">
                    {metric === "cost"
                      ? `${formatUsd(merged.costUsd)}*`
                      : formatTokens(merged.totalTokens)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {metric === "cost"
                      ? "* 按完整 API 单价估算，并非实际账单"
                      : `${formatCount(merged.sessions)} 个会话的输入、缓存读取与输出总量。`}
                  </span>
                </div>

                {orderedProviders.map((provider) => {
                  const share = metric === "cost" ? provider.costShare : provider.tokenShare;
                  return (
                    <div key={provider.provider} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="flex items-center gap-2 text-sm text-foreground">
                          <ProviderMark provider={provider.provider} className="size-4" />
                          {PROVIDER_LABEL[provider.provider]}
                        </span>
                        <span className="text-sm text-foreground tabular-nums">
                          {metric === "cost"
                            ? formatUsd(provider.costUsd)
                            : formatTokens(provider.totalTokens)}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full"
                          style={{
                            width: `${(share * 100).toFixed(1)}%`,
                            backgroundColor: PROVIDER_COLOR[provider.provider],
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {metric === "cost"
                          ? `占成本 ${formatPercent(share)} · ${formatTokens(provider.totalTokens)} Token`
                          : `占 Token ${formatPercent(share)} · ${formatUsd(provider.costUsd)}`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-foreground">
                    每日{metric === "tokens" ? "已处理 Token" : "估算成本"}
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex overflow-hidden rounded-md border border-border">
                      {(["cost", "tokens"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setMetric(option)}
                          className={cn(
                            "cursor-pointer px-2.5 py-1 text-[10px] tracking-wide uppercase",
                            option === metric
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {option === "cost" ? "成本" : "Token"}
                        </button>
                      ))}
                    </div>
                    <UsageChartLegend />
                  </div>
                </div>
                <UsageProviderChart days={days} daily={merged.daily} metric={metric} />
              </div>
            </section>

            <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-5">
              <Metric
                label="已处理 Token"
                value={formatTokens(merged.totalTokens)}
                detail={`活跃日均 ${formatTokens(dailyAverage)}`}
              />
              <Metric
                label="缓存输入"
                value={formatTokens(merged.cachedInputTokens)}
                detail={`占已观测输入 ${formatPercent(cachedShare)}`}
              />
              <Metric
                label="非缓存输入"
                value={formatTokens(merged.uncachedInputTokens)}
                detail={`${formatTokens(merged.cacheCreationTokens)} 次缓存写入`}
              />
              <Metric
                label="输出"
                value={formatTokens(merged.outputTokens)}
                detail={`其中推理 ${formatTokens(merged.reasoningTokens)}`}
              />
              <Metric
                label="缓存节省"
                value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                detail={
                  merged.costUsd > 0
                    ? `约为原始 Token 成本的 ${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)} 倍`
                    : "相对完整输入单价"
                }
              />
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-foreground">明细</h2>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {(["model", "day"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setBreakdown(option)}
                      className={cn(
                        "cursor-pointer px-2.5 py-1 text-[10px] tracking-wide uppercase",
                        option === breakdown
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option === "model" ? "模型" : "日期"}
                    </button>
                  ))}
                </div>
              </div>

              {breakdown === "model" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 font-normal">模型</th>
                      <th className="py-2 text-right font-normal">成本</th>
                      <th className="py-2 text-right font-normal">占比</th>
                      <th className="py-2 text-right font-normal">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merged.models.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground">
                          当前时间范围内暂无用量。
                        </td>
                      </tr>
                    ) : (
                      merged.models.map((model) => (
                        <tr
                          key={`${model.provider}:${model.model}`}
                          className="border-b border-border/50"
                        >
                          <td className="py-2 text-foreground">
                            <span className="flex items-center gap-2">
                              <ProviderMark provider={model.provider} className="size-3.5" />
                              {model.model}
                            </span>
                          </td>
                          <td className="py-2 text-right text-foreground tabular-nums">
                            {formatUsd(model.costUsd)}
                          </td>
                          <td className="py-2 text-right text-muted-foreground tabular-nums">
                            {formatPercent(model.costShare)}
                          </td>
                          <td className="py-2 text-right text-muted-foreground tabular-nums">
                            {formatTokens(model.totalTokens)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 font-normal">日期</th>
                      {PROVIDER_ORDER.map((provider) => (
                        <th key={provider} className="py-2 text-right font-normal">
                          {PROVIDER_LABEL[provider]}
                        </th>
                      ))}
                      <th className="py-2 text-right font-normal">合计</th>
                      <th className="py-2 text-right font-normal">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDays.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          当前时间范围内暂无用量。
                        </td>
                      </tr>
                    ) : (
                      recentDays.map((day) => (
                        <tr key={day.day} className="border-b border-border/50">
                          <td className="py-2 text-foreground">{formatDayShort(day.day)}</td>
                          {PROVIDER_ORDER.map((provider) => (
                            <td
                              key={provider}
                              className="py-2 text-right text-muted-foreground tabular-nums"
                            >
                              {formatUsd(day.byProvider.get(provider)?.costUsd ?? 0)}
                            </td>
                          ))}
                          <td className="py-2 text-right text-foreground tabular-nums">
                            {formatUsd(day.costUsd)}
                          </td>
                          <td className="py-2 text-right text-muted-foreground tabular-nums">
                            {formatTokens(day.totalTokens)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function GatewayUsagePage({
  usage,
  onBack,
}: {
  readonly usage: ReturnType<typeof useFdGatewayUsage>;
  readonly onBack: () => void;
}) {
  const summary = usage.summary;
  const totalTokens = (summary?.promptTokens ?? 0) + (summary?.completionTokens ?? 0);
  const formatDate = (timestamp: number) =>
    timestamp > 0
      ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(
          new Date(timestamp * 1_000),
        )
      : "待确认";
  const percent = (period: FdUsageSummary["dailyQuota"]) => {
    if (period.unlimited || period.limit <= 0) return 0;
    return Math.min(100, Math.round(((period.used + period.reserved) / period.limit) * 100));
  };
  const quotaCard = (label: string, period: FdUsageSummary["dailyQuota"]) => (
    <section className="border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{label} AI 额度</h2>
          <p className="mt-4 text-3xl font-semibold text-foreground tabular-nums">
            {period.unlimited
              ? "不限制"
              : formatQuotaAiCredits(
                  period.remaining,
                  summary?.quotaPerUnit,
                  summary?.usdExchangeRate,
                )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {period.unlimited ? "当前未设置上限" : `已使用 ${percent(period)}%`}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>总额度</div>
          <div className="mt-1 text-sm text-foreground tabular-nums">
            {period.unlimited
              ? "不限制"
              : formatQuotaAiCredits(period.limit, summary?.quotaPerUnit, summary?.usdExchangeRate)}
          </div>
        </div>
      </div>
      {!period.unlimited ? (
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${percent(period)}%` }} />
        </div>
      ) : null}
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
        <div>
          <div className="text-muted-foreground">已用</div>
          <div className="mt-1 text-foreground tabular-nums">
            {formatQuotaAiCredits(period.used, summary?.quotaPerUnit, summary?.usdExchangeRate)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">预占</div>
          <div className="mt-1 text-foreground tabular-nums">
            {formatQuotaAiCredits(period.reserved, summary?.quotaPerUnit, summary?.usdExchangeRate)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">重置时间</div>
          <div className="mt-1 text-foreground">{formatDate(period.resetsAt)}</div>
        </div>
      </div>
    </section>
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="返回"
              onClick={onBack}
              className="mt-1 cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">用量统计</h1>
              <p className="mt-1 text-sm text-muted-foreground">Gateway AI 点数 · 近 30 天</p>
            </div>
          </div>
          <button
            type="button"
            onClick={usage.refresh}
            disabled={usage.isRefreshing || usage.isPending}
            aria-label="刷新用量"
            className="cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <RefreshCwIcon className={cn("size-3.5", usage.isRefreshing && "animate-spin")} />
          </button>
        </header>

        {usage.isPending ? (
          <div className="border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            正在读取 Gateway 用量…
          </div>
        ) : usage.error && summary === null ? (
          <div className="border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {usage.error}
          </div>
        ) : summary !== null ? (
          <>
            <section className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-6">
              <UsageMetric
                label="AI 点数消耗"
                value={formatQuotaAiCredits(
                  summary.quota,
                  summary.quotaPerUnit,
                  summary.usdExchangeRate,
                )}
                detail="近 30 天 Gateway 统计"
              />
              <UsageMetric
                label="模型 Token"
                value={formatTokens(totalTokens)}
                detail="输入与输出合计"
              />
              <UsageMetric
                label="模型请求"
                value={formatCount(summary.requestCount)}
                detail="近 30 天全量"
              />
              <UsageMetric
                label="当前速率"
                value={`${formatCount(summary.rpm)} RPM`}
                detail={`${formatCount(summary.tpm)} TPM`}
              />
              <UsageMetric
                label="失败事件"
                value={formatCount(summary.failedCount)}
                detail="错误与异常断流"
              />
              <UsageMetric
                label="平均响应"
                value={summary.averageUseTime ? `${summary.averageUseTime.toFixed(1)} 秒` : "-"}
                detail="近 30 天模型请求"
              />
            </section>
            <section className="grid gap-4 lg:grid-cols-2">
              {quotaCard("今日", summary.dailyQuota)}
              {quotaCard("本月", summary.monthlyQuota)}
            </section>
            <section className="border border-border bg-background p-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">模型使用分布</h2>
                <p className="mt-1 text-xs text-muted-foreground">按 Gateway 实际 Token 统计</p>
              </div>
              {summary.models.length > 0 ? (
                <div className="mt-4 divide-y divide-border border-y border-border">
                  {summary.models.map((model) => (
                    <div
                      key={model.model}
                      className="flex items-center justify-between py-3 text-sm"
                    >
                      <span className="truncate text-foreground">{model.model}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatTokens(model.tokens)} Token
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">当前时间范围内暂无模型调用。</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function UsageMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 bg-background px-4 py-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_MARK[provider];
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

/** Deterministic bar heights (each unique: they double as keys). */
const SKELETON_BAR_HEIGHTS = [34, 58, 41, 72, 22, 12, 49, 63, 80, 38, 55, 26, 44, 67];

/**
 * Static stand-in with the loaded page's shape: headline, provider split,
 * chart and metrics strip. No shimmer; blocks fill in once the local summary
 * answers.
 */
function UsageSkeleton() {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-xs tracking-wide text-muted-foreground uppercase">
              Token 估算成本
            </span>
            <div className="my-1.5 h-8 w-36 rounded-sm bg-muted" />
            <div className="h-3 w-28 rounded-sm bg-muted" />
          </div>

          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <ProviderMark provider={provider} className="size-4" />
                  {PROVIDER_LABEL[provider]}
                </span>
                <div className="h-3.5 w-14 rounded-sm bg-muted" />
              </div>
              <div className="h-1 w-full rounded-full bg-muted" />
              <div className="h-3 w-36 rounded-sm bg-muted" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="py-1 text-sm font-medium text-foreground">每日估算成本</h2>
          {/* Mirrors the chart's h-56 body and w-14 axis gutter to avoid a
              relayout when the real chart swaps in. */}
          <div className="flex h-56 items-end gap-1 pl-16">
            {SKELETON_BAR_HEIGHTS.map((height) => (
              <div
                key={height}
                className="flex-1 rounded-sm bg-muted"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-5">
        {["已处理 Token", "缓存输入", "非缓存输入", "输出", "缓存节省"].map((label) => (
          <div key={label} className="flex flex-col gap-0.5 bg-background px-4 py-3">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="my-1 h-5 w-16 rounded-sm bg-muted" />
            <div className="h-3 w-24 rounded-sm bg-muted" />
          </div>
        ))}
      </section>
    </>
  );
}
