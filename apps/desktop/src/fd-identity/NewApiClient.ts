import type { FdAccountUserSummary, FdUsagePeriod, FdUsageSummary } from "@t3tools/contracts";
import {
  FD_RUNTIME_DEFAULT_MODEL,
  FD_RUNTIME_MODELS,
} from "@t3tools/contracts/fd/runtime-credentials";

import type { StoredFdCredentials } from "./CredentialVault.ts";
import {
  NewApiHttpClient,
  NewApiHttpError,
  type NewApiHttpOptions,
  type NewApiResponse,
} from "./NewApiHttpClient.ts";

const REFRESH_COOKIE_NAME = "new_api_refresh";
const MAX_RUNTIME_TOKEN_REVOCATION_PASSES = 8;
const MAX_RUNTIME_TOKEN_REVOCATION_CANDIDATES = 800;
export const FD_RUNTIME_MODEL = FD_RUNTIME_DEFAULT_MODEL;
export const FD_RUNTIME_MODEL_LIMITS = FD_RUNTIME_MODELS.join(",");

export type NewApiErrorCode =
  | "invalid_credentials"
  | "two_factor_required"
  | "account_unavailable"
  | "service_unavailable";

export class NewApiClientError extends Error {
  readonly code: NewApiErrorCode;

  constructor(code: NewApiErrorCode, message: string) {
    super(message);
    this.name = "NewApiClientError";
    this.code = code;
  }
}

export interface NewApiAuthSession {
  accessToken: string;
  accessExpiresAt: number;
  refreshCookie: string;
  sessionId: string;
  user: FdAccountUserSummary;
}

export interface NewApiSessionCredentials {
  accessToken: string;
  refreshCookie: string;
  sessionId: string;
}

export interface NewApiRuntimeTokenRevocation {
  accessToken: string;
  runtimeTokenName: string;
}

export interface NewApiPendingRevocationSession extends NewApiSessionCredentials {
  accessExpiresAt: number;
  userId: number;
  runtimeTokenName: string;
  tokensRevoked: boolean;
}

interface NewApiRuntimeTokenId {
  accessToken: string;
  runtimeTokenId: number;
}

interface RuntimeToken {
  id: number;
  name: string;
  status: number;
  expiredTime: number;
  remainQuota: number;
  unlimitedQuota: boolean;
  modelLimitsEnabled: boolean;
  modelLimits: string;
  allowIps: string;
  group: string;
  crossGroupRetry: boolean;
}

export type NewApiClientOptions = NewApiHttpOptions;

export class NewApiClient {
  readonly #http: NewApiHttpClient;

  constructor(options: NewApiClientOptions) {
    this.#http = new NewApiHttpClient(options);
  }

