import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  LoaderIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { FdConnectorState } from "@t3tools/contracts";

import { useFeishuConnectorState } from "../../state/feishuConnector";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";

export type ConnectorSurface = "page" | "settings";

function connectorConnected(state: FdConnectorState): boolean {
  return state.enabled && state.authState === "authenticated" && state.skillCount > 0;
}

function authLabel(state: FdConnectorState): string {
  if (!state.enabled) return "未启用";
  if (state.busy) return state.message ?? "处理中…";
  if (state.authState === "authenticated") return "已连接";
  if (state.authState === "not_configured") return "需要创建/绑定飞书应用";
  if (state.authState === "not_authenticated") return "需要授权飞书账号";
  if (state.authState === "failed") return "连接失败";
  return "待检测";
}

function installLabel(state: FdConnectorState): string {
  if (state.installState === "installed") {
    return `CLI ${state.cliVersion ?? "已安装"} · ${state.skillCount} 个官方 Skills`;
  }
  if (state.installState === "installing") return "正在安装/同步";
  if (state.installState === "failed") return "安装失败";
  return "未安装";
}

function ConnectorBadge({ state }: { readonly state: FdConnectorState }) {
  const connected = connectorConnected(state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        connected
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {state.busy ? (
        <LoaderIcon className="size-3 animate-spin" />
      ) : connected ? (
        <CheckCircle2Icon className="size-3" />
      ) : (
        <PlugZapIcon className="size-3" />
      )}
      {authLabel(state)}
    </span>
  );
}

function FeishuConnectorLogo() {
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-50 via-white to-indigo-50 shadow-sm ring-1 ring-black/5 dark:from-cyan-950/60 dark:via-background dark:to-indigo-950/60">
      <span className="absolute left-3 top-2.5 size-4 rounded-full bg-cyan-500" />
      <span className="absolute right-2.5 top-3 size-4 rounded-full bg-blue-600" />
      <span className="absolute bottom-2.5 left-3.5 size-4 rounded-full bg-emerald-500" />
      <span className="relative size-4 rotate-45 rounded-sm bg-white/95 shadow-sm" />
    </span>
  );
}

function useConnectorActions() {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;

  const runAction = useCallback((label: string, action: () => Promise<unknown>) => {
    setPendingAction(label);
    void action()
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `${label}失败`,
            description: error instanceof Error ? error.message : "请稍后重试。",
          }),
        );
      })
      .finally(() => setPendingAction(null));
  }, []);

  const handleConnect = useCallback(() => {
    if (!bridge?.connectFeishuConnector) return;
    runAction("连接飞书", () => bridge.connectFeishuConnector!());
  }, [bridge, runAction]);

  const handleRefresh = useCallback(() => {
    if (!bridge?.refreshFeishuConnector) return;
    runAction("刷新飞书连接器", () => bridge.refreshFeishuConnector!());
  }, [bridge, runAction]);

  const handleDisconnect = useCallback(() => {
    if (!bridge?.disconnectFeishuConnector) return;
    runAction("断开飞书", () => bridge.disconnectFeishuConnector!());
  }, [bridge, runAction]);

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      if (!bridge?.setFeishuConnectorEnabled) return;
      runAction(enabled ? "启用飞书连接器" : "停用飞书连接器", () =>
        bridge.setFeishuConnectorEnabled!({ enabled }),
      );
    },
    [bridge, runAction],
  );

  return {
    desktopAvailable: Boolean(bridge?.getFeishuConnectorState),
    handleConnect,
    handleDisconnect,
    handleEnabledChange,
    handleRefresh,
    pendingAction,
  };
}

