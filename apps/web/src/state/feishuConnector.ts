import { useEffect, useState } from "react";
import type { FdConnectorState } from "@t3tools/contracts";

const unavailableState: FdConnectorState = {
  id: "feishu",
  displayName: "飞书",
  enabled: false,
  busy: false,
  installState: "not_installed",
  authState: "unknown",
  cliVersion: null,
  installedCliPath: null,
  skillsRoot: null,
  skillCount: 0,
  installedSkillNames: [],
  lastError: null,
  message: "连接器只在桌面端可用。",
  authAction: null,
};

export function useFeishuConnectorState(): FdConnectorState {
  const [state, setState] = useState<FdConnectorState>(unavailableState);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getFeishuConnectorState) {
      setState(unavailableState);
      return;
    }

    let cancelled = false;
    void bridge
      .getFeishuConnectorState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            ...unavailableState,
            message: "读取飞书连接器状态失败。",
            lastError: "读取飞书连接器状态失败。",
          });
        }
      });

    const unsubscribe = bridge.onFeishuConnectorState?.((next) => {
      if (!cancelled) setState(next);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}

export function isFeishuConnectorConnected(state: FdConnectorState): boolean {
  return state.enabled && state.authState === "authenticated" && state.skillCount > 0;
}
