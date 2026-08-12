import { describe, expect, it, vi } from "vite-plus/test";

import {
  CredentialVault,
  type PendingFdRevocation,
  type StoredFdCredentials,
  type StoredFdVaultState,
} from "./CredentialVault.ts";
import { FdIdentityBroker, type FdCredentialPublisher } from "./FdIdentityBroker.ts";
import { NewApiClient, NewApiClientError } from "./NewApiClient.ts";

describe("FdIdentityBroker", () => {
  it("validates persisted credentials before publishing and restores authenticated state", async () => {
    const stored = credentials();
    const order: string[] = [];
    const publisher = mockPublisher({
      set: vi.fn(async () => {
        order.push("projection.set");
      }),
    });
    const client = mockClient({ validate: vi.fn(async () => stored) });
    const broker = new FdIdentityBroker({
      vault: mockVault({
        load: vi.fn(async () => ({ active: stored, pendingRevocations: [] })),
        save: vi.fn(async () => {
          order.push("vault.save");
        }),
      }),
      client,
      publisher,
    });
    broker.subscribe((state) => {
      if (state.status === "authenticated") order.push("renderer.authenticated");
    });
    await broker.initialize();
    expect(client.validate).toHaveBeenCalledWith(stored);
    expect(publisher.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 31,
        runtimeTokenId: 41,
        runtimeApiKey: "sk-runtime-secret",
      }),
    );
    expect(broker.getState()).toMatchObject({
      status: "authenticated",
      profile: { id: 31 },
      capabilities: { generalAssistant: true },
      expiresAt: 2_000_000_000,
    });
    expect(order).toEqual(["vault.save", "projection.set", "renderer.authenticated"]);
  });

  it("orders logout as durable intent, clear projection, persist pending, DELETE token, then logout session", async () => {
    const calls: string[] = [];
    let storedState: StoredFdVaultState = { active: credentials(), pendingRevocations: [] };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
        calls.push(state.pendingRevocations.length > 0 ? "vault.pending" : "vault.clear-pending");
      }),
      markRevocationIntent: vi.fn(async () => {
        calls.push("intent.persist");
      }),
    });
    const publisher = mockPublisher({
      clear: vi.fn(async () => {
        calls.push("projection.clear");
      }),
    });
    const client = mockClient({
      validate: vi.fn(async (value: StoredFdCredentials) => value),
      revokeRuntimeTokens: vi.fn(async () => {
        calls.push("token.delete");
      }),
      logoutSession: vi.fn(async () => {
        calls.push("session.logout");
      }),
    });
    const broker = new FdIdentityBroker({ vault, client, publisher });
    await broker.initialize();
    calls.length = 0;
    const states: string[] = [];
    broker.subscribe((state) => states.push(state.status));

    const result = await broker.logout();

    expect(calls).toEqual([
      "intent.persist",
      "projection.clear",
      "vault.pending",
      "token.delete",
      "vault.pending",
      "session.logout",
      "vault.clear-pending",
    ]);
    expect(states[0]).toBe("revocation_pending");
    expect(result.completed).toBe(true);
    expect(result.state).toEqual({ status: "anonymous" });
  });

  it("persists and exposes revocation_pending when DELETE is unavailable, then retries safely", async () => {
    let storedState: StoredFdVaultState = { active: credentials(), pendingRevocations: [] };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
      }),
    });
    const revokeRuntimeTokens = vi
      .fn()
      .mockRejectedValueOnce(new NewApiClientError("service_unavailable", "offline"))
      .mockResolvedValueOnce(undefined);
    const authenticate = vi.fn(async () => ({
      ...authSession(),
      user: { ...authSession().user, id: 99, username: "different-user" },
    }));
    const logoutSession = vi.fn(async () => undefined);
    const client = mockClient({
      validate: vi.fn(async (value: StoredFdCredentials) => value),
      revokeRuntimeTokens,
      authenticate,
      logoutSession,
    });
    const broker = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await broker.initialize();
    const logout = await broker.logout();
    expect(logout.state).toMatchObject({ status: "revocation_pending", retryAllowed: true });
    expect(storedState.active).toBeNull();
    expect(storedState.pendingRevocations).toHaveLength(1);

    const login = await broker.login({ username: "different-user", password: "password" });
    expect(login).toMatchObject({ ok: false, code: "revocation_pending" });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(logoutSession).toHaveBeenCalledOnce();

    const retry = await broker.retryRevocation();
    expect(retry).toEqual({ completed: true, state: { status: "anonymous" } });
    expect(revokeRuntimeTokens).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent state-changing operations", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const broker = new FdIdentityBroker({
      vault: mockVault({
        load: vi.fn(async () => {
          order.push("initialize:start");
          await first;
          order.push("initialize:end");
          return { active: null, pendingRevocations: [] };
        }),
      }),
      client: mockClient(),
      publisher: mockPublisher(),
    });
    const initialize = broker.initialize();
    const logout = broker.logout().then(() => order.push("logout:end"));
    await Promise.resolve();
    expect(order).toEqual(["initialize:start"]);
    releaseFirst();
    await Promise.all([initialize, logout]);
    expect(order).toEqual(["initialize:start", "initialize:end", "logout:end"]);
  });

  it("journals an authenticated session before provisioning and recovers offline cleanup", async () => {
    const calls: string[] = [];
    let storedState: StoredFdVaultState = { active: null, pendingRevocations: [] };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
        calls.push(state.pendingRevocations.length > 0 ? "pending.persist" : "vault.preflight");
      }),
    });
    const revokeRuntimeTokens = vi.fn(async () => {
      calls.push("token.revoke");
      throw new NewApiClientError("service_unavailable", "offline");
    });
    const client = mockClient({
      authenticate: vi.fn(async () => {
        calls.push("authenticate");
        return authSession();
      }),
      provisionRuntimeToken: vi.fn(async () => {
        calls.push("provision");
        throw new NewApiClientError("service_unavailable", "offline");
      }),
      revokeRuntimeTokens,
    });
    const broker = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });

    await expect(
      broker.login({ username: "employee", password: "password" }),
    ).resolves.toMatchObject({
      ok: false,
      state: { status: "revocation_pending" },
    });
    expect(calls.indexOf("pending.persist")).toBeGreaterThan(calls.indexOf("authenticate"));
    expect(calls.indexOf("pending.persist")).toBeLessThan(calls.indexOf("provision"));
    expect(storedState.pendingRevocations).toEqual([
      expect.objectContaining({
        userId: 31,
        runtimeTokenName: "FD AI Desktop 100000000000",
        tokensRevoked: false,
      }),
    ]);

    const restarted = new FdIdentityBroker({
      vault,
      client: mockClient(),
      publisher: mockPublisher(),
    });
    await restarted.initialize();
    await expect(restarted.retryRevocation()).resolves.toEqual({
      completed: true,
      state: { status: "anonymous" },
    });
    expect(storedState).toEqual({ active: null, pendingRevocations: [] });
  });

  it("keeps exact-name cleanup durable when validation fails after provisioning", async () => {
    let storedState: StoredFdVaultState = { active: null, pendingRevocations: [] };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
      }),
    });
    const revokeRuntimeTokens = vi.fn(async () => {
      throw new NewApiClientError("service_unavailable", "offline");
    });
    const broker = new FdIdentityBroker({
      vault,
      client: mockClient({
        validate: vi.fn(async () => {
          throw new NewApiClientError("account_unavailable", "disabled");
        }),
        revokeRuntimeTokens,
      }),
      publisher: mockPublisher(),
      refreshIntervalMs: 0,
    });

    await expect(
      broker.login({ username: "employee", password: "password" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "account_unavailable",
      state: { status: "revocation_pending" },
    });
    expect(storedState.pendingRevocations[0]).toMatchObject({
      runtimeTokenName: "FD AI Desktop 100000000000",
      tokensRevoked: false,
    });
    expect(storedState.pendingRevocations[0]).not.toHaveProperty("runtimeTokenId");

    const restarted = new FdIdentityBroker({
      vault,
      client: mockClient(),
      publisher: mockPublisher(),
    });
    await restarted.initialize();
    await expect(restarted.retryRevocation()).resolves.toMatchObject({ completed: true });
    expect(storedState.pendingRevocations).toEqual([]);
  });

  it("clears an activated projection and keeps cleanup durable when active commit fails", async () => {
    let storedState: StoredFdVaultState = { active: null, pendingRevocations: [] };
    let failActiveCommit = true;
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        if (state.active && failActiveCommit) {
          failActiveCommit = false;
          throw new Error("simulated active commit failure");
        }
        storedState = state;
      }),
    });
    const publisher = mockPublisher();
    const states: string[] = [];
    const broker = new FdIdentityBroker({
      vault,
      client: mockClient({
        revokeRuntimeTokens: vi.fn(async () => {
          throw new NewApiClientError("service_unavailable", "offline");
        }),
      }),
      publisher,
      refreshIntervalMs: 0,
    });
    broker.subscribe((state) => states.push(state.status));

    await expect(
      broker.login({ username: "employee", password: "password" }),
    ).resolves.toMatchObject({
      ok: false,
      state: { status: "revocation_pending" },
    });
    expect(publisher.set).toHaveBeenCalledOnce();
    expect(publisher.clear).toHaveBeenCalledWith("login-failed");
    expect(states).not.toContain("authenticated");
    expect(storedState).toMatchObject({
      active: null,
      pendingRevocations: [
        {
          runtimeTokenName: "FD AI Desktop 100000000000",
          tokensRevoked: false,
        },
      ],
    });
  });

  it("recovers an interrupted logout as pending instead of reusing the active token", async () => {
    const active = credentials();
    const existingPending = pendingCredentials({
      userId: 29,
      runtimeTokenName: "FD AI Desktop device-old",
    });
    const vault = mockVault({
      load: vi.fn(async () => ({ active, pendingRevocations: [existingPending] })),
      hasRevocationIntent: vi.fn(async () => true),
    });
    const publisher = mockPublisher();
    const client = mockClient();
    const broker = new FdIdentityBroker({ vault, client, publisher });

    await broker.initialize();

    expect(broker.getState()).toMatchObject({ status: "revocation_pending" });
    expect(client.validate).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
    expect(vault.save).toHaveBeenCalledWith(
      expect.objectContaining({
        active: null,
        pendingRevocations: [
          existingPending,
          expect.objectContaining({ runtimeTokenName: credentials().runtimeTokenName }),
        ],
      }),
    );
  });

  it("retries every queued revocation without dropping or mixing account records", async () => {
    let storedState: StoredFdVaultState = {
      active: null,
      pendingRevocations: [
        pendingCredentials({ userId: 29, runtimeTokenName: "FD AI Desktop device-old" }),
        pendingCredentials({ userId: 31, runtimeTokenName: "FD AI Desktop device-new" }),
      ],
    };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
      }),
    });
    const deleted: string[] = [];
    const loggedOut: Array<[number, string]> = [];
    const client = mockClient({
      revokeRuntimeTokens: vi.fn(async (pending: PendingFdRevocation) => {
        deleted.push(pending.runtimeTokenName);
      }),
      logoutSession: vi.fn(async (pending: PendingFdRevocation) => {
        loggedOut.push([pending.userId, pending.runtimeTokenName]);
      }),
    });
    const broker = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });

    await broker.initialize();
    const result = await broker.retryRevocation();

    expect(result).toEqual({ completed: true, state: { status: "anonymous" } });
    expect(deleted).toEqual(["FD AI Desktop device-old", "FD AI Desktop device-new"]);
    expect(loggedOut).toEqual([
      [29, "FD AI Desktop device-old"],
      [31, "FD AI Desktop device-new"],
    ]);
    expect(storedState.pendingRevocations).toEqual([]);
  });

  it("keeps authenticated state and projection when revocation intent preflight fails", async () => {
    const active = credentials();
    const publisher = mockPublisher();
    const vault = mockVault({
      load: vi.fn(async () => ({ active, pendingRevocations: [] })),
      markRevocationIntent: vi.fn(async () => {
        throw new Error("test-only intent failure");
      }),
    });
    const broker = new FdIdentityBroker({ vault, client: mockClient(), publisher });
    await broker.initialize();
    vi.mocked(publisher.clear).mockClear();

    const result = await broker.logout();

    expect(result).toMatchObject({
      completed: false,
      code: "revocation_intent_unavailable",
      state: { status: "authenticated", profile: { id: 31 } },
    });
    expect(publisher.clear).not.toHaveBeenCalled();
    expect(vault.save).toHaveBeenCalledTimes(1);
  });

  it("persists pending and clears the durable intent before retrying remote revocation", async () => {
    let storedState: StoredFdVaultState = { active: credentials(), pendingRevocations: [] };
    let failPendingSave = true;
    let intent = false;
    const calls: string[] = [];
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      markRevocationIntent: vi.fn(async () => {
        intent = true;
      }),
      save: vi.fn(async (state: StoredFdVaultState) => {
        if (state.pendingRevocations.length > 0 && failPendingSave) {
          failPendingSave = false;
          throw new Error("test-only pending save failure");
        }
        storedState = state;
        calls.push(state.pendingRevocations.length > 0 ? "pending.persist" : "pending.clear");
      }),
      clearRevocationIntent: vi.fn(async () => {
        intent = false;
        calls.push("intent.clear");
      }),
    });
    const client = mockClient({
      revokeRuntimeTokens: vi.fn(async () => {
        calls.push("token.delete");
      }),
      logoutSession: vi.fn(async () => {
        calls.push("session.logout");
      }),
    });
    const broker = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await broker.initialize();
    calls.length = 0;

    await expect(broker.logout()).resolves.toMatchObject({
      completed: true,
      state: { status: "credentials_unavailable" },
    });
    expect(intent).toBe(true);
    expect(storedState.active).not.toBeNull();

    await expect(broker.retryRevocation()).resolves.toMatchObject({ completed: true });
    expect(calls).toEqual([
      "pending.persist",
      "intent.clear",
      "token.delete",
      "pending.persist",
      "session.logout",
      "pending.clear",
    ]);
    expect(intent).toBe(false);
    expect(storedState).toEqual({ active: null, pendingRevocations: [] });
  });

  it("coalesces concurrent explicit reloads into one validation and atomically republishes policy", async () => {
    const active = credentials();
    let release!: (value: StoredFdCredentials) => void;
    const pendingValidation = new Promise<StoredFdCredentials>((resolve) => {
      release = resolve;
    });
    const validate = vi
      .fn()
      .mockResolvedValueOnce(active)
      .mockImplementationOnce(() => pendingValidation);
    const publisher = mockPublisher();
    const broker = new FdIdentityBroker({
      vault: mockVault({ load: vi.fn(async () => ({ active, pendingRevocations: [] })) }),
      client: mockClient({ validate }),
      publisher,
      refreshIntervalMs: 0,
    });
    await broker.initialize();
    vi.mocked(publisher.set).mockClear();

    const first = broker.reload();
    const second = broker.reload();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(validate).toHaveBeenCalledTimes(2);
    release({ ...active, accessToken: "refreshed-access", accessExpiresAt: 2_000_000_100 });
    await expect(first).resolves.toMatchObject({ state: { status: "authenticated" } });
    expect(publisher.set).toHaveBeenCalledOnce();
    expect(publisher.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "refreshed-access",
        policy: expect.objectContaining({
          model: "deepseek-v4-flash",
          expiresAt: 2_000_000_100,
        }),
      }),
    );
  });

  it("recovers an authorization-invalidated account through same-user login", async () => {
    const active = credentials();
    let storedState: StoredFdVaultState = { active, pendingRevocations: [] };
    const publisher = mockPublisher();
    const validate = vi
      .fn()
      .mockResolvedValueOnce(active)
      .mockRejectedValueOnce(new NewApiClientError("account_unavailable", "disabled"))
      .mockImplementation(async (value: StoredFdCredentials) => value);
    const authenticate = vi.fn(async () => authSession());
    const revokeRuntimeTokens = vi.fn(async () => undefined);
    const logoutSession = vi.fn(async () => undefined);
    const client = mockClient({ validate, authenticate, revokeRuntimeTokens, logoutSession });
    const broker = new FdIdentityBroker({
      vault: mockVault({
        load: vi.fn(async () => storedState),
        save: vi.fn(async (state: StoredFdVaultState) => {
          storedState = state;
        }),
      }),
      client,
      publisher,
      refreshIntervalMs: 0,
    });
    await broker.initialize();
    vi.mocked(publisher.clear).mockClear();

    const result = await broker.reload();

    expect(result.state).toMatchObject({ status: "revocation_pending" });
    expect(publisher.clear).toHaveBeenCalledWith("reload-validation-failed");
    expect(JSON.stringify(result)).not.toMatch(/access-secret|sk-runtime-secret/);
    expect(storedState).toMatchObject({ active: null, pendingRevocations: [{ userId: 31 }] });

    await expect(
      broker.login({ username: "employee", password: "password" }),
    ).resolves.toMatchObject({ ok: true, state: { status: "authenticated" } });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(revokeRuntimeTokens).toHaveBeenCalledWith({
      accessToken: "access-secret",
      runtimeTokenName: active.runtimeTokenName,
    });
    expect(logoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: active.sessionId, tokensRevoked: true }),
      expect.any(Function),
    );
    expect(storedState).toMatchObject({ active: { user: { id: 31 } }, pendingRevocations: [] });
  });

  it("periodically revalidates authenticated policy until disposed", async () => {
    vi.useFakeTimers();
    const active = credentials();
    const validate = vi.fn(async () => active);
    const broker = new FdIdentityBroker({
      vault: mockVault({ load: vi.fn(async () => ({ active, pendingRevocations: [] })) }),
      client: mockClient({ validate }),
      publisher: mockPublisher(),
      refreshIntervalMs: 100,
    });
    try {
      await broker.initialize();
      expect(validate).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(100);
      expect(validate).toHaveBeenCalledTimes(2);
      await broker.dispose();
      await vi.advanceTimersByTimeAsync(200);
      expect(validate).toHaveBeenCalledTimes(2);
    } finally {
      await broker.dispose();
      vi.useRealTimers();
    }
  });

  it("does not start periodic refresh when disposed during initialize", async () => {
    vi.useFakeTimers();
    const active = credentials();
    let releaseLoad!: (state: StoredFdVaultState) => void;
    const pendingLoad = new Promise<StoredFdVaultState>((resolve) => {
      releaseLoad = resolve;
    });
    const validate = vi.fn(async (value: StoredFdCredentials) => value);
    const publisher = mockPublisher();
    const states: string[] = [];
    const broker = new FdIdentityBroker({
      vault: mockVault({ load: vi.fn(() => pendingLoad) }),
      client: mockClient({ validate }),
      publisher,
      refreshIntervalMs: 100,
    });
    broker.subscribe((state) => states.push(state.status));
    try {
      const initialize = broker.initialize();
      await Promise.resolve();
      let scopeClosed = false;
      const dispose = broker.dispose().then(() => {
        scopeClosed = true;
      });
      await Promise.resolve();
      expect(scopeClosed).toBe(false);
      releaseLoad({ active, pendingRevocations: [] });
      await Promise.all([initialize, dispose]);
      expect(validate).toHaveBeenCalledOnce();
      expect(publisher.set).toHaveBeenCalledOnce();
      expect(states).toEqual(["authenticated"]);
      const projectionCountAtScopeClose = vi.mocked(publisher.set).mock.calls.length;
      const stateCountAtScopeClose = states.length;

      await vi.advanceTimersByTimeAsync(300);
      expect(validate).toHaveBeenCalledOnce();
      expect(publisher.set).toHaveBeenCalledTimes(projectionCountAtScopeClose);
      expect(states).toHaveLength(stateCountAtScopeClose);
    } finally {
      await broker.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps expired pending revocation durable when refresh is offline", async () => {
    const pending = pendingCredentials({ accessExpiresAt: 1 });
    const revokeRuntimeTokens = vi.fn();
    const broker = new FdIdentityBroker({
      vault: mockVault({
        load: vi.fn(async () => ({ active: null, pendingRevocations: [pending] })),
      }),
      client: mockClient({
        refreshPendingRevocation: vi.fn(async () => {
          throw new NewApiClientError("service_unavailable", "offline");
        }),
        revokeRuntimeTokens,
      }),
      publisher: mockPublisher(),
    });
    await broker.initialize();

    await expect(broker.retryRevocation()).resolves.toMatchObject({ completed: false });
    expect(revokeRuntimeTokens).not.toHaveBeenCalled();
  });

  it("recovers after crashing between remote DELETE and tokensRevoked persistence", async () => {
    const pending = pendingCredentials();
    let storedState: StoredFdVaultState = { active: null, pendingRevocations: [pending] };
    let failTokensRevokedSave = true;
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        if (state.pendingRevocations[0]?.tokensRevoked && failTokensRevokedSave) {
          failTokensRevokedSave = false;
          throw new Error("simulated crash");
        }
        storedState = state;
      }),
    });
    const revokeRuntimeTokens = vi.fn(async () => undefined);
    const client = mockClient({ revokeRuntimeTokens });
    const first = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await first.initialize();
    await expect(first.retryRevocation()).resolves.toMatchObject({ completed: false });
    expect(storedState.pendingRevocations[0]?.tokensRevoked).toBe(false);

    const restarted = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await restarted.initialize();
    await expect(restarted.retryRevocation()).resolves.toMatchObject({ completed: true });
    expect(revokeRuntimeTokens).toHaveBeenCalledTimes(2);
  });

  it("recovers after crashing between remote logout and pending clear", async () => {
    let storedState: StoredFdVaultState = {
      active: null,
      pendingRevocations: [pendingCredentials({ tokensRevoked: true })],
    };
    let failClearSave = true;
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        if (state.pendingRevocations.length === 0 && failClearSave) {
          failClearSave = false;
          throw new Error("simulated crash");
        }
        storedState = state;
      }),
    });
    const logoutSession = vi.fn(async () => undefined);
    const client = mockClient({ logoutSession });
    const first = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await first.initialize();
    await expect(first.retryRevocation()).resolves.toMatchObject({ completed: false });

    const restarted = new FdIdentityBroker({ vault, client, publisher: mockPublisher() });
    await restarted.initialize();
    await expect(restarted.retryRevocation()).resolves.toMatchObject({ completed: true });
    expect(logoutSession).toHaveBeenCalledTimes(2);
  });

  it("retries logout without refreshing an expired session after restart", async () => {
    const pending = pendingCredentials({ tokensRevoked: true, accessExpiresAt: 1 });
    let storedState: StoredFdVaultState = {
      active: null,
      pendingRevocations: [pending],
    };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
      }),
    });
    const refreshPendingRevocation = vi.fn(async () => {
      throw new Error("must not refresh an already-deleted token");
    });
    const logoutSession = vi.fn(async () => undefined);
    const broker = new FdIdentityBroker({
      vault,
      client: mockClient({ refreshPendingRevocation, logoutSession }),
      publisher: mockPublisher(),
    });

    await broker.initialize();
    await expect(broker.retryRevocation()).resolves.toEqual({
      completed: true,
      state: { status: "anonymous" },
    });

    expect(refreshPendingRevocation).not.toHaveBeenCalled();
    expect(logoutSession).toHaveBeenCalledOnce();
    expect(logoutSession).toHaveBeenCalledWith(pending, expect.any(Function));
    expect(storedState.pendingRevocations).toEqual([]);
  });

  it("persists a mismatch-refreshed session before a failed logout retry", async () => {
    const pending = pendingCredentials({ tokensRevoked: true, accessExpiresAt: 1 });
    let storedState: StoredFdVaultState = {
      active: null,
      pendingRevocations: [pending],
    };
    const vault = mockVault({
      load: vi.fn(async () => storedState),
      save: vi.fn(async (state: StoredFdVaultState) => {
        storedState = state;
      }),
    });
    const logoutSession = vi.fn(
      async (
        _current: PendingFdRevocation,
        persistRefreshed: (value: PendingFdRevocation) => Promise<void>,
      ) => {
        await persistRefreshed({
          ...pending,
          accessToken: "access-recovered",
          accessExpiresAt: 2_000_000_100,
          refreshCookie: "new_api_refresh=refresh-recovered",
          sessionId: "session-recovered",
        });
        throw new NewApiClientError("service_unavailable", "offline");
      },
    );
    const broker = new FdIdentityBroker({
      vault,
      client: mockClient({ logoutSession }),
      publisher: mockPublisher(),
    });

    await broker.initialize();
    await expect(broker.retryRevocation()).resolves.toMatchObject({ completed: false });
    expect(storedState.pendingRevocations[0]).toMatchObject({
      tokensRevoked: true,
      accessToken: "access-recovered",
      refreshCookie: "new_api_refresh=refresh-recovered",
      sessionId: "session-recovered",
    });
  });
});

