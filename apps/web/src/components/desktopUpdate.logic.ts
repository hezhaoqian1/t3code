import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import { isWindowsPlatform } from "../lib/utils";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

const DESKTOP_UPDATE_MANIFEST_URL =
  "https://ai-api.fdsure.com/downloads/desktop/latest/latest.json";

/**
 * The main process fills `downloadedVersion` from the updater's `update-downloaded`
 * event, which is dispatched on its own fiber. A download RPC can therefore resolve
 * before that write lands, so fall back to the version the download was started for.
 */
export function getDesktopUpdateDownloadedVersion(state: DesktopUpdateState): string | null {
  return state.downloadedVersion ?? state.availableVersion;
}

/** Release notes for an exact downloaded build; nightly suffixes are part of the tag. */
export function getDesktopUpdateReleaseUrl(version: string | null): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return DESKTOP_UPDATE_MANIFEST_URL;
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.downloadedVersion) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "当前安装包与这台 Mac 的芯片架构匹配。";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "这台 Mac 使用 Apple 芯片，但方德 AI 仍通过 Rosetta 运行 Intel 版。请下载更新并切换到 Apple 芯片原生版本。";
  }
  if (action === "install") {
    return "这台 Mac 使用 Apple 芯片，但方德 AI 仍通过 Rosetta 运行 Intel 版。请重启安装已下载的 Apple 芯片原生版本。";
  }
  return "这台 Mac 使用 Apple 芯片，但方德 AI 仍通过 Rosetta 运行 Intel 版。下次更新会替换为 Apple 芯片原生版本。";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `发现新版本 ${state.availableVersion ?? ""}，点击下载`.trim();
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `正在下载更新${progress}`;
  }
  if (state.status === "downloaded") {
    return `版本 ${state.downloadedVersion ?? state.availableVersion ?? ""} 已下载，点击退出并安装`.trim();
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `版本 ${state.availableVersion} 下载失败，点击重试`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `版本 ${state.downloadedVersion} 安装失败，点击重试`;
    }
    return state.message ?? "更新失败";
  }
  return "已是最新版本";
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  platform = "",
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  const windowsInstallWarning = isWindowsPlatform(platform)
    ? "\n\nWindows 将显示安装进度，安装完成后会自动重新打开方德 AI。"
    : "\n\n安装完成后会自动重新打开方德 AI。";
  return `退出并安装${version ? ` ${version}` : "新版本"}？\n\n正在运行的任务会被中断，请确认任务已经保存。${windowsInstallWarning}`;
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" &&
    state.status !== "downloading" &&
    state.status !== "downloaded" &&
    state.status !== "disabled"
  );
}
