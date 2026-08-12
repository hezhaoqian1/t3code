/**
 * Usage state scoped to the primary local service.
 *
 * @module state/usage
 */
import { useAtomValue } from "@effect/atom-react";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type FdUsageSummary,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { summarizeUsage, type UsageTotals } from "../usage/usageSummary";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

interface UsageStatus {
  readonly environmentId: EnvironmentId | null;
  readonly isPending: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
}

export function resolveUsageLoadingState(input: {
  readonly waiting: boolean;
  readonly hasValue: boolean;
}): Pick<UsageStatus, "isPending" | "isRefreshing"> {
  return {
    isPending: input.waiting && !input.hasValue,
    isRefreshing: input.waiting && input.hasValue,
  };
}

const usageByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): UsageStatus => {
    const environmentId = get(primaryEnvironmentIdAtom);
    if (environmentId === null) {
      return {
        environmentId: null,
        isPending: true,
        isRefreshing: false,
        error: null,
        summary: null,
      };
    }

    const input = JSON.parse(windowKey) as UsageSummaryInput;
    const result = get(serverEnvironment.usageSummary({ environmentId, input }));
    const summary = Option.getOrNull(AsyncResult.value(result));
    return {
      environmentId,
      ...resolveUsageLoadingState({ waiting: result.waiting, hasValue: summary !== null }),
      error: result._tag === "Failure" ? "无法从本地服务读取用量数据。" : null,
      summary,
    };
  }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
);

export interface UsageView {
  readonly merged: UsageTotals;
  readonly isPending: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useUsage(input: UsageSummaryInput): UsageView {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        timeZone: input.timeZone,
      }),
    [input.sinceDay, input.untilDay, input.timeZone],
  );
  const status = useAtomValue(usageByWindowAtom(windowKey));

  const refresh = useCallback(() => {
    if (status.environmentId === null) return;
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    appAtomRegistry.refresh(
      serverEnvironment.usageSummary({ environmentId: status.environmentId, input }),
    );
  }, [status.environmentId, windowKey]);

  const contractMismatch =
    status.summary !== null && status.summary.contractVersion !== USAGE_CONTRACT_VERSION;
  const merged = useMemo(
    () => summarizeUsage(contractMismatch ? null : status.summary),
    [contractMismatch, status.summary],
  );

  return {
    merged,
    isPending: status.isPending,
    isRefreshing: status.isRefreshing,
    error: contractMismatch ? "当前应用版本暂不支持这份用量数据。" : status.error,
    refresh,
  };
}

export interface FdGatewayUsageView {
  readonly supported: boolean;
  readonly summary: FdUsageSummary | null;
  readonly isPending: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Desktop-only usage source. Credentials stay in the Electron main process;
 * the renderer receives only the Gateway's already-aggregated account data.
 */
export function useFdGatewayUsage(): FdGatewayUsageView {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const getSummary = bridge?.getFdUsageSummary;
  const supported = typeof getSummary === "function";
  const [summary, setSummary] = useState<FdUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(supported);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!supported || getSummary === undefined) {
      setWaiting(false);
      return;
    }
    let mounted = true;
    setWaiting(true);
    void getSummary()
      .then((next) => {
        if (!mounted) return;
        setSummary(next);
        setError(null);
      })
      .catch(() => {
        if (!mounted) return;
        setError("无法读取 Gateway AI 点数，请检查登录状态或网络连接。");
      })
      .finally(() => {
        if (mounted) setWaiting(false);
      });
    return () => {
      mounted = false;
    };
  }, [getSummary, refreshToken, supported]);

  return {
    supported,
    summary,
    isPending: waiting && summary === null,
    isRefreshing: waiting && summary !== null,
    error,
    refresh: useCallback(() => setRefreshToken((value) => value + 1), []),
  };
}