function FeishuConnectorControls({
  state,
  compact = false,
}: {
  readonly state: FdConnectorState;
  readonly compact?: boolean;
}) {
  const {
    desktopAvailable,
    handleConnect,
    handleDisconnect,
    handleEnabledChange,
    handleRefresh,
    pendingAction,
  } = useConnectorActions();
  const busy = state.busy || pendingAction !== null;
  const connected = state.enabled && state.authState === "authenticated";
  const disconnectBusy = pendingAction === "断开飞书";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "justify-end" : "justify-start sm:justify-end",
      )}
    >
      <Switch
        checked={state.enabled}
        disabled={!desktopAvailable || busy}
        aria-label="启用飞书连接器"
        onCheckedChange={handleEnabledChange}
      />
      <Button
        size="xs"
        variant={connected ? "outline" : "default"}
        disabled={!desktopAvailable || busy}
        onClick={handleConnect}
      >
        {busy && pendingAction === "连接飞书" ? (
          <LoaderIcon className="size-3 animate-spin" />
        ) : null}
        {connected ? "重新连接" : "连接"}
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={!desktopAvailable || busy}
        onClick={handleRefresh}
      >
        刷新
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={!desktopAvailable || disconnectBusy || (!state.enabled && !state.busy)}
        onClick={handleDisconnect}
      >
        {disconnectBusy ? <LoaderIcon className="size-3 animate-spin" /> : null}
        {state.busy ? "取消授权" : "断开"}
      </Button>
    </div>
  );
}

function FeishuStatusDetails({ state }: { readonly state: FdConnectorState }) {
  const desktopAvailable =
    typeof window !== "undefined" && Boolean(window.desktopBridge?.getFeishuConnectorState);
  const skillsPreview = useMemo(
    () => state.installedSkillNames.slice(0, 12).join("、"),
    [state.installedSkillNames],
  );

  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <div>{installLabel(state)}</div>
      {skillsPreview ? (
        <div>
          已同步：{skillsPreview}
          {state.skillCount > 12 ? "…" : ""}
        </div>
      ) : null}
      {state.authAction?.verificationUrl ? (
        <a
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          href={state.authAction.verificationUrl}
          target="_blank"
          rel="noreferrer"
        >
          打开飞书授权页面
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : null}
      {state.message ? <div>{state.message}</div> : null}
      {state.lastError ? (
        <div className="text-destructive">上次操作未完成：{state.lastError}</div>
      ) : null}
      {!desktopAvailable ? (
        <div className="text-muted-foreground">网页版暂不支持本地连接器，请使用 FD AI 桌面端。</div>
      ) : null}
    </div>
  );
}

export function FeishuConnectorCard({ surface }: { readonly surface: ConnectorSurface }) {
  const state = useFeishuConnectorState();
  const connected = connectorConnected(state);

  if (surface === "settings") {
    return (
      <div className="rounded-xl px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:items-center sm:gap-8">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-h-5 items-center gap-1.5">
              <h3 className="inline-flex items-center gap-2 text-sm font-medium tracking-[-0.005em] text-foreground">
                飞书
                <ConnectorBadge state={state} />
              </h3>
            </div>
            <p className="max-w-xl text-[13px] leading-[1.45] text-muted-foreground/80">
              连接员工自己的飞书账号后，FD AI 桌面端 Agent 可通过官方 lark-cli 和官方 lark-* Skills
              操作文档、表格、知识库、日历、消息、审批等能力。
            </p>
            <FeishuStatusDetails state={state} />
          </div>
          <FeishuConnectorControls state={state} compact />
        </div>
      </div>
    );
  }

  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-4">
          <FeishuConnectorLogo />
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.025em] text-foreground">飞书</h2>
              <span
                className={cn(
                  "size-2 rounded-full",
                  connected ? "bg-emerald-500" : "bg-muted-foreground/35",
                )}
                aria-hidden
              />
              <ConnectorBadge state={state} />
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              连接飞书后，FD AI 可以在桌面端任务中按需调用官方 lark-cli 与 lark-* Skills，
              用员工自己的飞书授权操作文档、表格、知识库、日历、消息、审批等能力。
            </p>
          </div>
        </div>
        <FeishuConnectorControls state={state} />
      </div>
      <div className="grid gap-3 border-t border-border/70 bg-muted/20 p-5 text-sm sm:grid-cols-3 sm:p-6">
        <div className="rounded-lg border border-border/60 bg-background/70 p-4">
          <div className="text-xs font-medium text-muted-foreground">安装状态</div>
          <div className="mt-1 text-foreground">{installLabel(state)}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/70 p-4">
          <div className="text-xs font-medium text-muted-foreground">账号授权</div>
          <div className="mt-1 text-foreground">{authLabel(state)}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/70 p-4">
          <div className="text-xs font-medium text-muted-foreground">Agent 使用方式</div>
          <div className="mt-1 text-foreground">连接后自动可用，无需在 FD Skills 中手动选择</div>
        </div>
      </div>
      <div className="space-y-2 px-5 py-4 sm:px-6">
        <FeishuStatusDetails state={state} />
      </div>
    </article>
  );
}