  async authenticate(username: string, password: string): Promise<NewApiAuthSession> {
    const response = await this.#request("/api/user/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!response.body.success) {
      throw new NewApiClientError("invalid_credentials", "用户名或密码不正确");
    }
    const data = object(response.body.data);
    if (data.require_2fa === true) {
      throw new NewApiClientError("two_factor_required", "当前账号需要两步验证，请联系管理员");
    }
    return parseAuthSession(response);
  }

  async provisionRuntimeToken(
    auth: NewApiAuthSession,
    tokenName: string,
  ): Promise<{ id: number; key: string }> {
    if (tokenName.length < 1 || tokenName.length > 50)
      throw new Error("Runtime Token name is invalid");
    await this.revokeRuntimeTokens({ accessToken: auth.accessToken, runtimeTokenName: tokenName });
    const created = await this.#request("/api/token/", {
      method: "POST",
      headers: bearer(auth.accessToken),
      body: JSON.stringify({
        name: tokenName,
        expired_time: -1,
        status: 1,
        unlimited_quota: true,
        model_limits_enabled: true,
        model_limits: FD_RUNTIME_MODEL_LIMITS,
      }),
    });
    if (!created.body.success) {
      throw new NewApiClientError("account_unavailable", "无法配置桌面模型权限，请联系管理员");
    }
    const matches = await this.#findRuntimeTokens(auth.accessToken, tokenName);
    if (matches.length !== 1) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限配置失败");
    }
    const token = matches[0]!;
    assertManagedRuntimeToken(token);
    const keyResponse = await this.#request(`/api/token/${token.id}/key`, {
      method: "POST",
      headers: bearer(auth.accessToken),
    });
    if (!keyResponse.body.success) {
      throw new NewApiClientError("account_unavailable", "桌面模型凭据创建失败");
    }
    const key = stringField(object(keyResponse.body.data), "key", 16_384);
    return { id: token.id, key: key.startsWith("sk-") ? key : `sk-${key}` };
  }

  async validate(credentials: StoredFdCredentials): Promise<StoredFdCredentials> {
    let validated = credentials;
    // @effect-diagnostics globalDate:off
    if (credentials.accessExpiresAt <= Math.floor(Date.now() / 1_000) + 30) {
      validated = await this.refresh(credentials);
    }
    const selfResponse = await this.#request("/api/user/self", {
      headers: bearer(validated.accessToken),
    });
    if (!selfResponse.body.success) {
      throw new NewApiClientError("account_unavailable", "账号或企业权限已停用，请重新登录");
    }
    const user = parseUser(selfResponse.body.data);
    if (user.id !== credentials.user.id) {
      throw new NewApiClientError("account_unavailable", "登录身份已变更，请重新登录");
    }
    validated = { ...validated, user };
    const response = await this.#request(`/api/token/${validated.runtimeTokenId}`, {
      headers: bearer(validated.accessToken),
    });
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限已失效，请联系管理员");
    }
    let token = parseRuntimeToken(response.body.data);
    if (token.id !== validated.runtimeTokenId) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限身份不匹配");
    }
    if (token.name !== validated.runtimeTokenName) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限设备身份不匹配");
    }
    if (isLegacyManagedRuntimeToken(token)) {
      token = await this.#upgradeLegacyRuntimeToken(validated.accessToken, token);
    }
    assertManagedRuntimeToken(token);
    return validated;
  }

  async #upgradeLegacyRuntimeToken(
    accessToken: string,
    token: RuntimeToken,
  ): Promise<RuntimeToken> {
    const response = await this.#request("/api/token/", {
      method: "PUT",
      headers: bearer(accessToken),
      body: JSON.stringify({
        id: token.id,
        name: token.name,
        expired_time: token.expiredTime,
        remain_quota: token.remainQuota,
        unlimited_quota: token.unlimitedQuota,
        model_limits_enabled: true,
        model_limits: FD_RUNTIME_MODEL_LIMITS,
        allow_ips: token.allowIps,
        group: token.group,
        cross_group_retry: token.crossGroupRetry,
      }),
    });
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限升级失败，请联系管理员");
    }
    const upgraded = parseRuntimeToken(response.body.data);
    if (upgraded.id !== token.id || upgraded.name !== token.name) {
      throw new NewApiClientError("account_unavailable", "桌面模型权限升级结果不匹配");
    }
    assertManagedRuntimeToken(upgraded);
    return upgraded;
  }

  async getUsageSummary(credentials: StoredFdCredentials): Promise<FdUsageSummary> {
    // @effect-diagnostics globalDate:off
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 29);
    const query = new URLSearchParams({
      start_timestamp: String(Math.floor(start.getTime() / 1_000)),
      timezone_offset_seconds: String(-now.getTimezoneOffset() * 60),
    });
    const headers = bearer(credentials.accessToken);
    const [selfResponse, statsResponse, statusResponse] = await Promise.all([
      this.#request("/api/user/self", { headers }),
      this.#request(`/api/log/self/stat?${query}`, { headers }),
      this.#request("/api/status", { headers }),
    ]);
    if (!selfResponse.body.success || !statsResponse.body.success || !statusResponse.body.success) {
      throw new NewApiClientError("service_unavailable", "无法读取企业 AI 用量");
    }

    const user = object(selfResponse.body.data);
    const stats = object(statsResponse.body.data);
    const status = object(statusResponse.body.data);
    const administrator = finiteNumber(user.role) >= 10;
    return {
      readAt: now.toISOString(),
      quota: nonNegativeNumberField(stats, "quota"),
      promptTokens: nonNegativeIntField(stats, "prompt_tokens"),
      completionTokens: nonNegativeIntField(stats, "completion_tokens"),
      requestCount: nonNegativeIntField(stats, "request_count"),
      failedCount: nonNegativeIntField(stats, "failed_count"),
      rpm: nonNegativeNumberField(stats, "rpm"),
      tpm: nonNegativeNumberField(stats, "tpm"),
      averageUseTime: nonNegativeNumberField(stats, "average_use_time"),
      daily: parseUsageDaily(stats.daily),
      models: parseUsageModels(stats.models),
      dailyQuota: parseUsagePeriod(user, "daily", administrator),
      monthlyQuota: parseUsagePeriod(user, "monthly", administrator),
      quotaPerUnit: positiveNumberField(status, "quota_per_unit", 500_000),
      usdExchangeRate: positiveNumberField(status, "usd_exchange_rate", 7.3),
    };
  }

  async refresh(credentials: StoredFdCredentials): Promise<StoredFdCredentials> {
    const response = await this.#request("/api/user/auth/refresh", {
      method: "POST",
      headers: sessionHeaders(credentials, this.#http.origin),
    });
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "登录已失效，请重新登录");
    }
    const auth = parseAuthSession(response);
    if (auth.user.id !== credentials.user.id) {
      throw new NewApiClientError("account_unavailable", "登录身份已变更，请重新登录");
    }
    return { ...credentials, ...auth };
  }

  async refreshPendingRevocation(
    pending: NewApiPendingRevocationSession,
  ): Promise<NewApiPendingRevocationSession> {
    // @effect-diagnostics globalDate:off
    if (pending.accessExpiresAt > Math.floor(Date.now() / 1_000) + 30) return pending;
    let response: NewApiResponse;
    try {
      response = await this.#http.request("/api/user/auth/refresh", {
        method: "POST",
        headers: sessionHeaders(pending, this.#http.origin),
      });
    } catch (error) {
      if (!(error instanceof NewApiHttpError) || error.code !== "AUTH_SESSION_MISMATCH") {
        throw mapSessionRefreshError(error);
      }
      try {
        response = await this.#http.request("/api/user/auth/refresh", {
          method: "POST",
          headers: refreshHeadersWithoutSession(pending.refreshCookie, this.#http.origin),
        });
      } catch (retryError) {
        throw mapSessionRefreshError(retryError);
      }
    }
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "登录已失效，请重新登录");
    }
    const auth = parseAuthSession(response);
    if (auth.user.id !== pending.userId) {
      throw new NewApiClientError("account_unavailable", "登录身份已变更，请重新登录");
    }
    return {
      ...pending,
      accessToken: auth.accessToken,
      accessExpiresAt: auth.accessExpiresAt,
      refreshCookie: auth.refreshCookie,
      sessionId: auth.sessionId,
    };
  }

  async revokeRuntimeTokens(revocation: NewApiRuntimeTokenRevocation): Promise<void> {
    let deleteError: unknown;
    let previousIds: string | undefined;
    let candidateCount = 0;
    for (let pass = 0; pass < MAX_RUNTIME_TOKEN_REVOCATION_PASSES; pass += 1) {
      const matches = await this.#findRuntimeTokens(
        revocation.accessToken,
        revocation.runtimeTokenName,
      );
      if (matches.length === 0) return;
      const ids = matches
        .map((token) => token.id)
        .sort((left, right) => left - right)
        .join(",");
      if (ids === previousIds) throwRevocationIncomplete(deleteError);
      previousIds = ids;
      candidateCount += matches.length;
      if (candidateCount > MAX_RUNTIME_TOKEN_REVOCATION_CANDIDATES) {
        throwRevocationIncomplete(deleteError);
      }
      for (const token of matches) {
        try {
          await this.deleteRuntimeToken({
            accessToken: revocation.accessToken,
            runtimeTokenId: token.id,
          });
        } catch (error) {
          deleteError ??= error;
        }
      }
    }
    const remaining = await this.#findRuntimeTokens(
      revocation.accessToken,
      revocation.runtimeTokenName,
    );
    if (remaining.length === 0) return;
    throwRevocationIncomplete(deleteError);
  }

  async deleteRuntimeToken(revocation: NewApiRuntimeTokenId): Promise<void> {
    const response = await this.#request(`/api/token/${revocation.runtimeTokenId}`, {
      method: "DELETE",
      headers: bearer(revocation.accessToken),
    });
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "远程模型凭据撤销失败");
    }
  }

  async logoutSession(
    session: NewApiPendingRevocationSession,
    persistRefreshedSession?: (session: NewApiPendingRevocationSession) => Promise<void>,
  ): Promise<void> {
    try {
      await this.#logoutSessionOnce(session);
    } catch (error) {
      if (!(error instanceof NewApiHttpError) || error.code !== "AUTH_SESSION_MISMATCH") {
        throw mapLogoutError(error);
      }
      const refreshed = await this.#refreshLogoutSessionWithoutSid(session);
      if (!refreshed) return;
      await persistRefreshedSession?.(refreshed);
      try {
        await this.#logoutSessionOnce(refreshed);
      } catch (retryError) {
        throw mapLogoutError(retryError);
      }
    }
  }

  async #logoutSessionOnce(session: NewApiSessionCredentials): Promise<void> {
    let response: NewApiResponse;
    try {
      response = await this.#http.request("/api/user/auth/logout", {
        method: "POST",
        headers: sessionHeaders(session, this.#http.origin),
      });
    } catch (error) {
      if (isTerminalLogoutError(error)) return;
      throw error;
    }
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "远程登录会话退出失败");
    }
  }

  async #refreshLogoutSessionWithoutSid(
    session: NewApiPendingRevocationSession,
  ): Promise<NewApiPendingRevocationSession | null> {
    let response: NewApiResponse;
    try {
      response = await this.#http.request("/api/user/auth/refresh", {
        method: "POST",
        headers: refreshHeadersWithoutSession(session.refreshCookie, this.#http.origin),
      });
    } catch (error) {
      if (isTerminalLogoutError(error)) return null;
      throw mapLogoutError(error);
    }
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "远程登录会话恢复失败");
    }
    const auth = parseAuthSession(response);
    if (auth.user.id !== session.userId) {
      throw new NewApiClientError("account_unavailable", "登录身份已变更，请重新登录");
    }
    return {
      ...session,
      accessToken: auth.accessToken,
      accessExpiresAt: auth.accessExpiresAt,
      refreshCookie: auth.refreshCookie,
      sessionId: auth.sessionId,
    };
  }

  async #findRuntimeTokens(accessToken: string, tokenName: string): Promise<RuntimeToken[]> {
    const response = await this.#request(
      `/api/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&size=100`,
      { headers: bearer(accessToken) },
    );
    if (!response.body.success) {
      throw new NewApiClientError("account_unavailable", "无法读取桌面模型权限");
    }
    const data = object(response.body.data);
    const items = data.items;
    if (!Array.isArray(items) || items.length > 100) throw new Error("Token page is invalid");
    return items.map(parseRuntimeToken).filter((token) => token.name === tokenName);
  }

  async #request(path: string, init: RequestInit = {}): Promise<NewApiResponse> {
    try {
      return await this.#http.request(path, init);
    } catch (error) {
      if (error instanceof NewApiClientError) throw error;
      if (error instanceof NewApiHttpError && error.kind === "unauthorized") {
        throw new NewApiClientError("account_unavailable", "登录已失效，请重新登录");
      }
      const loginSessionLimit = mapLoginSessionLimitError(error);
      if (loginSessionLimit) throw loginSessionLimit;
      throw new NewApiClientError("service_unavailable", "企业 AI 服务暂时不可用");
    }
  }
}

