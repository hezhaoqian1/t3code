import type {
  FdAccountLoginResult,
  FdAccountLogoutResult,
  FdAccountState,
  FdRetryRevocationResult,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createFdAccountController, type FdAccountBridge } from "./accountController";

const authenticated: Extract<FdAccountState, { readonly status: "authenticated" }> = {
  status: "authenticated",
  policyVersion: 1,
  profile: { id: 7, username: "employee", displayName: "方德员工" },
  capabilities: { generalAssistant: true },
  expiresAt: 2_000_000_000,
};

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeBridge(overrides: Partial<FdAccountBridge> = {}): FdAccountBridge {
  return {
    getFdAccountState: vi.fn(async (): Promise<FdAccountState> => ({ status: "anonymous" })),
    loginFdAccount: vi.fn(
      async (): Promise<FdAccountLoginResult> => ({ ok: true, state: authenticated }),
    ),
    logoutFdAccount: vi.fn(
      async (): Promise<FdAccountLogoutResult> => ({
        completed: true,
        state: { status: "anonymous" },
      }),
    ),
    reloadFdAccount: vi.fn(async () => ({ state: authenticated })),
    retryFdAccountRevocation: vi.fn(
      async (): Promise<FdRetryRevocationResult> => ({
        completed: true,
        state: { status: "anonymous" },
      }),
    ),
    onFdAccountState: vi.fn(() => () => undefined),
    ...overrides,
  };
}

describe("FD account controller", () => {
  it("subscribes before reading and does not overwrite a newer pushed state", async () => {
    const initial = deferred<FdAccountState>();
    let listener: ((state: FdAccountState) => void) | undefined;
    const bridge = makeBridge({
      getFdAccountState: vi.fn(() => initial.promise),
      onFdAccountState: vi.fn((next) => {
        listener = next;
        return () => undefined;
      }),
    });
    const states: FdAccountState[] = [];
    const stop = createFdAccountController(bridge, (state) => states.push(state)).start();

    listener?.(authenticated);
    initial.resolve({ status: "anonymous" });
    await initial.promise;
    await Promise.resolve();

    expect(states).toEqual([authenticated]);
    expect(bridge.onFdAccountState).toHaveBeenCalledBefore(
      bridge.getFdAccountState as ReturnType<typeof vi.fn>,
    );
    stop();
  });

  it("publishes only the account summary returned by login", async () => {
    const states: FdAccountState[] = [];
    const controller = createFdAccountController(makeBridge(), (state) => states.push(state));
    const result = await controller.login({ username: "employee", password: "local-test-only" });

    expect(result).toEqual({ ok: true, state: authenticated });
    expect(states).toEqual([authenticated]);
    expect(JSON.stringify(states)).not.toMatch(/accessToken|refresh|runtimeApiKey|runtimeTokenId/);
  });

  it("publishes the explicit reload state", async () => {
    const states: FdAccountState[] = [];
    const controller = createFdAccountController(makeBridge(), (state) => states.push(state));
    await expect(controller.reload()).resolves.toEqual({ state: authenticated });
    expect(states).toEqual([authenticated]);
  });

  it("preserves authenticated renderer state for an incomplete fail-closed logout", async () => {
    const states: FdAccountState[] = [];
    const bridge = makeBridge({
      logoutFdAccount: vi.fn(async () => ({
        completed: false as const,
        code: "revocation_intent_unavailable" as const,
        message: "无法安全记录退出操作",
        state: authenticated,
      })),
    });
    const result = await createFdAccountController(bridge, (state) => states.push(state)).logout();
    expect(result.completed).toBe(false);
    expect(states).toEqual([authenticated]);
  });

  it("exposes a recovery state when the desktop bridge is unavailable", () => {
    const states: FdAccountState[] = [];
    createFdAccountController(undefined, (state) => states.push(state)).start();
    expect(states).toEqual([expect.objectContaining({ status: "credentials_unavailable" })]);
  });
});