export function ConnectorsPage() {
  return (
    <ScrollArea className="h-full">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-col gap-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <PlugZapIcon className="size-3.5" />
            连接器
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">
              连接你的工作应用
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              连接器负责把外部办公系统接入本地 Agent runtime。启用后，员工在普通任务里描述目标即可，
              FD AI 会按需调用对应的官方 CLI 和 Skills。
            </p>
          </div>
        </header>

        <div className="flex max-w-md items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-sm">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            nativeInput
            unstyled
            readOnly
            value=""
            placeholder="搜索连接器"
            aria-label="搜索连接器"
            className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:placeholder:text-muted-foreground"
          />
        </div>

        <section className="grid gap-4">
          <FeishuConnectorCard surface="page" />
          <div className="rounded-lg border border-dashed border-border/80 p-6 text-sm text-muted-foreground">
            更多连接器会按企业授权逐步出现。当前桌面端先完整支持飞书官方能力。
          </div>
        </section>
      </main>
    </ScrollArea>
  );
}

export function ConnectorsSidebarNav() {
  const state = useFeishuConnectorState();
  const connected = connectorConnected(state);

  return (
    <>
      <div className="flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
        <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
        <Input
          nativeInput
          unstyled
          type="search"
          readOnly
          value=""
          placeholder="搜索连接器"
          aria-label="搜索连接器"
          className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground"
        />
      </div>
      <div className="pt-2">
        <button
          type="button"
          className="flex h-12 w-full cursor-default items-center gap-3 rounded-xl bg-sidebar-row-selected px-3 text-left text-sidebar-foreground"
        >
          <FeishuConnectorLogo />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">飞书</span>
            <span className="block truncate text-xs text-sidebar-muted-foreground">
              {connected ? "已连接" : authLabel(state)}
            </span>
          </span>
          <span
            className={cn(
              "size-2 rounded-full",
              connected ? "bg-emerald-500" : "bg-sidebar-muted-foreground/35",
            )}
            aria-hidden
          />
        </button>
      </div>
    </>
  );
}

export function ConnectorSettingsPanel() {
  const navigate = useNavigate();

  return (
    <div className="settings-page-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto px-4 pt-10 pb-7 sm:px-8 sm:pt-12 sm:pb-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="space-y-3" id="connectors" tabIndex={-1}>
          <div className="flex min-h-8 items-center justify-between gap-4 px-3 sm:px-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.025em] text-foreground">
              <PlugZapIcon className="size-5 text-muted-foreground" />
              连接器
            </h2>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void navigate({ to: "/connectors" })}
            >
              打开连接器中心
              <ExternalLinkIcon className="size-3" />
            </Button>
          </div>
          <div className="relative space-y-1 overflow-visible text-foreground">
            <FeishuConnectorCard surface="settings" />
          </div>
        </section>
      </div>
    </div>
  );
}

export function ConnectorRefreshButton() {
  const state = useFeishuConnectorState();
  const { desktopAvailable, handleRefresh, pendingAction } = useConnectorActions();
  const busy = state.busy || pendingAction !== null;

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className="size-7"
      disabled={!desktopAvailable || busy}
      aria-label="刷新连接器"
      onClick={handleRefresh}
    >
      <RefreshCwIcon className={cn("size-3.5", busy && "animate-spin")} />
    </Button>
  );
}
