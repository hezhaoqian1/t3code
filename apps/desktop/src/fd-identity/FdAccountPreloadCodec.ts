import type {
  FdAccountLoginInput,
  FdAccountLoginResult,
  FdAccountLogoutResult,
  FdAccountReloadResult,
  FdAccountState,
  FdAccountUserSummary,
  FdRetryRevocationResult,
  FdUsageSummary,
} from "@t3tools/contracts";

const loginErrorCodes = new Set([
  "invalid_credentials",
  "two_factor_required",
  "account_unavailable",
  "service_unavailable",
  "secure_storage_unavailable",
  "revocation_pending",
]);

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !allowed.has(key))) {
    throw new TypeError("FD account IPC payload is invalid");
  }
};

const literal = <T extends string | number | boolean>(value: unknown, expected: T): T => {
  if (value !== expected) throw new TypeError("FD account IPC payload is invalid");
  return expected;
};

const positiveInt = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return value;
};

const boundedString = (
  value: unknown,
  maximum: number,
  options: { readonly trim: boolean },
): string => {
  if (typeof value !== "string") throw new TypeError("FD account IPC payload is invalid");
  const normalized = options.trim ? value.trim() : value;
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return normalized;
};

const accountMessage = (value: unknown): string => boundedString(value, 200, { trim: true });

const nonNegativeNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("FD usage IPC payload is invalid");
  }
  return value;
};

const nonNegativeInt = (value: unknown): number => {
  const number = nonNegativeNumber(value);
  if (!Number.isSafeInteger(number)) throw new TypeError("FD usage IPC payload is invalid");
  return number;
};

const parseUsagePeriod = (input: unknown) => {
  const value = record(input);
  exactKeys(value, ["limit", "used", "reserved", "remaining", "unlimited", "resetsAt"]);
  if (typeof value.unlimited !== "boolean") throw new TypeError("FD usage IPC payload is invalid");
  return {
    limit: nonNegativeNumber(value.limit),
    used: nonNegativeNumber(value.used),
    reserved: nonNegativeNumber(value.reserved),
    remaining: nonNegativeNumber(value.remaining),
    unlimited: value.unlimited,
    resetsAt: nonNegativeInt(value.resetsAt),
  };
};

export function parseFdUsageSummary(input: unknown): FdUsageSummary {
  const value = record(input);
  exactKeys(value, [
    "readAt",
    "quota",
    "promptTokens",
    "completionTokens",
    "requestCount",
    "failedCount",
    "rpm",
    "tpm",
    "averageUseTime",
    "daily",
    "models",
    "dailyQuota",
    "monthlyQuota",
    "quotaPerUnit",
    "usdExchangeRate",
  ]);
  if (!Array.isArray(value.daily) || !Array.isArray(value.models)) {
    throw new TypeError("FD usage IPC payload is invalid");
  }
  const daily = value.daily.slice(0, 400).map((item) => {
    const point = record(item);
    exactKeys(point, ["day", "tokens"]);
    return { day: nonNegativeInt(point.day), tokens: nonNegativeInt(point.tokens) };
  });
  const models = value.models.slice(0, 200).map((item) => {
    const point = record(item);
    exactKeys(point, ["model", "tokens"]);
    return {
      model: boundedString(point.model, 256, { trim: true }),
      tokens: nonNegativeInt(point.tokens),
    };
  });
  return {
    readAt: boundedString(value.readAt, 128, { trim: true }),
    quota: nonNegativeNumber(value.quota),
    promptTokens: nonNegativeInt(value.promptTokens),
    completionTokens: nonNegativeInt(value.completionTokens),
    requestCount: nonNegativeInt(value.requestCount),
    failedCount: nonNegativeInt(value.failedCount),
    rpm: nonNegativeNumber(value.rpm),
    tpm: nonNegativeNumber(value.tpm),
    averageUseTime: nonNegativeNumber(value.averageUseTime),
    daily,
    models,
    dailyQuota: parseUsagePeriod(value.dailyQuota),
    monthlyQuota: parseUsagePeriod(value.monthlyQuota),
    quotaPerUnit: nonNegativeNumber(value.quotaPerUnit),
    usdExchangeRate: nonNegativeNumber(value.usdExchangeRate),
  };
}