function parseAuthSession(response: NewApiResponse): NewApiAuthSession {
  const data = object(response.body.data);
  const session = object(data.session);
  const refreshCookie = extractRefreshCookie(response.setCookies);
  if (!refreshCookie) throw new NewApiClientError("service_unavailable", "登录会话无法建立");
  return {
    accessToken: stringField(data, "access_token", 16_384),
    accessExpiresAt: positiveIntField(data, "access_expires_at"),
    refreshCookie,
    sessionId: stringField(session, "sid", 128),
    user: parseUser(data.user),
  };
}

function parseUser(value: unknown): FdAccountUserSummary {
  const user = object(value);
  if (intField(user, "status") !== 1) {
    throw new NewApiClientError("account_unavailable", "账号已停用，请联系管理员");
  }
  const displayName = user.display_name;
  if (displayName !== undefined && displayName !== null && typeof displayName !== "string") {
    throw new Error("User display name is invalid");
  }
  return {
    id: positiveIntField(user, "id"),
    username: stringField(user, "username", 128),
    displayName: displayName == null ? null : displayName.slice(0, 128),
  };
}

function parseRuntimeToken(value: unknown): RuntimeToken {
  const token = object(value);
  return {
    id: positiveIntField(token, "id"),
    name: stringField(token, "name", 50),
    status: intField(token, "status"),
    expiredTime: intField(token, "expired_time"),
    remainQuota: nonNegativeIntField(token, "remain_quota"),
    unlimitedQuota: booleanField(token, "unlimited_quota"),
    modelLimitsEnabled: booleanField(token, "model_limits_enabled"),
    modelLimits: stringField(token, "model_limits", 1_024),
    allowIps: optionalStringField(token, "allow_ips", 16_384),
    group: optionalStringField(token, "group", 128),
    crossGroupRetry: booleanField(token, "cross_group_retry"),
  };
}

