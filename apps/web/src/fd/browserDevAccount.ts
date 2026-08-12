import type { FdAccountBridge } from "./accountController";

const devState = {
  status: "authenticated",
  policyVersion: 1,
  profile: { id: 1, username: "fd-dev-preview", displayName: "开发预览" },
  capabilities: { generalAssistant: true },
  expiresAt: 2_000_000_000,
} as const;

export const browserDevAccountBridge: FdAccountBridge = {
  getFdAccountState: async () => devState,
  loginFdAccount: async () => ({ ok: true, state: devState }),
  logoutFdAccount: async () => ({ completed: true, state: { status: "anonymous" } }),
  reloadFdAccount: async () => ({ state: devState }),
  retryFdAccountRevocation: async () => ({ completed: true, state: { status: "anonymous" } }),
  onFdAccountState: () => () => undefined,
};