function credentials(): StoredFdCredentials {
  return {
    user: { id: 31, username: "employee", displayName: "Employee" },
    accessToken: "access-secret",
    accessExpiresAt: 2_000_000_000,
    sessionId: "session-id",
    refreshCookie: "new_api_refresh=refresh-secret",
    runtimeApiKey: "sk-runtime-secret",
    runtimeTokenId: 41,
    runtimeTokenName: "FD AI Desktop 100000000000",
  };
}

function authSession() {
  const value = credentials();
  return {
    user: value.user,
    accessToken: value.accessToken,
    accessExpiresAt: value.accessExpiresAt,
    sessionId: value.sessionId,
    refreshCookie: value.refreshCookie,
  };
}

function pendingCredentials(overrides: Partial<PendingFdRevocation> = {}): PendingFdRevocation {
  return {
    userId: 31,
    accessToken: "access-secret",
    accessExpiresAt: 2_000_000_000,
    sessionId: "session-id",
    refreshCookie: "new_api_refresh=refresh-secret",
    runtimeTokenName: "FD AI Desktop 100000000000",
    tokensRevoked: false,
    ...overrides,
  };
}

function mockVault(
  overrides: Partial<Record<keyof CredentialVault, unknown>> = {},
): CredentialVault {
  return {
    load: vi.fn(async () => ({ active: null, pendingRevocations: [] })),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    markRevocationIntent: vi.fn(async () => undefined),
    hasRevocationIntent: vi.fn(async () => false),
    clearRevocationIntent: vi.fn(async () => undefined),
    deviceId: vi.fn(async () => "10000000-0000-4000-8000-000000000001"),
    ...overrides,
  } as unknown as CredentialVault;
}

function mockClient(overrides: Partial<Record<keyof NewApiClient, unknown>> = {}): NewApiClient {
  const client = {
    authenticate: vi.fn(async () => ({
      user: credentials().user,
      accessToken: credentials().accessToken,
      accessExpiresAt: credentials().accessExpiresAt,
      sessionId: credentials().sessionId,
      refreshCookie: credentials().refreshCookie,
    })),
    provisionRuntimeToken: vi.fn(async () => ({ id: 41, key: "sk-runtime-secret" })),
    validate: vi.fn(async (value: StoredFdCredentials) => value),
    revokeRuntimeTokens: vi.fn(async (_value: PendingFdRevocation) => undefined),
    refreshPendingRevocation: vi.fn(async (value: PendingFdRevocation) => value),
    logoutSession: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as NewApiClient;
  return client;
}

function mockPublisher(overrides: Partial<FdCredentialPublisher> = {}): FdCredentialPublisher {
  return {
    set: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    ...overrides,
  };
}