function assertManagedRuntimeToken(token: RuntimeToken): void {
  if (
    token.status !== 1 ||
    !token.modelLimitsEnabled ||
    token.modelLimits !== FD_RUNTIME_MODEL_LIMITS
  ) {
    throw new NewApiClientError("account_unavailable", "桌面模型权限配置异常，请联系管理员");
  }
}

function isLegacyManagedRuntimeToken(token: RuntimeToken): boolean {
  return token.status === 1 && token.modelLimitsEnabled && token.modelLimits === FD_RUNTIME_MODEL;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("New API data is invalid");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, maxLength: number): string {
  const field = value[key];
  if (typeof field !== "string" || field.length < 1 || field.length > maxLength) {
    throw new Error(`New API ${key} is invalid`);
  }
  return field;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const field = value[key];
  if (field === null || field === undefined) return "";
  if (typeof field !== "string" || field.length > maxLength) {
    throw new Error(`New API ${key} is invalid`);
  }
  return field;
}

function positiveIntField(value: Record<string, unknown>, key: string): number {
  const field = intField(value, key);
  if (field < 1) throw new Error(`New API ${key} is invalid`);
  return field;
}

function intField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    throw new Error(`New API ${key} is invalid`);
  }
  return field;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`New API ${key} is invalid`);
  return field;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeNumberField(value: Record<string, unknown>, key: string): number {
  return Math.max(0, finiteNumber(value[key]));
}

