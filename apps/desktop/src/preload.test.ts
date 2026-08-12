import type { DesktopBridge } from "@t3tools/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as IpcChannels from "./ipc/channels.ts";

const authenticatedState = {
  status: "authenticated",
  policyVersion: 1,
  profile: { id: 31, username: "employee", displayName: "员工" },
  capabilities: { generalAssistant: true },
  expiresAt: 2_000_000_000,
} as const;

const mocks = vi.hoisted(() => ({
  bridge: undefined as DesktopBridge | undefined,
  invoke: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: DesktopBridge) => {
      mocks.bridge = bridge;
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(channel, listener);
    },
    removeListener: mocks.removeListener,
    sendSync: vi.fn(),
  },
}));

beforeAll(async () => {
  await import("./preload.ts");
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listeners.clear();
  mocks.removeListener.mockReset();
});

describe("FD account preload bridge", () => {
  it.each([
    { status: "checking" },
    { status: "anonymous" },
    { status: "credentials_unavailable", message: "安全存储不可用" },
    { status: "revocation_pending", message: "正在撤销凭据", retryAllowed: true },
    authenticatedState,
  ])("decodes renderer-safe account state %#", async (state) => {
    mocks.invoke.mockResolvedValue(state);

    await expect(mocks.bridge?.getFdAccountState()).resolves.toEqual(state);
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.FD_ACCOUNT_GET_STATE_CHANNEL);
  });

  it("rejects a secret-bearing main-process response", async () => {
    mocks.invoke.mockResolvedValue({
      ...authenticatedState,
      accessToken: "must-not-cross",
    });

    await expect(mocks.bridge?.getFdAccountState()).rejects.toBeDefined();
  });

  it("forwards only schema-valid account state events", () => {
    const listener = vi.fn();
    const unsubscribe = mocks.bridge?.onFdAccountState(listener);
    const emit = mocks.listeners.get(IpcChannels.FD_ACCOUNT_STATE_CHANGED_CHANNEL);

    emit?.({}, authenticatedState);
    emit?.(
      {},
      {
        ...authenticatedState,
        runtimeApiKey: "must-not-cross",
      },
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.stringify(listener.mock.calls)).not.toMatch(/runtimeApiKey|must-not-cross/);
    unsubscribe?.();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IpcChannels.FD_ACCOUNT_STATE_CHANGED_CHANNEL,
      emit,
    );
  });

  it("rejects excess login input before IPC invocation", () => {
    expect(() =>
      mocks.bridge?.loginFdAccount({
        username: "employee",
        password: "test-only",
        accessToken: "forbidden",
      } as never),
    ).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("normalizes login input and decodes a successful login", async () => {
    mocks.invoke.mockResolvedValue({ ok: true, state: authenticatedState });

    await expect(
      mocks.bridge?.loginFdAccount({ username: "  employee  ", password: " password " }),
    ).resolves.toEqual({ ok: true, state: authenticatedState });
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.FD_ACCOUNT_LOGIN_CHANNEL, {
      username: "employee",
      password: " password ",
    });
  });

  it("decodes a login failure without widening its error contract", async () => {
    const result = {
      ok: false,
      code: "invalid_credentials",
      message: "账号或密码错误",
      state: { status: "anonymous" },
    } as const;
    mocks.invoke.mockResolvedValue(result);

    await expect(
      mocks.bridge?.loginFdAccount({ username: "employee", password: "test-only" }),
    ).resolves.toEqual(result);

    mocks.invoke.mockResolvedValue({ ...result, code: "unexpected_error" });
    await expect(
      mocks.bridge?.loginFdAccount({ username: "employee", password: "test-only" }),
    ).rejects.toBeDefined();
  });

  it("decodes completed and deferred logout results", async () => {
    mocks.invoke.mockResolvedValue({ completed: true, state: { status: "anonymous" } });
    await expect(mocks.bridge?.logoutFdAccount()).resolves.toEqual({
      completed: true,
      state: { status: "anonymous" },
    });

    mocks.invoke.mockResolvedValue({
      completed: false,
      code: "revocation_intent_unavailable",
      message: "无法保存撤销任务",
      state: authenticatedState,
    });
    await expect(mocks.bridge?.logoutFdAccount()).resolves.toEqual({
      completed: false,
      code: "revocation_intent_unavailable",
      message: "无法保存撤销任务",
      state: authenticatedState,
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannels.FD_ACCOUNT_LOGOUT_CHANNEL);
  });

  it("decodes explicit reload responses without exposing server policy", async () => {
    mocks.invoke.mockResolvedValue({ status: "anonymous" });
    await expect(mocks.bridge?.reloadFdAccount()).rejects.toBeDefined();

    mocks.invoke.mockResolvedValue({ state: { status: "anonymous" } });
    await expect(mocks.bridge?.reloadFdAccount()).resolves.toEqual({
      state: { status: "anonymous" },
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannels.FD_ACCOUNT_RELOAD_CHANNEL);
  });

  it("decodes revocation retries and rejects authenticated retry state", async () => {
    mocks.invoke.mockResolvedValue({
      completed: false,
      state: {
        status: "revocation_pending",
        message: "仍在撤销凭据",
        retryAllowed: true,
      },
    });
    await expect(mocks.bridge?.retryFdAccountRevocation()).resolves.toEqual({
      completed: false,
      state: {
        status: "revocation_pending",
        message: "仍在撤销凭据",
        retryAllowed: true,
      },
    });

    mocks.invoke.mockResolvedValue({ completed: false, state: authenticatedState });
    await expect(mocks.bridge?.retryFdAccountRevocation()).rejects.toBeDefined();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannels.FD_ACCOUNT_RETRY_REVOCATION_CHANNEL);
  });

  it("decodes Gateway usage summaries and rejects secret-bearing payloads", async () => {
    const summary = {
      readAt: "2026-08-12T10:00:00.000Z",
      quota: 410,
      promptTokens: 12_000,
      completionTokens: 3_000,
      requestCount: 15,
      failedCount: 1,
      rpm: 2,
      tpm: 1_500,
      averageUseTime: 1.25,
      daily: [{ day: 1_999_900_000, tokens: 2_000 }],
      models: [{ model: "deepseek-v4-flash", tokens: 15_000 }],
      dailyQuota: {
        limit: 1_000,
        used: 300,
        reserved: 20,
        remaining: 680,
        unlimited: false,
        resetsAt: 2_000_000_000,
      },
      monthlyQuota: {
        limit: 20_000,
        used: 4_000,
        reserved: 100,
        remaining: 15_900,
        unlimited: false,
        resetsAt: 2_000_100_000,
      },
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.3,
    };
    mocks.invoke.mockResolvedValue(summary);

    await expect(mocks.bridge?.getFdUsageSummary?.()).resolves.toEqual(summary);
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannels.FD_USAGE_GET_SUMMARY_CHANNEL);

    mocks.invoke.mockResolvedValue({ ...summary, accessToken: "must-not-cross" });
    await expect(mocks.bridge?.getFdUsageSummary?.()).rejects.toBeDefined();
  });
});
