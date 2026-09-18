import { DownloadIcon, RotateCwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isElectron } from "../../env";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "../desktopUpdate.logic";
import { showDesktopUpdateDownloadedToast } from "../desktopUpdate.toast";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const UPDATE_NOTICE_SEEN_KEY = "fd.desktop.update-notice-seen-version";
const UPDATE_NOTICE_OPEN_EVENT = "fd:desktop-update-notice-open";

function hasSeenUpdateNotice(version: string): boolean {
  try {
    return window.localStorage.getItem(UPDATE_NOTICE_SEEN_KEY) === version;
  } catch {
    return false;
  }
}

function markUpdateNoticeSeen(version: string): void {
  try {
    window.localStorage.setItem(UPDATE_NOTICE_SEEN_KEY, version);
  } catch {
    // A restricted storage context should not prevent the update UI from rendering.
  }
}

function keyReleaseNoteItems(items: ReadonlyArray<string>) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const occurrence = occurrences.get(item) ?? 0;
    occurrences.set(item, occurrence + 1);
    return { item, key: JSON.stringify([item, occurrence]) };
  });
}

function SidebarUpdateReleaseNotesTooltip({
  state,
  tooltip,
}: {
  readonly state: NonNullable<ReturnType<typeof useDesktopUpdateState>>;
  readonly tooltip: string;
}) {
  if (state.channel !== "nightly" || state.releaseNotes.length === 0) {
    return <>{tooltip}</>;
  }

  return (
    <div className="w-120 max-w-[calc(100vw-2rem)] text-left">
      <div className="px-1">
        <div className="text-sm leading-5 font-medium">{tooltip}</div>
      </div>
      <div className="max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto px-1 pt-4 pb-1">
        {state.releaseNotes.map((releaseNote, index) => (
          <div key={releaseNote.version}>
            {index > 0 && <Separator className="my-3 bg-border/60" />}
            <section>
              <h3 className="text-muted-foreground text-xs leading-4 font-semibold">
                {index === 0 ? "本次更新" : `${releaseNote.version} 更新内容`}
              </h3>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-popover-foreground/90">
                {keyReleaseNoteItems(releaseNote.items).map(({ item, key }) => (
                  <li className="list-disc break-words" key={key}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SidebarUpdatePill() {
  const state = useDesktopUpdateState();
  const [dismissed, setDismissed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const onOpenNotice = () => setDetailsOpen(true);
    window.addEventListener(UPDATE_NOTICE_OPEN_EVENT, onOpenNotice);
    return () => window.removeEventListener(UPDATE_NOTICE_OPEN_EVENT, onOpenNotice);
  }, []);

  useEffect(() => {
    if (!state || state.status !== "available" || !state.availableVersion) return;
    const version = state.availableVersion;
    if (hasSeenUpdateNotice(version)) return;

    markUpdateNoticeSeen(version);
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: `方德 AI ${version} 有新版本`,
        description: "点击查看本次更新内容，或从左下角下载并安装。",
        timeout: 12_000,
        actionProps: {
          children: "查看更新",
          onClick: () => window.dispatchEvent(new Event(UPDATE_NOTICE_OPEN_EVENT)),
        },
      }),
    );
  }, [state]);

  const visible = isElectron && shouldShowDesktopUpdateButton(state) && !dismissed;
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "发现新版本";
  const disabled = isDesktopUpdateButtonDisabled(state);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";

  const showArm64Warning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  const handleAction = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;
    if (disabled || action === "none") return;

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            showDesktopUpdateDownloadedToast(bridge, result.state);
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法下载更新",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法开始下载更新",
              description: error instanceof Error ? error.message : "发生未知错误。",
            }),
          );
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(state, navigator.platform),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法安装更新",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法安装更新",
              description: error instanceof Error ? error.message : "发生未知错误。",
            }),
          );
        });
    }
  }, [action, disabled, state]);

  if (!visible && !showArm64Warning) return null;

  return (
    <div className="flex flex-col gap-1">
      {showArm64Warning && arm64Description && (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <TriangleAlertIcon />
          <AlertTitle>Intel build on Apple Silicon</AlertTitle>
          <AlertDescription>{arm64Description}</AlertDescription>
        </Alert>
      )}
      {visible && (
        <div
          className={`group/update relative flex h-7 w-full items-center rounded-lg bg-update-surface text-xs font-medium text-update ${
            disabled ? " cursor-not-allowed opacity-60" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.update-main:hover]/update:bg-update/12" />
          <Tooltip
            open={detailsOpen ? true : undefined}
            onOpenChange={(open) => setDetailsOpen(open)}
          >
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={tooltip}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  className="update-main relative flex h-full flex-1 items-center gap-2 px-2 enabled:cursor-pointer"
                  onClick={handleAction}
                >
                  {action === "install" ? (
                    <>
                      <RotateCwIcon className="size-3.5" />
                      <span>退出并安装</span>
                    </>
                  ) : state?.status === "downloading" ? (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>
                        正在下载
                        {typeof state.downloadPercent === "number"
                          ? ` (${Math.floor(state.downloadPercent)}%)`
                          : "…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>发现新版本</span>
                    </>
                  )}
                </button>
              }
            />
            <TooltipPopup
              align="start"
              className="pointer-events-auto max-w-none text-balance"
              side="top"
            >
              {state ? (
                <div className="w-80 max-w-[calc(100vw-2rem)]">
                  <SidebarUpdateReleaseNotesTooltip state={state} tooltip={tooltip} />
                  {state.availableVersion && (
                    <div className="mt-3 border-t border-border/60 px-1 pt-2 text-[11px] text-muted-foreground">
                      点击左下角按钮下载并安装 {state.availableVersion}
                    </div>
                  )}
                </div>
              ) : (
                tooltip
              )}
            </TooltipPopup>
          </Tooltip>
          {action === "download" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="暂时忽略更新"
                    className="mr-1 inline-flex size-5 items-center justify-center rounded-md text-update/60 transition-colors hover:text-update"
                    onClick={() => setDismissed(true)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipPopup side="top">本次启动期间不再提示</TooltipPopup>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