function nonNegativeIntField(value: Record<string, unknown>, key: string): number {
  return Math.max(0, Math.trunc(finiteNumber(value[key])));
}

function positiveNumberField(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const field = finiteNumber(value[key], fallback);
  return field > 0 ? field : fallback;
}

function parseUsagePeriod(
  value: Record<string, unknown>,
  prefix: "daily" | "monthly",
  accountUnlimited: boolean,
): FdUsagePeriod {
  return {
    limit: nonNegativeNumberField(value, `${prefix}_quota`),
    used: nonNegativeNumberField(value, `${prefix}_quota_used`),
    reserved: nonNegativeNumberField(value, `${prefix}_quota_reserved`),
    remaining: nonNegativeNumberField(value, `${prefix}_quota_remaining`),
    unlimited: accountUnlimited || value[`${prefix}_quota_unlimited`] === true,
    resetsAt: nonNegativeIntField(value, `${prefix}_quota_resets_at`),
  };
}

function parseUsageDaily(value: unknown): FdUsageSummary["daily"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 400).map((item) => {
    const point = object(item);
    return {
      day: nonNegativeIntField(point, "day"),
      tokens: nonNegativeIntField(point, "tokens"),
    };
  });
}

function parseUsageModels(value: unknown): FdUsageSummary["models"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    const point = object(item);
    const model = typeof point.model === "string" ? point.model.trim().slice(0, 256) : "";
    if (model.length === 0) return [];
    return [{ model, tokens: nonNegativeIntField(point, "tokens") }];
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function sessionHeaders(session: NewApiSessionCredentials, origin: string): Record<string, string> {
  return {
    ...bearer(session.accessToken),
    Cookie: session.refreshCookie,
    Origin: origin,
    "X-Auth-Session": session.sessionId,
  };
}

function refreshHeadersWithoutSession(
  refreshCookie: string,
  origin: string,
): Record<string, string> {
  return {
    Cookie: refreshCookie,
    Origin: origin,
  };
}

function isTerminalLogoutError(error: unknown): boolean {
  return (
    error instanceof NewApiHttpError &&
    (error.code === "AUTH_SESSION_REVOKED" || error.code === "AUTH_UNAUTHORIZED")
  );
}

function mapLogoutError(error: unknown): NewApiClientError {
  if (error instanceof NewApiClientError) return error;
  if (error instanceof NewApiHttpError && error.kind === "unauthorized") {
    return new NewApiClientError("account_unavailable", "远程登录会话退出失败");
  }
  const loginSessionLimit = mapLoginSessionLimitError(error);
  if (loginSessionLimit) return loginSessionLimit;
  return new NewApiClientError("service_unavailable", "企业 AI 服务暂时不可用");
}

function mapSessionRefreshError(error: unknown): NewApiClientError {
  if (error instanceof NewApiClientError) return error;
  if (error instanceof NewApiHttpError && error.kind === "unauthorized") {
    return new NewApiClientError("account_unavailable", "登录已失效，请重新登录");
  }
  const loginSessionLimit = mapLoginSessionLimitError(error);
  if (loginSessionLimit) return loginSessionLimit;
  return new NewApiClientError("service_unavailable", "企业 AI 服务暂时不可用");
}

function mapLoginSessionLimitError(error: unknown): NewApiClientError | null {
  if (
    error instanceof NewApiHttpError &&
    error.status === 409 &&
    error.code === "AUTH_SESSION_LIMIT"
  ) {
    return new NewApiClientError(
      "account_unavailable",
      "当前账号活跃登录会话过多，请先撤销旧设备的登录会话后重试",
    );
  }
  if (
    error instanceof NewApiHttpError &&
    error.status === 429 &&
    error.code === "AUTH_SESSION_ISSUANCE_LIMIT"
  ) {
    return new NewApiClientError("account_unavailable", "登录尝试次数过多，请稍后重试");
  }
  return null;
}

function throwRevocationIncomplete(deleteError: unknown): never {
  if (deleteError) throw deleteError;
  throw new NewApiClientError("account_unavailable", "远程模型凭据撤销未完成");
}

function extractRefreshCookie(setCookies: readonly string[]): string | null {
  for (const value of setCookies) {
    const firstSegment = value.split(";", 1)[0]?.trim();
    if (firstSegment?.startsWith(`${REFRESH_COOKIE_NAME}=`)) return firstSegment;
  }
  return null;
}

export function desktopRuntimeTokenName(deviceId: string): string {
  return `FD AI Desktop ${deviceId.replaceAll("-", "").slice(0, 12)}`;
}
