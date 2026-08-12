import type {
  FdAccountLoginInput,
  FdAccountLoginResult,
  FdAccountLogoutResult,
  FdAccountReloadResult,
  FdAccountState,
  FdRetryRevocationResult,
  FdUsageSummary,
} from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import {
  CredentialVault,
  CredentialVaultCorruptError,
  MAX_PENDING_FD_REVOCATIONS,
  SecureStorageUnavailableError,
  type PendingFdRevocation,
  type StoredFdCredentials,
  type StoredFdVaultState,
} from "./CredentialVault.ts";
import {
  NewApiClient,
  NewApiClientError,
  desktopRuntimeTokenName,
  type NewApiAuthSession,
} from "./NewApiClient.ts";

const REVOCATION_MESSAGE = "远程退出尚未完成，请联网后重试。当前设备已停止访问企业 AI。";
const STORAGE_MESSAGE = "系统安全存储不可用，请解锁系统凭据后重试。";
const VALIDATION_MESSAGE = "暂时无法验证企业账号，请检查网络后重试。";
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

export interface FdCredentialPublisher {
  set(credentials: Omit<FdServerRuntimeCredentialProjection, "newApiOrigin">): Promise<void>;
  clear(reason: string): Promise<void>;
}

export class FdIdentityBroker {
  readonly #vault: CredentialVault;
  readonly #client: NewApiClient;
  readonly #publisher: FdCredentialPublisher;
  readonly #listeners = new Set<(state: FdAccountState) => void>();
  #vaultState: StoredFdVaultState = { active: null, pendingRevocations: [] };
  #state: FdAccountState = { status: "checking" };
  #operation: Promise<unknown> = Promise.resolve();
  #refreshFlight: Promise<FdAccountReloadResult> | undefined;
  #refreshTimer: ReturnType<typeof setInterval> | undefined;
  readonly #refreshIntervalMs: number;
  #generation = 0;
  #disposed = false;
  #disposeFlight: Promise<void> | undefined;