const parseUser = (input: unknown): FdAccountUserSummary => {
  const value = record(input);
  exactKeys(value, ["id", "username", "displayName"]);
  const displayName = value.displayName;
  if (displayName !== null && (typeof displayName !== "string" || displayName.length > 128)) {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return {
    id: positiveInt(value.id),
    username: boundedString(value.username, 128, { trim: true }),
    displayName,
  };
};

const parseAuthenticatedState = (
  value: Record<string, unknown>,
): Extract<FdAccountState, { status: "authenticated" }> => {
  exactKeys(value, ["status", "policyVersion", "profile", "capabilities", "expiresAt"]);
  const capabilities = record(value.capabilities);
  exactKeys(capabilities, ["generalAssistant"]);
  return {
    status: literal(value.status, "authenticated"),
    policyVersion: literal(value.policyVersion, 1),
    profile: parseUser(value.profile),
    capabilities: { generalAssistant: literal(capabilities.generalAssistant, true) },
    expiresAt: positiveInt(value.expiresAt),
  };
};

export function parseFdAccountState(input: unknown): FdAccountState {
  const value = record(input);
  if (value.status === "checking" || value.status === "anonymous") {
    exactKeys(value, ["status"]);
    return { status: value.status };
  }
  if (value.status === "authenticated") return parseAuthenticatedState(value);
  if (value.status === "credentials_unavailable") {
    exactKeys(value, ["status", "message"]);
    return { status: "credentials_unavailable", message: accountMessage(value.message) };
  }
  if (value.status === "revocation_pending") {
    exactKeys(value, ["status", "message", "retryAllowed"]);
    if (typeof value.retryAllowed !== "boolean") {
      throw new TypeError("FD account IPC payload is invalid");
    }
    return {
      status: "revocation_pending",
      message: accountMessage(value.message),
      retryAllowed: value.retryAllowed,
    };
  }
  throw new TypeError("FD account IPC payload is invalid");
}

export function parseFdAccountLoginInput(input: unknown): FdAccountLoginInput {
  const value = record(input);
  exactKeys(value, ["username", "password"]);
  return {
    username: boundedString(value.username, 128, { trim: true }),
    password: boundedString(value.password, 1_024, { trim: false }),
  };
}

export function parseFdAccountLoginResult(input: unknown): FdAccountLoginResult {
  const value = record(input);
  if (value.ok === true) {
    exactKeys(value, ["ok", "state"]);
    const state = parseFdAccountState(value.state);
    if (state.status !== "authenticated") {
      throw new TypeError("FD account IPC payload is invalid");
    }
    return { ok: true, state };
  }
  literal(value.ok, false);
  exactKeys(value, ["ok", "code", "message"], ["state"]);
  if (typeof value.code !== "string" || !loginErrorCodes.has(value.code)) {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return {
    ok: false,
    code: value.code as Extract<FdAccountLoginResult, { ok: false }>["code"],
    message: accountMessage(value.message),
    ...(Object.hasOwn(value, "state") ? { state: parseFdAccountState(value.state) } : {}),
  };
}

const parseLoggedOutState = (
  input: unknown,
): Exclude<FdAccountState, { status: "checking" | "authenticated" }> => {
  const state = parseFdAccountState(input);
  if (state.status === "checking" || state.status === "authenticated") {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return state;
};

export function parseFdAccountLogoutResult(input: unknown): FdAccountLogoutResult {
  const value = record(input);
  if (value.completed === true) {
    exactKeys(value, ["completed", "state"]);
    return { completed: true, state: parseLoggedOutState(value.state) };
  }
  literal(value.completed, false);
  exactKeys(value, ["completed", "code", "message", "state"]);
  literal(value.code, "revocation_intent_unavailable");
  const state = parseFdAccountState(value.state);
  if (state.status !== "authenticated") {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return {
    completed: false,
    code: "revocation_intent_unavailable",
    message: accountMessage(value.message),
    state,
  };
}

export function parseFdAccountReloadResult(input: unknown): FdAccountReloadResult {
  const value = record(input);
  exactKeys(value, ["state"]);
  return { state: parseFdAccountState(value.state) };
}

export function parseFdRetryRevocationResult(input: unknown): FdRetryRevocationResult {
  const value = record(input);
  exactKeys(value, ["completed", "state"]);
  if (typeof value.completed !== "boolean") {
    throw new TypeError("FD account IPC payload is invalid");
  }
  return { completed: value.completed, state: parseLoggedOutState(value.state) };
}
