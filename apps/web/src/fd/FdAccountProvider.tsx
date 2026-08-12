import type { FdAccountLoginInput, FdAccountState } from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createFdAccountController } from "./accountController";
import { browserDevAccountBridge } from "./browserDevAccount";
import { clearAllEnterpriseComposerDrafts } from "../composerDraftStore";
import { clearAllFdSkillSelections } from "../fdSkillSelectionStore";

interface FdAccountContextValue {
  readonly state: FdAccountState;
  readonly busy: "login" | "logout" | "reload" | "retry" | null;
  readonly error: string | null;
  readonly login: (input: FdAccountLoginInput) => Promise<boolean>;
  readonly logout: () => Promise<void>;
  readonly retryRevocation: () => Promise<void>;
  readonly reload: () => Promise<void>;
  readonly clearError: () => void;
}

const FdAccountContext = createContext<FdAccountContextValue | null>(null);

export function createFdAccountStatePublisher(publish: (state: FdAccountState) => void) {
  let authenticatedUserId: number | null = null;
  return (nextState: FdAccountState) => {
    const nextUserId = nextState.status === "authenticated" ? nextState.profile.id : null;
    if (authenticatedUserId !== null && authenticatedUserId !== nextUserId) {
      clearAllEnterpriseComposerDrafts();
      clearAllFdSkillSelections();
    }
    authenticatedUserId = nextUserId;
    publish(nextState);
  };
}

export function FdAccountProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<FdAccountState>({ status: "checking" });
  const [busy, setBusy] = useState<FdAccountContextValue["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const bridge =
    typeof window === "undefined"
      ? undefined
      : (window.desktopBridge ?? (import.meta.env.DEV ? browserDevAccountBridge : undefined));
  const publishAccountState = useMemo(() => createFdAccountStatePublisher(setState), []);
  const controller = useMemo(
    () => createFdAccountController(bridge, publishAccountState),
    [bridge, publishAccountState],
  );

  useEffect(() => controller.start(), [controller]);

  const login = useCallback(
    async (input: FdAccountLoginInput) => {
      setBusy("login");
      setError(null);
      try {
        const result = await controller.login(input);
        if (!result.ok) setError(result.message);
        return result.ok;
      } catch {
        setError("登录服务暂时不可用，请稍后重试。");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [controller],
  );

  const logout = useCallback(async () => {
    setBusy("logout");
    setError(null);
    try {
      const result = await controller.logout();
      if (!result.completed) setError(result.message);
    } catch {
      setError("退出登录未完成，请检查网络后重试。");
    } finally {
      setBusy(null);
    }
  }, [controller]);

  const retryRevocation = useCallback(async () => {
    setBusy("retry");
    setError(null);
    try {
      const result = await controller.retryRevocation();
      if (!result.completed) {
        setError(
          result.state.status === "revocation_pending" ||
            result.state.status === "credentials_unavailable"
            ? result.state.message
            : "安全退出尚未完成，请稍后重试。",
        );
      }
    } catch {
      setError("暂时无法完成安全退出，请检查网络后重试。");
    } finally {
      setBusy(null);
    }
  }, [controller]);

  const reload = useCallback(async () => {
    setBusy("reload");
    setError(null);
    try {
      const result = await controller.reload();
      if (result.state.status === "credentials_unavailable") setError(result.state.message);
    } catch {
      setError("暂时无法刷新账号状态，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }, [controller]);

  const value = useMemo<FdAccountContextValue>(
    () => ({
      state,
      busy,
      error,
      login,
      logout,
      retryRevocation,
      reload,
      clearError: () => setError(null),
    }),
    [busy, error, login, logout, reload, retryRevocation, state],
  );

  return <FdAccountContext.Provider value={value}>{children}</FdAccountContext.Provider>;
}

export function useFdAccount(): FdAccountContextValue {
  const account = useContext(FdAccountContext);
  if (account === null) throw new Error("useFdAccount must be used within FdAccountProvider");
  return account;
}