  constructor(options: {
    vault: CredentialVault;
    client: NewApiClient;
    publisher: FdCredentialPublisher;
    refreshIntervalMs?: number;
  }) {
    this.#vault = options.vault;
    this.#client = options.client;
    this.#publisher = options.publisher;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  }

  initialize(): Promise<void> {
    return this.#serialize(async () => {
      try {
        this.#vaultState = await this.#vault.load();
        if (await this.#vault.hasRevocationIntent()) {
          const interruptedActive = this.#vaultState.active;
          this.#vaultState = {
            active: null,
            pendingRevocations:
              interruptedActive === null
                ? this.#vaultState.pendingRevocations
                : enqueuePendingRevocation(
                    this.#vaultState.pendingRevocations,
                    toPendingRevocation(interruptedActive),
                  ),
          };
          await this.#vault.save(this.#vaultState);
          await this.#vault.clearRevocationIntent();
        }
      } catch {
        await this.#clearProjection("secure-storage-unavailable");
        this.#setState({ status: "credentials_unavailable", message: STORAGE_MESSAGE });
        return;
      }
      if (this.#vaultState.pendingRevocations.length > 0) {
        await this.#clearProjection("revocation-pending");
        this.#setRevocationPending();
        return;
      }
      const active = this.#vaultState.active;
      if (!active) {
        await this.#clearProjection("anonymous");
        this.#setState({ status: "anonymous" });
        return;
      }
      await this.#refreshActive("bootstrap");
      this.#startPeriodicRefresh();
    });
  }

  getState(): FdAccountState {
    return structuredClone(this.#state);
  }

  subscribe(listener: (state: FdAccountState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reload(): Promise<FdAccountReloadResult> {
    if (this.#refreshFlight) return this.#refreshFlight;
    const flight = this.#serialize(async () => {
      if (this.#vaultState.pendingRevocations.length > 0) {
        this.#setRevocationPending();
        return { state: this.getState() };
      }
      if (!this.#vaultState.active) {
        this.#setState({ status: "anonymous" });
        return { state: this.getState() };
      }
      await this.#refreshActive("reload");
      return { state: this.getState() };
    });
    this.#refreshFlight = flight;
    void flight
      .finally(() => {
        if (this.#refreshFlight === flight) this.#refreshFlight = undefined;
      })
      .catch(() => undefined);
    return flight;
  }

  getUsageSummary(): Promise<FdUsageSummary> {
    return this.#serialize(async () => {
      const active = this.#vaultState.active;
      if (!active || this.#state.status !== "authenticated") {
        throw new NewApiClientError("account_unavailable", "请先登录员工账号");
      }
      return this.#client.getUsageSummary(active);
    });
  }

  dispose(): Promise<void> {
    if (this.#disposeFlight) return this.#disposeFlight;
    this.#disposed = true;
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    this.#refreshTimer = undefined;
    this.#disposeFlight = this.#drainOperations();
    return this.#disposeFlight;
  }

  login(input: FdAccountLoginInput): Promise<FdAccountLoginResult> {
    return this.#serialize(async () => {
      let recoveredAuth: NewApiAuthSession | undefined;
      if (this.#vaultState.pendingRevocations.length > 0) {
        try {
          recoveredAuth = await this.#client.authenticate(input.username.trim(), input.password);
        } catch (error) {
          this.#setRevocationPending();
          return { ...loginFailure(error), state: this.getState() };
        }
        if (
          this.#vaultState.pendingRevocations.some(
            (pending) => pending.userId !== recoveredAuth?.user.id,
          )
        ) {
          await this.#client
            .logoutSession(toPendingRevocationFromAuth(recoveredAuth, "authentication-recovery"))
            .catch(() => undefined);
          this.#setRevocationPending();
          return {
            ok: false,
            code: "revocation_pending",
            message: "请使用上次登录的员工账号完成安全恢复。",
            state: this.getState(),
          };
        }
        if (!(await this.#recoverPendingRevocations(recoveredAuth))) {
          return {
            ok: false,
            code: "revocation_pending",
            message: REVOCATION_MESSAGE,
            state: this.getState(),
          };
        }
      }
      if (this.#vaultState.active) {
        return {
          ok: false,
          code: "account_unavailable",
          message: "当前账号状态需要先刷新，无法直接切换账号。",
          state: this.getState(),
        };
      }
      let pending: PendingFdRevocation | undefined;
      try {
        const deviceId = await this.#vault.deviceId();
        const runtimeTokenName = desktopRuntimeTokenName(deviceId);
        await this.#vault.save(this.#vaultState);
        const auth =
          recoveredAuth ?? (await this.#client.authenticate(input.username.trim(), input.password));
        pending = toPendingRevocationFromAuth(auth, runtimeTokenName);
        const pendingState: StoredFdVaultState = {
          active: null,
          pendingRevocations: [pending],
        };
        await this.#vault.save(pendingState);
        this.#vaultState = pendingState;
        const runtime = await this.#client.provisionRuntimeToken(auth, runtimeTokenName);
        let credentials: StoredFdCredentials = {
          ...auth,
          runtimeTokenId: runtime.id,
          runtimeApiKey: runtime.key,
          runtimeTokenName,
        };
        credentials = await this.#client.validate(credentials);
        pending = toPendingRevocation(credentials);
        const validatedPendingState: StoredFdVaultState = {
          active: null,
          pendingRevocations: [pending],
        };
        await this.#vault.save(validatedPendingState);
        this.#vaultState = validatedPendingState;
        await this.#publishProjection(credentials);
        const activeState: StoredFdVaultState = { active: credentials, pendingRevocations: [] };
        await this.#vault.save(activeState);
        this.#vaultState = activeState;
        this.#setState(this.#authenticatedState(credentials));
        this.#startPeriodicRefresh();
        return {
          ok: true,
          state: this.getState() as Extract<FdAccountState, { status: "authenticated" }>,
        };
      } catch (error) {
        await this.#clearProjection("login-failed").catch(() => undefined);
        if (!pending) {
          this.#setState({ status: "anonymous" });
          return { ...loginFailure(error), state: this.getState() };
        }
        const pendingState: StoredFdVaultState = {
          active: null,
          pendingRevocations: enqueuePendingRevocation(
            this.#vaultState.pendingRevocations,
            pending,
          ),
        };
        try {
          await this.#vault.save(pendingState);
          this.#vaultState = pendingState;
          this.#setRevocationPending();
          await this.#completePendingRevocation(pending);
        } catch {
          this.#setState({ status: "credentials_unavailable", message: STORAGE_MESSAGE });
        }
        return { ...loginFailure(error), state: this.getState() };
      }
    });
  }

  logout(): Promise<FdAccountLogoutResult> {
    return this.#serialize(async () => {
      const active = this.#vaultState.active;
      if (!active) {
        if (this.#vaultState.pendingRevocations.length > 0) {
          this.#setRevocationPending();
          return { completed: true, state: this.#nonAuthenticatedState() };
        }
        this.#setState({ status: "anonymous" });
        return { completed: true, state: { status: "anonymous" } };
      }

      const pending = toPendingRevocation(active);
      try {
        await this.#vault.markRevocationIntent();
      } catch {
        return {
          completed: false,
          code: "revocation_intent_unavailable",
          message: "无法安全记录退出操作，账号仍保持登录，请解锁系统凭据后重试。",
          state: this.#authenticatedState(active),
        };
      }

      await this.#clearProjection("logout");
      this.#vaultState = { active: null, pendingRevocations: [pending] };
      this.#setRevocationPending();
      try {
        await this.#vault.save(this.#vaultState);
        await this.#vault.clearRevocationIntent();
      } catch {
        this.#setState({ status: "credentials_unavailable", message: STORAGE_MESSAGE });
        return { completed: true, state: this.#nonAuthenticatedState() };
      }
      await this.#completePendingRevocation(pending);
      return { completed: true, state: this.#nonAuthenticatedState() };
    });
  }

  retryRevocation(): Promise<FdRetryRevocationResult> {
    return this.#serialize(async () => {
      await this.#clearProjection("retry-revocation");
      if (this.#vaultState.pendingRevocations.length === 0) {
        this.#setState({ status: "anonymous" });
        return { completed: true, state: { status: "anonymous" } };
      }
      try {
        await this.#vault.save(this.#vaultState);
        await this.#vault.clearRevocationIntent();
      } catch {
        this.#setState({ status: "credentials_unavailable", message: STORAGE_MESSAGE });
        return { completed: false, state: this.#nonAuthenticatedState() };
      }
      while (this.#vaultState.pendingRevocations.length > 0) {
        const pending = this.#vaultState.pendingRevocations[0];
        if (!pending || !(await this.#completePendingRevocation(pending))) break;
      }
      return {
        completed: this.#vaultState.pendingRevocations.length === 0,
        state: this.getState() as FdRetryRevocationResult["state"],
      };
    });
  }

  async #completePendingRevocation(pending: PendingFdRevocation): Promise<boolean> {
    try {
      let current = pending;
      const remaining = this.#vaultState.pendingRevocations.slice(1);
      if (!current.tokensRevoked) {
        current = await this.#client.refreshPendingRevocation(current);
        if (current !== pending) {
          this.#vaultState = { active: null, pendingRevocations: [current, ...remaining] };
          await this.#vault.save(this.#vaultState);
        }
        await this.#client.revokeRuntimeTokens({
          accessToken: current.accessToken,
          runtimeTokenName: current.runtimeTokenName,
        });
        current = { ...current, tokensRevoked: true };
        this.#vaultState = { active: null, pendingRevocations: [current, ...remaining] };
        await this.#vault.save(this.#vaultState);
      }
      await this.#client.logoutSession(current, async (refreshed) => {
        current = refreshed;
        this.#vaultState = { active: null, pendingRevocations: [current, ...remaining] };
        await this.#vault.save(this.#vaultState);
      });
      const completedState: StoredFdVaultState = {
        active: null,
        pendingRevocations: remaining,
      };
      await this.#vault.save(completedState);
      this.#vaultState = completedState;
      if (remaining.length === 0) this.#setState({ status: "anonymous" });
      else this.#setRevocationPending();
      return true;
    } catch {
      this.#setRevocationPending();
      return false;
    }
  }

  async #recoverPendingRevocations(auth: NewApiAuthSession): Promise<boolean> {
    try {
      while (this.#vaultState.pendingRevocations.length > 0) {
        let pending = this.#vaultState.pendingRevocations[0]!;
        const remaining = this.#vaultState.pendingRevocations.slice(1);
        if (!pending.tokensRevoked) {
          await this.#client.revokeRuntimeTokens({
            accessToken: auth.accessToken,
            runtimeTokenName: pending.runtimeTokenName,
          });
          pending = { ...pending, tokensRevoked: true };
          this.#vaultState = { active: null, pendingRevocations: [pending, ...remaining] };
          await this.#vault.save(this.#vaultState);
        }
        await this.#client.logoutSession(pending, async (refreshed) => {
          pending = refreshed;
          this.#vaultState = { active: null, pendingRevocations: [pending, ...remaining] };
          await this.#vault.save(this.#vaultState);
        });
        this.#vaultState = { active: null, pendingRevocations: remaining };
        await this.#vault.save(this.#vaultState);
      }
      this.#setState({ status: "anonymous" });
      return true;
    } catch {
      this.#setRevocationPending();
      return false;
    }
  }

  async #publishProjection(credentials: StoredFdCredentials): Promise<void> {
    this.#generation += 1;
    await this.#publisher.set({
      userId: credentials.user.id,
      runtimeTokenId: credentials.runtimeTokenId,
      runtimeApiKey: credentials.runtimeApiKey,
      accessToken: credentials.accessToken,
      accessExpiresAt: credentials.accessExpiresAt,
      policy: {
        version: 1,
        capability: "general_assistant",
        model: "deepseek-v4-flash",
        expiresAt: credentials.accessExpiresAt,
      },
      generation: this.#generation,
    });
  }

  async #refreshActive(reason: string): Promise<void> {
    const active = this.#vaultState.active;
    if (!active) return;
    try {
      const validated = await this.#client.validate(active);
      const validatedState = { ...this.#vaultState, active: validated };
      await this.#vault.save(validatedState);
      this.#vaultState = validatedState;
      await this.#publishProjection(validated);
      this.#setState(this.#authenticatedState(validated));
    } catch (error) {
      await this.#clearProjection(`${reason}-validation-failed`);
      if (error instanceof NewApiClientError && error.code === "account_unavailable") {
        try {
          const pendingState: StoredFdVaultState = {
            active: null,
            pendingRevocations: enqueuePendingRevocation(
              this.#vaultState.pendingRevocations,
              toPendingRevocation(active),
            ),
          };
          await this.#vault.save(pendingState);
          this.#vaultState = pendingState;
          this.#setRevocationPending();
        } catch {
          this.#setState({ status: "credentials_unavailable", message: STORAGE_MESSAGE });
        }
        return;
      }
      this.#setState({
        status: "credentials_unavailable",
        message: VALIDATION_MESSAGE,
      });
    }
  }

  #authenticatedState(
    credentials: StoredFdCredentials,
  ): Extract<FdAccountState, { status: "authenticated" }> {
    return {
      status: "authenticated",
      policyVersion: 1,
      profile: credentials.user,
      capabilities: { generalAssistant: true },
      expiresAt: credentials.accessExpiresAt,
    };
  }

  #nonAuthenticatedState(): Exclude<FdAccountState, { status: "checking" | "authenticated" }> {
    const state = this.getState();
    if (state.status === "checking" || state.status === "authenticated") {
      return { status: "credentials_unavailable", message: STORAGE_MESSAGE };
    }
    return state;
  }

  #startPeriodicRefresh(): void {
    if (this.#disposed || this.#refreshIntervalMs <= 0 || this.#refreshTimer) return;
    // @effect-diagnostics globalTimers:off
    this.#refreshTimer = setInterval(() => {
      if (
        !this.#disposed &&
        this.#vaultState.active &&
        this.#vaultState.pendingRevocations.length === 0
      ) {
        void this.reload().catch(() => undefined);
      }
    }, this.#refreshIntervalMs);
    this.#refreshTimer.unref?.();
  }

  async #clearProjection(reason: string): Promise<void> {
    this.#generation += 1;
    await this.#publisher.clear(reason);
  }

  #setRevocationPending(): void {
    this.#setState({
      status: "revocation_pending",
      message: REVOCATION_MESSAGE,
      retryAllowed: true,
    });
  }

  #setState(state: FdAccountState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(this.getState());
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#operation.then(operation, operation);
    this.#operation = next.catch(() => undefined);
    return next;
  }

  async #drainOperations(): Promise<void> {
    while (true) {
      const operation = this.#operation;
      await operation;
      if (operation === this.#operation) {
        this.#listeners.clear();
        return;
      }
    }
  }
}

