import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

const strict = { parseOptions: { onExcessProperty: "error" as const } };

export const FdConnectorId = Schema.Literal("feishu");
export type FdConnectorId = typeof FdConnectorId.Type;

export const FdConnectorInstallState = Schema.Literals([
  "not_installed",
  "installing",
  "installed",
  "failed",
]);
export type FdConnectorInstallState = typeof FdConnectorInstallState.Type;

export const FdConnectorAuthState = Schema.Literals([
  "unknown",
  "not_configured",
  "not_authenticated",
  "authenticating",
  "authenticated",
  "failed",
]);
export type FdConnectorAuthState = typeof FdConnectorAuthState.Type;

export const FdConnectorPath = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const ConnectorMessage = TrimmedNonEmptyString.check(Schema.isMaxLength(800));
const ConnectorVersion = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const ConnectorSkillName = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const FdConnectorAuthAction = Schema.Struct({
  verificationUrl: Schema.String.check(Schema.isMaxLength(2_048)),
  userCode: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
}).annotate(strict);
export type FdConnectorAuthAction = typeof FdConnectorAuthAction.Type;

export const FdConnectorState = Schema.Struct({
  id: FdConnectorId,
  displayName: Schema.Literal("飞书"),
  enabled: Schema.Boolean,
  busy: Schema.Boolean,
  installState: FdConnectorInstallState,
  authState: FdConnectorAuthState,
  cliVersion: Schema.NullOr(ConnectorVersion),
  installedCliPath: Schema.NullOr(FdConnectorPath),
  skillsRoot: Schema.NullOr(FdConnectorPath),
  skillCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  installedSkillNames: Schema.Array(ConnectorSkillName),
  lastError: Schema.NullOr(ConnectorMessage),
  message: Schema.NullOr(ConnectorMessage),
  authAction: Schema.NullOr(FdConnectorAuthAction),
}).annotate(strict);
export type FdConnectorState = typeof FdConnectorState.Type;

export const FdConnectorActionResult = Schema.Struct({
  state: FdConnectorState,
}).annotate(strict);
export type FdConnectorActionResult = typeof FdConnectorActionResult.Type;

export const FdConnectorSetEnabledInput = Schema.Struct({
  enabled: Schema.Boolean,
}).annotate(strict);
export type FdConnectorSetEnabledInput = typeof FdConnectorSetEnabledInput.Type;

export const FdConnectorGetStatePayload = Schema.Void;
export const FdConnectorGetStateResponse = FdConnectorState;
export const FdConnectorRefreshPayload = Schema.Void;
export const FdConnectorRefreshResponse = FdConnectorActionResult;
export const FdConnectorConnectPayload = Schema.Void;
export const FdConnectorConnectResponse = FdConnectorActionResult;
export const FdConnectorDisconnectPayload = Schema.Void;
export const FdConnectorDisconnectResponse = FdConnectorActionResult;
export const FdConnectorSetEnabledPayload = FdConnectorSetEnabledInput;
export const FdConnectorSetEnabledResponse = FdConnectorActionResult;
export const FdConnectorStateChangedPayload = FdConnectorState;
