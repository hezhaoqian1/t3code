import type {
  DesktopBridge,
  FdAccountLoginInput,
  FdAccountLoginResult,
  FdAccountLogoutResult,
  FdAccountReloadResult,
  FdAccountState,
  FdRetryRevocationResult,
} from "@t3tools/contracts";

export type FdAccountBridge = Pick<
  DesktopBridge,
  | "getFdAccountState"
  | "loginFdAccount"
  | "logoutFdAccount"
  | "reloadFdAccount"
  | "retryFdAccountRevocation"
  | "onFdAccountState"
>;

const CREDENTIALS_UNAVAILABLE_STATE = {
  status: "credentials_unavailable",
  message: "无法连接方德 AI 桌面安全服务，请重启应用后重试。",
} as const satisfies FdAccountState;

const unavailableState = () => CREDENTIALS_UNAVAILABLE_STATE;

export interface FdAccountController {
  readonly start: () => () => void;
  readonly login: (input: FdAccountLoginInput) => Promise<FdAccountLoginResult>;
  readonly logout: () => Promise<FdAccountLogoutResult>;
  readonly reload: () => Promise<FdAccountReloadResult>;
  readonly retryRevocation: () => Promise<FdRetryRevocationResult>;
}

export function createFdAccountController(
  bridge: FdAccountBridge | undefined,
  publish: (state: FdAccountState) => void,
): FdAccountController {
  let revision = 0;
  let stopped = false;

  const publishCurrent = (state: FdAccountState) => {
    if (!stopped) publish(state);
  };

  return {
    start: () => {
      stopped = false;
      if (bridge === undefined) {
        publishCurrent(unavailableState());
        return () => {
          stopped = true;
        };
      }

      const unsubscribe = bridge.onFdAccountState((state) => {
        revision += 1;
        publishCurrent(state);
      });
      const requestedAtRevision = revision;
      void bridge.getFdAccountState().then(
        (state) => {
          if (revision === requestedAtRevision) publishCurrent(state);
        },
        () => publishCurrent(unavailableState()),
      );

      return () => {
        stopped = true;
        unsubscribe();
      };
    },
    login: async (input) => {
      if (bridge === undefined) {
        return {
          ok: false,
          code: "secure_storage_unavailable",
          message: unavailableState().message,
          state: unavailableState(),
        };
      }
      const result = await bridge.loginFdAccount(input);
      publishCurrent(result.ok ? result.state : (result.state ?? unavailableState()));
      return result;
    },
    logout: async () => {
      if (bridge === undefined) return { completed: true, state: unavailableState() };
      const result = await bridge.logoutFdAccount();
      publishCurrent(result.state);
      return result;
    },
    reload: async () => {
      if (bridge === undefined) return { state: unavailableState() };
      const result = await bridge.reloadFdAccount();
      publishCurrent(result.state);
      return result;
    },
    retryRevocation: async () => {
      if (bridge === undefined) return { completed: false, state: unavailableState() };
      const result = await bridge.retryFdAccountRevocation();
      publishCurrent(result.state);
      return result;
    },
  };
}
