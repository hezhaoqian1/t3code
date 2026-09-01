import { describe, expect, it, vi } from "vite-plus/test";

import type { PendingFdRevocation } from "./CredentialVault.ts";
import { FD_RUNTIME_MODEL_LIMITS, NewApiClient, NewApiClientError } from "./NewApiClient.ts";

describe("NewApiClient", () => {
  it("retires stale same-device tokens and creates exact Flash and Pro access", async () => {
    const fetch = responseQueue([
      jsonResponse(authResponse(), { cookie: true }),
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken({ id: 40 })] })),
      jsonResponse(apiSuccess()),
      jsonResponse(apiSuccess({ total: 0, items: [] })),
      jsonResponse(apiSuccess()),
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken()] })),
      jsonResponse(apiSuccess({ key: "runtime-secret" })),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    const auth = await client.authenticate("employee", "password-secret");
    const runtime = await client.provisionRuntimeToken(auth, "FD AI Desktop device123");

    expect(runtime.key).toBe("sk-runtime-secret");
    expect(request(fetch, 2)).toMatchObject({ path: "/api/token/40", method: "DELETE" });
    expect(request(fetch, 4)).toMatchObject({ path: "/api/token/", method: "POST" });
    expect(JSON.parse(request(fetch, 4).body)).toMatchObject({
      name: "FD AI Desktop device123",
      status: 1,
      model_limits_enabled: true,
      model_limits: FD_RUNTIME_MODEL_LIMITS,
    });
    expect(JSON.stringify(fetch.mock.calls.slice(1))).not.toContain("password-secret");
  });

  it("validates user identity, token id, status, and exact model limit on bootstrap", async () => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess(apiUser())),
      jsonResponse(apiSuccess(runtimeToken({ model_limits: "deepseek-v4-flash,gpt-5" }))),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.validate(credentials())).rejects.toMatchObject({
      code: "account_unavailable",
    } satisfies Partial<NewApiClientError>);
    expect(request(fetch, 1).path).toBe("/api/token/41");
  });

  it("upgrades a legacy Flash-only token in place without changing its key", async () => {
    const legacy = runtimeToken({ model_limits: "deepseek-v4-flash" });
    const upgraded = runtimeToken({ model_limits: FD_RUNTIME_MODEL_LIMITS });
    const fetch = responseQueue([
      jsonResponse(apiSuccess(apiUser())),
      jsonResponse(apiSuccess(legacy)),
      jsonResponse(apiSuccess(upgraded)),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.validate(credentials())).resolves.toMatchObject({
      runtimeTokenId: 41,
      runtimeApiKey: "sk-runtime",
    });
    expect(request(fetch, 2)).toMatchObject({ path: "/api/token/", method: "PUT" });
    expect(JSON.parse(request(fetch, 2).body)).toMatchObject({
      id: 41,
      model_limits_enabled: true,
      model_limits: FD_RUNTIME_MODEL_LIMITS,
    });
  });

  it.each([
    ["failed response", { success: false, data: null }],
    [
      "different token identity",
      apiSuccess(runtimeToken({ id: 42, model_limits: FD_RUNTIME_MODEL_LIMITS })),
    ],
    ["inexact upgraded policy", apiSuccess(runtimeToken({ model_limits: "deepseek-v4-flash" }))],
  ])("fails closed when a legacy token upgrade returns %s", async (_caseName, upgradeResponse) => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess(apiUser())),
      jsonResponse(apiSuccess(runtimeToken({ model_limits: "deepseek-v4-flash" }))),
      jsonResponse(upgradeResponse),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.validate(credentials())).rejects.toMatchObject({
      code: "account_unavailable",
    });
  });

  it.each([
    "deepseek-v4-flash ",
    " deepseek-v4-flash",
    "deepseek-v4-flash,gpt-5",
    "deepseek-v4",
    "DeepSeek-V4-Flash",
  ])("rejects non-exact managed model limit %j", async (modelLimits) => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess(apiUser())),
      jsonResponse(apiSuccess(runtimeToken({ model_limits: modelLimits }))),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.validate(credentials())).rejects.toMatchObject({
      code: "account_unavailable",
    });
  });

  it("checks /api/user/self success before parsing disabled account data", async () => {
    const fetch = responseQueue([jsonResponse({ success: false, data: null })]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.validate(credentials())).rejects.toMatchObject({
      code: "account_unavailable",
    });
  });

  it("rejects a disabled account returned by /api/user/self", async () => {
    const fetch = responseQueue([jsonResponse(apiSuccess(apiUser({ status: 2 })))]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.validate(credentials())).rejects.toMatchObject({
      code: "account_unavailable",
    });
  });

  it("checks runtime key success before parsing key data", async () => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess({ total: 0, items: [] })),
      jsonResponse(apiSuccess()),
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken()] })),
      jsonResponse({ success: false, data: null }),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(
      client.provisionRuntimeToken(authSession(), "FD AI Desktop device123"),
    ).rejects.toMatchObject({ code: "account_unavailable" });
  });

  it("refreshes the account session with its cookie and preserves the managed token", async () => {
    const fetch = responseQueue([jsonResponse(authResponse(), { cookie: true })]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.refresh(credentials())).resolves.toMatchObject({
      runtimeTokenId: 41,
      runtimeApiKey: "sk-runtime",
      accessToken: "access-secret",
    });
    const call = request(fetch, 0);
    expect(call).toMatchObject({ path: "/api/user/auth/refresh", method: "POST" });
    expect(call.headers.get("Cookie")).toBe("new_api_refresh=refresh-secret");
    expect(call.headers.get("X-Auth-Session")).toBe("session-id");
  });

  it("validates /api/user/self and exact token after refreshing an expired bootstrap", async () => {
    const fetch = responseQueue([
      jsonResponse(authResponse(), { cookie: true }),
      jsonResponse(apiSuccess(apiUser())),
      jsonResponse(apiSuccess(runtimeToken())),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.validate({ ...credentials(), accessExpiresAt: 1 })).resolves.toMatchObject({
      accessToken: "access-secret",
      runtimeTokenId: 41,
    });
    expect(request(fetch, 0).path).toBe("/api/user/auth/refresh");
    expect(request(fetch, 1).path).toBe("/api/user/self");
    expect(request(fetch, 2).path).toBe("/api/token/41");
  });

  it("reads Gateway AI-point usage and quota periods without exposing credentials", async () => {
    const fetch = responseQueue([
      jsonResponse(
        apiSuccess(
          apiUser({
            daily_quota: 1_000,
            daily_quota_used: 300,
            daily_quota_reserved: 20,
            daily_quota_remaining: 680,
            daily_quota_unlimited: false,
            daily_quota_resets_at: 2_000_000_000,
            monthly_quota: 20_000,
            monthly_quota_used: 4_000,
            monthly_quota_reserved: 100,
            monthly_quota_remaining: 15_900,
            monthly_quota_unlimited: false,
            monthly_quota_resets_at: 2_000_100_000,
          }),
        ),
      ),
      jsonResponse(
        apiSuccess({
          quota: 410,
          prompt_tokens: 12_000,
          completion_tokens: 3_000,
          request_count: 15,
          failed_count: 1,
          rpm: 2,
          tpm: 1_500,
          average_use_time: 1.25,
          daily: [{ day: 1_999_900_000, tokens: 2_000 }],
          models: [{ model: "deepseek-v4-flash", tokens: 15_000 }],
        }),
      ),
      jsonResponse(apiSuccess({ quota_per_unit: 500_000, usd_exchange_rate: 7.3 })),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    const summary = await client.getUsageSummary(credentials());
    expect(summary).toMatchObject({
      quota: 410,
      promptTokens: 12_000,
      completionTokens: 3_000,
      requestCount: 15,
      dailyQuota: { limit: 1_000, used: 300, reserved: 20, remaining: 680 },
      monthlyQuota: { limit: 20_000, remaining: 15_900 },
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.3,
    });
    expect(request(fetch, 0).path).toBe("/api/user/self");
    expect(request(fetch, 1).path).toBe("/api/log/self/stat");
    expect(request(fetch, 2).path).toBe("/api/status");
    expect(summary).not.toHaveProperty("accessToken");
  });

  it.each([
    [
      "invalid credentials",
      jsonResponse({ success: false }),
      "invalid_credentials",
      "用户名或密码不正确",
    ],
    [
      "active-session limit",
      jsonResponse(
        { success: false, code: "AUTH_SESSION_LIMIT", message: "Too many sessions" },
        { status: 409 },
      ),
      "account_unavailable",
      "当前账号活跃登录会话过多，请先撤销旧设备的登录会话后重试",
    ],
    [
      "login-attempt limit",
      jsonResponse(
        { success: false, code: "AUTH_SESSION_ISSUANCE_LIMIT", message: "Too many attempts" },
        { status: 429 },
      ),
      "account_unavailable",
      "登录尝试次数过多，请稍后重试",
    ],
    [
      "offline",
      new Response(JSON.stringify(apiSuccess()), { status: 503 }),
      "service_unavailable",
      "企业 AI 服务暂时不可用",
    ],
    [
      "unrelated conflict",
      jsonResponse(
        { success: false, code: "AUTH_SESSION_MISMATCH", message: "Conflict" },
        { status: 409 },
      ),
      "service_unavailable",
      "企业 AI 服务暂时不可用",
    ],
  ])("maps %s to a typed login failure", async (_name, response, code, message) => {
    const fetch = responseQueue([response]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.authenticate("employee", "password-secret")).rejects.toMatchObject({
      code,
      message,
    });
    expect(request(fetch, 0).path).toBe("/api/user/login");
  });

  it.each([
    ["success", jsonResponse(apiSuccess()), undefined],
    ["401", jsonResponse(apiSuccess(), { status: 401 }), "account_unavailable"],
    [
      "unavailable",
      new Response(JSON.stringify(apiSuccess()), { status: 503 }),
      "service_unavailable",
    ],
  ])("DELETE /api/token/:id handles %s", async (_name, response, errorCode) => {
    const fetch = responseQueue([response]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    const operation = client.deleteRuntimeToken({
      accessToken: revocation().accessToken,
      runtimeTokenId: 41,
    });
    if (errorCode === undefined) await expect(operation).resolves.toBeUndefined();
    else await expect(operation).rejects.toMatchObject({ code: errorCode });
    expect(request(fetch, 0)).toMatchObject({ path: "/api/token/41", method: "DELETE" });
  });

  it("treats an already-absent managed token as successfully revoked", async () => {
    const fetch = responseQueue([jsonResponse(apiSuccess({ total: 0, items: [] }))]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.revokeRuntimeTokens(revocation())).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(request(fetch, 0).path).toBe("/api/token/search");
  });

  it("confirms exact-name absence when DELETE races with an unknown failure message", async () => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken()] })),
      jsonResponse({ success: false, message: "数据库返回了不稳定的本地化消息" }),
      jsonResponse(apiSuccess({ total: 0, items: [] })),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.revokeRuntimeTokens(revocation())).resolves.toBeUndefined();
    expect(request(fetch, 1)).toMatchObject({ path: "/api/token/41", method: "DELETE" });
    expect(request(fetch, 2).path).toBe("/api/token/search");
  });

  it("deletes more than one search page of exact-name duplicates", async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => runtimeToken({ id: index + 1 }));
    const fetch = responseQueue([
      jsonResponse(apiSuccess({ total: 101, items: firstBatch })),
      ...firstBatch.map(() => jsonResponse(apiSuccess())),
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken({ id: 101 })] })),
      jsonResponse(apiSuccess()),
      jsonResponse(apiSuccess({ total: 0, items: [] })),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(client.revokeRuntimeTokens(revocation())).resolves.toBeUndefined();
    const requests = fetch.mock.calls.map((_, index) => request(fetch, index));
    expect(requests.filter((entry) => entry.method === "DELETE")).toHaveLength(101);
    expect(requests.filter((entry) => entry.path === "/api/token/search")).toHaveLength(3);
  });

  it("fails closed when an exact-name deletion batch makes no progress", async () => {
    const fetch = responseQueue([
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken()] })),
      jsonResponse({ success: false, message: "unknown delete failure" }),
      jsonResponse(apiSuccess({ total: 1, items: [runtimeToken()] })),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.revokeRuntimeTokens(revocation())).rejects.toMatchObject({
      code: "account_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refreshes an expired pending session before remote revocation", async () => {
    const fetch = responseQueue([jsonResponse(authResponse(), { cookie: true })]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(
      client.refreshPendingRevocation({ ...revocation(), accessExpiresAt: 1 }),
    ).resolves.toMatchObject({ accessToken: "access-secret", userId: 31 });
    expect(request(fetch, 0)).toMatchObject({ path: "/api/user/auth/refresh", method: "POST" });
  });

  it("maps session issuance limits during pending revocation refresh without outage copy", async () => {
    const fetch = responseQueue([
      jsonResponse(
        { success: false, code: "AUTH_SESSION_ISSUANCE_LIMIT", message: "Too many attempts" },
        { status: 429 },
      ),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(
      client.refreshPendingRevocation({ ...revocation(), accessExpiresAt: 1 }),
    ).rejects.toMatchObject({
      code: "account_unavailable",
      message: "登录尝试次数过多，请稍后重试",
    });
  });

  it("recovers an expired pending session mismatch without the stale SID", async () => {
    const fetch = responseQueue([
      jsonResponse(
        { success: false, code: "AUTH_SESSION_MISMATCH", message: "Conflict" },
        { status: 409 },
      ),
      jsonResponse(authResponse({ sessionId: "session-recovered" }), { cookie: true }),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });

    await expect(
      client.refreshPendingRevocation({ ...revocation(), accessExpiresAt: 1 }),
    ).resolves.toMatchObject({ userId: 31, sessionId: "session-recovered" });
    expect(request(fetch, 0).headers.get("X-Auth-Session")).toBe("session-id");
    expect(request(fetch, 1).headers.has("X-Auth-Session")).toBe(false);
    expect(request(fetch, 1).headers.has("Authorization")).toBe(false);
  });

  it("logs out with refresh cookie, Origin, and X-Auth-Session", async () => {
    const fetch = responseQueue([jsonResponse(apiSuccess())]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await client.logoutSession(revocation());
    const call = request(fetch, 0);
    expect(call).toMatchObject({ path: "/api/user/auth/logout", method: "POST" });
    expect(call.headers.get("Cookie")).toBe("new_api_refresh=refresh-secret");
    expect(call.headers.get("Origin")).toBe("http://127.0.0.1:3001");
    expect(call.headers.get("X-Auth-Session")).toBe("session-id");
  });

  it("refreshes without stale SID and retries logout once on session mismatch", async () => {
    const fetch = responseQueue([
      jsonResponse(
        { success: false, code: "AUTH_SESSION_MISMATCH", message: "Conflict" },
        { status: 409 },
      ),
      jsonResponse(authResponse({ sessionId: "session-recovered" }), { cookie: true }),
      jsonResponse(apiSuccess()),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    const persistRefreshedSession = vi.fn(async () => undefined);

    await expect(
      client.logoutSession(revocation(), persistRefreshedSession),
    ).resolves.toBeUndefined();
    const refresh = request(fetch, 1);
    expect(refresh).toMatchObject({ path: "/api/user/auth/refresh", method: "POST" });
    expect(refresh.headers.get("Cookie")).toBe("new_api_refresh=refresh-secret");
    expect(refresh.headers.get("Origin")).toBe("http://127.0.0.1:3001");
    expect(refresh.headers.has("X-Auth-Session")).toBe(false);
    expect(refresh.headers.has("Authorization")).toBe(false);
    expect(persistRefreshedSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 31, sessionId: "session-recovered" }),
    );
    expect(request(fetch, 2).headers.get("X-Auth-Session")).toBe("session-recovered");
  });

  it("rejects mismatch recovery when refresh returns a different user", async () => {
    const fetch = responseQueue([
      jsonResponse(
        { success: false, code: "AUTH_SESSION_MISMATCH", message: "Conflict" },
        { status: 409 },
      ),
      jsonResponse(authResponse({ userId: 32 }), { cookie: true }),
    ]);
    const client = new NewApiClient({ baseUrl: "http://127.0.0.1:3001", fetch });
    await expect(client.logoutSession(revocation())).rejects.toMatchObject({
      code: "account_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["AUTH_SESSION_REVOKED", "AUTH_UNAUTHORIZED"])(
    "treats terminal logout code %s as complete",
    async (code) => {
      const client = new NewApiClient({
        baseUrl: "http://127.0.0.1:3001",
        fetch: responseQueue([
          jsonResponse({ success: false, code, message: "Unauthorized" }, { status: 401 }),
        ]),
      });
      await expect(client.logoutSession(revocation())).resolves.toBeUndefined();
    },
  );

  it("keeps unknown logout codes fail-closed and preserves service failures", async () => {
    const unknown = new NewApiClient({
      baseUrl: "http://127.0.0.1:3001",
      fetch: responseQueue([
        jsonResponse(
          { success: false, code: "AUTH_UNKNOWN", message: "Unauthorized" },
          { status: 401 },
        ),
      ]),
    });
    await expect(unknown.logoutSession(revocation())).rejects.toMatchObject({
      code: "account_unavailable",
    });
    const unavailable = new NewApiClient({
      baseUrl: "http://127.0.0.1:3001",
      fetch: responseQueue([jsonResponse({ success: false }, { status: 503 })]),
    });
    await expect(unavailable.logoutSession(revocation())).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("rejects non-loopback plaintext endpoints", () => {
    expect(() => new NewApiClient({ baseUrl: "http://ai-api.fdsure.com" })).toThrow("HTTPS");
  });
});

function authResponse(overrides: { readonly sessionId?: string; readonly userId?: number } = {}) {
  return apiSuccess({
    access_token: "access-secret",
    access_expires_at: 2_000_000_000,
    user: apiUser({ id: overrides.userId ?? 31 }),
    session: { sid: overrides.sessionId ?? "session-id" },
  });
}

function apiUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    username: "employee",
    display_name: "Employee",
    status: 1,
    ...overrides,
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

function runtimeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    name: "FD AI Desktop device123",
    status: 1,
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: true,
    model_limits: FD_RUNTIME_MODEL_LIMITS,
    allow_ips: "",
    group: "default",
    cross_group_retry: false,
    ...overrides,
  };
}

function credentials() {
  return {
    user: { id: 31, username: "employee", displayName: "Employee" },
    accessToken: "access-current",
    accessExpiresAt: 2_000_000_000,
    sessionId: "session-id",
    refreshCookie: "new_api_refresh=refresh-secret",
    runtimeApiKey: "sk-runtime",
    runtimeTokenId: 41,
    runtimeTokenName: "FD AI Desktop device123",
  };
}

function revocation(): PendingFdRevocation {
  const value = credentials();
  return {
    userId: value.user.id,
    accessToken: value.accessToken,
    accessExpiresAt: value.accessExpiresAt,
    sessionId: value.sessionId,
    refreshCookie: value.refreshCookie,
    runtimeTokenName: value.runtimeTokenName,
    tokensRevoked: false,
  };
}

function apiSuccess(data?: unknown) {
  return { success: true, ...(data === undefined ? {} : { data }) };
}

function jsonResponse(
  body: unknown,
  options: { cookie?: boolean; status?: number } = {},
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.cookie) {
    headers.append("Set-Cookie", "new_api_refresh=refresh-secret; Path=/api/user/auth; HttpOnly");
  }
  return new Response(JSON.stringify(body), { status: options.status ?? 200, headers });
}

function responseQueue(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
}

function request(fetch: ReturnType<typeof responseQueue>, index: number) {
  const call = fetch.mock.calls[index] as unknown as [RequestInfo | URL, RequestInit?] | undefined;
  const url = new URL(String(call?.[0]));
  const init = call?.[1] as RequestInit | undefined;
  return {
    path: url.pathname,
    method: init?.method ?? "GET",
    body: String(init?.body ?? ""),
    headers: new Headers(init?.headers),
  };
}
