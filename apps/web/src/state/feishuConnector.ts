import type { DesktopBridge, FdConnectorState } from "@t3tools/contracts";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FeishuConnectorBridge = Pick<
  DesktopBridge,
  "getFeishuConnectorState" | "onFeishuConnectorState"
>;

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

const loadingState: FdConnectorState = {
  ...unavailableState,
  busy: true,
  installState: "installing",
  message: "正在读取飞书连接状态…",
};

const readFailureState: FdConnectorState = {
  ...unavailableState,
  message: "读取飞书连接器状态失败。",
  lastError: "读取飞书连接器状态失败。",
};

export interface FeishuConnectorController {
  readonly start: () => () => void;
}

export function createFeishuConnectorController(
  bridge: FeishuConnectorBridge | undefined,
  publish: (state: FdConnectorState) => void,
): FeishuConnectorController {
  let revision = 0;

  return {
    start: () => {
      revision += 1;
      const startedAtRevision = revision;
      if (bridge?.getFeishuConnectorState === undefined) {
        publish(unavailableState);
        return () => {
          if (revision === startedAtRevision) revision += 1;
        };
      }

      const unsubscribe = bridge.onFeishuConnectorState?.((next) => {
        revision += 1;
        publish(next);
      });
      const requestedAtRevision = revision;
      void bridge.getFeishuConnectorState().then(
        (next) => {
          if (revision === requestedAtRevision) publish(next);
        },
        () => {
          if (revision === requestedAtRevision) publish(readFailureState);
        },
      );

      return () => {
        revision += 1;
        unsubscribe?.();
      };
    },
  };
}

const FeishuConnectorStateContext = createContext<FdConnectorState | null>(null);

export function FeishuConnectorProvider({ children }: { readonly children: ReactNode }) {
  const bridge =
    typeof window === "undefined"
      ? undefined
      : window.desktopBridge?.getFeishuConnectorState
        ? window.desktopBridge
        : undefined;
  const [state, setState] = useState<FdConnectorState>(() =>
    bridge === undefined ? unavailableState : loadingState,
  );
  const controller = useMemo(() => createFeishuConnectorController(bridge, setState), [bridge]);

  useEffect(() => controller.start(), [controller]);

  return createElement(FeishuConnectorStateContext.Provider, { value: state }, children);
}

export function useFeishuConnectorState(): FdConnectorState {
  const state = useContext(FeishuConnectorStateContext);
  if (state === null) {
    throw new Error("useFeishuConnectorState must be used within FeishuConnectorProvider");
  }
  return state;
}

export function isFeishuConnectorConnected(state: FdConnectorState): boolean {
  return state.enabled && state.authState === "authenticated" && state.skillCount > 0;
}

export type FeishuConnectorConnectionStatus = "checking" | "connected" | "disconnected";

export function resolveFeishuConnectorConnectionStatus(
  state: FdConnectorState,
): FeishuConnectorConnectionStatus {
  if (state.busy || state.authState === "unknown" || state.authState === "authenticating") {
    return "checking";
  }
  return isFeishuConnectorConnected(state) ? "connected" : "disconnected";
}
