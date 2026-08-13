import type {
  FdConnectorActionResult,
  FdConnectorAuthState,
  FdConnectorInstallState,
  FdConnectorSetEnabledInput,
  FdConnectorState,
} from "@t3tools/contracts";

const installStates = new Set<FdConnectorInstallState>([
  "not_installed",
  "installing",
  "installed",
  "failed",
]);
const authStates = new Set<FdConnectorAuthState>([
  "unknown",
  "not_configured",
  "not_authenticated",
  "authenticating",
  "authenticated",
  "failed",
]);

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Connector IPC payload is invalid");
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
    throw new TypeError("Connector IPC payload is invalid");
  }
};

const boundedString = (value: unknown, maximum: number): string => {
  if (typeof value !== "string") throw new TypeError("Connector IPC payload is invalid");
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new TypeError("Connector IPC payload is invalid");
  }
  return normalized;
};

const nullableBoundedString = (value: unknown, maximum: number): string | null => {
  if (value === null) return null;
  return boundedString(value, maximum);
};

const nonNegativeInt = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Connector IPC payload is invalid");
  }
  return value;
};

function parseAuthAction(input: unknown): FdConnectorState["authAction"] {
  if (input === null) return null;
  const value = record(input);
  exactKeys(value, ["verificationUrl", "userCode"]);
  return {
    verificationUrl: boundedString(value.verificationUrl, 2_048),
    userCode: nullableBoundedString(value.userCode, 256),
  };
}

export function parseFdConnectorState(input: unknown): FdConnectorState {
  const value = record(input);
  exactKeys(value, [
    "id",
    "displayName",
    "enabled",
    "busy",
    "installState",
    "authState",
    "cliVersion",
    "installedCliPath",
    "skillsRoot",
    "skillCount",
    "installedSkillNames",
    "lastError",
    "message",
    "authAction",
  ]);
  if (value.id !== "feishu" || value.displayName !== "飞书") {
    throw new TypeError("Connector IPC payload is invalid");
  }
  if (typeof value.enabled !== "boolean" || typeof value.busy !== "boolean") {
    throw new TypeError("Connector IPC payload is invalid");
  }
  if (!installStates.has(value.installState as FdConnectorInstallState)) {
    throw new TypeError("Connector IPC payload is invalid");
  }
  if (!authStates.has(value.authState as FdConnectorAuthState)) {
    throw new TypeError("Connector IPC payload is invalid");
  }
  if (!Array.isArray(value.installedSkillNames)) {
    throw new TypeError("Connector IPC payload is invalid");
  }
  return {
    id: "feishu",
    displayName: "飞书",
    enabled: value.enabled,
    busy: value.busy,
    installState: value.installState as FdConnectorInstallState,
    authState: value.authState as FdConnectorAuthState,
    cliVersion: nullableBoundedString(value.cliVersion, 128),
    installedCliPath: nullableBoundedString(value.installedCliPath, 4_096),
    skillsRoot: nullableBoundedString(value.skillsRoot, 4_096),
    skillCount: nonNegativeInt(value.skillCount),
    installedSkillNames: value.installedSkillNames
      .slice(0, 64)
      .map((skillName) => boundedString(skillName, 128)),
    lastError: nullableBoundedString(value.lastError, 800),
    message: nullableBoundedString(value.message, 800),
    authAction: parseAuthAction(value.authAction),
  };
}

export function parseFdConnectorActionResult(input: unknown): FdConnectorActionResult {
  const value = record(input);
  exactKeys(value, ["state"]);
  return { state: parseFdConnectorState(value.state) };
}

export function parseFdConnectorSetEnabledInput(input: FdConnectorSetEnabledInput) {
  const value = record(input);
  exactKeys(value, ["enabled"]);
  if (typeof value.enabled !== "boolean") throw new TypeError("Connector IPC payload is invalid");
  return { enabled: value.enabled };
}