function toPendingRevocation(credentials: StoredFdCredentials): PendingFdRevocation {
  return {
    userId: credentials.user.id,
    accessToken: credentials.accessToken,
    accessExpiresAt: credentials.accessExpiresAt,
    sessionId: credentials.sessionId,
    refreshCookie: credentials.refreshCookie,
    runtimeTokenName: credentials.runtimeTokenName,
    tokensRevoked: false,
  };
}

function toPendingRevocationFromAuth(
  auth: NewApiAuthSession,
  runtimeTokenName: string,
): PendingFdRevocation {
  return {
    userId: auth.user.id,
    accessToken: auth.accessToken,
    accessExpiresAt: auth.accessExpiresAt,
    sessionId: auth.sessionId,
    refreshCookie: auth.refreshCookie,
    runtimeTokenName,
    tokensRevoked: false,
  };
}

function enqueuePendingRevocation(
  existing: readonly PendingFdRevocation[],
  pending: PendingFdRevocation,
): readonly PendingFdRevocation[] {
  const existingIndex = existing.findIndex(
    (entry) =>
      entry.userId === pending.userId && entry.runtimeTokenName === pending.runtimeTokenName,
  );
  if (existingIndex >= 0) {
    return existing.map((entry, index) => (index === existingIndex ? pending : entry));
  }
  if (existing.length >= MAX_PENDING_FD_REVOCATIONS) {
    throw new CredentialVaultCorruptError();
  }
  return [...existing, pending];
}

function loginFailure(error: unknown): Extract<FdAccountLoginResult, { readonly ok: false }> {
  if (error instanceof SecureStorageUnavailableError) {
    return { ok: false, code: "secure_storage_unavailable", message: STORAGE_MESSAGE };
  }
  if (error instanceof NewApiClientError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return {
    ok: false,
    code: "service_unavailable",
    message: "企业 AI 服务暂时不可用，请稍后重试。",
  };
}
