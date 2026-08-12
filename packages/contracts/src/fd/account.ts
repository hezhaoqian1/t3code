import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const AccountMessage = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const FdAccountUserSummary = Schema.Struct({
  id: PositiveInt,
  username: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  displayName: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
}).annotate(strict);
export type FdAccountUserSummary = typeof FdAccountUserSummary.Type;

export const FdAccountCapabilities = Schema.Struct({
  generalAssistant: Schema.Literal(true),
}).annotate(strict);
export type FdAccountCapabilities = typeof FdAccountCapabilities.Type;

const FdRendererPolicyBootstrapFields = {
  policyVersion: Schema.Literal(1),
  profile: FdAccountUserSummary,
  capabilities: FdAccountCapabilities,
  expiresAt: PositiveInt,
} as const;

export const FdRendererPolicyBootstrap = Schema.Struct(FdRendererPolicyBootstrapFields).annotate(
  strict,
);
export type FdRendererPolicyBootstrap = typeof FdRendererPolicyBootstrap.Type;

export const FdCheckingAccountState = Schema.Struct({
  status: Schema.Literal("checking"),
}).annotate(strict);

export const FdAnonymousAccountState = Schema.Struct({
  status: Schema.Literal("anonymous"),
}).annotate(strict);

export const FdAuthenticatedAccountState = Schema.Struct({
  status: Schema.Literal("authenticated"),
  ...FdRendererPolicyBootstrapFields,
}).annotate(strict);

export const FdCredentialsUnavailableAccountState = Schema.Struct({
  status: Schema.Literal("credentials_unavailable"),
  message: AccountMessage,
}).annotate(strict);

export const FdRevocationPendingAccountState = Schema.Struct({
  status: Schema.Literal("revocation_pending"),
  message: AccountMessage,
  retryAllowed: Schema.Boolean,
}).annotate(strict);

export const FdAccountState = Schema.Union([
  FdCheckingAccountState,
  FdAnonymousAccountState,
  FdAuthenticatedAccountState,
  FdCredentialsUnavailableAccountState,
  FdRevocationPendingAccountState,
]);
export type FdAccountState = typeof FdAccountState.Type;

export const FdAccountLoginInput = Schema.Struct({
  username: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  password: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1_024)),
}).annotate(strict);
export type FdAccountLoginInput = typeof FdAccountLoginInput.Type;

export const FdAccountLoginErrorCode = Schema.Literals([
  "invalid_credentials",
  "two_factor_required",
  "account_unavailable",
  "service_unavailable",
  "secure_storage_unavailable",
  "revocation_pending",
]);
export type FdAccountLoginErrorCode = typeof FdAccountLoginErrorCode.Type;

export const FdAccountLoginResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    state: FdAuthenticatedAccountState,
  }).annotate(strict),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: FdAccountLoginErrorCode,
    message: AccountMessage,
    state: Schema.optionalKey(FdAccountState),
  }).annotate(strict),
]);
export type FdAccountLoginResult = typeof FdAccountLoginResult.Type;

export const FdAccountLogoutResult = Schema.Union([
  Schema.Struct({
    completed: Schema.Literal(true),
    state: Schema.Union([
      FdAnonymousAccountState,
      FdCredentialsUnavailableAccountState,
      FdRevocationPendingAccountState,
    ]),
  }).annotate(strict),
  Schema.Struct({
    completed: Schema.Literal(false),
    code: Schema.Literal("revocation_intent_unavailable"),
    message: AccountMessage,
    state: FdAuthenticatedAccountState,
  }).annotate(strict),
]);
export type FdAccountLogoutResult = typeof FdAccountLogoutResult.Type;

export const FdAccountReloadResult = Schema.Struct({
  state: FdAccountState,
}).annotate(strict);
export type FdAccountReloadResult = typeof FdAccountReloadResult.Type;

export const FdRetryRevocationResult = Schema.Struct({
  completed: Schema.Boolean,
  state: Schema.Union([
    FdAnonymousAccountState,
    FdCredentialsUnavailableAccountState,
    FdRevocationPendingAccountState,
  ]),
}).annotate(strict);
export type FdRetryRevocationResult = typeof FdRetryRevocationResult.Type;

export const FdAccountGetStatePayload = Schema.Void;
export const FdAccountGetStateResponse = FdAccountState;
export const FdAccountLoginPayload = FdAccountLoginInput;
export const FdAccountLoginResponse = FdAccountLoginResult;
export const FdAccountLogoutPayload = Schema.Void;
export const FdAccountLogoutResponse = FdAccountLogoutResult;
export const FdAccountReloadPayload = Schema.Void;
export const FdAccountReloadResponse = FdAccountReloadResult;
export const FdAccountRetryRevocationPayload = Schema.Void;
export const FdAccountRetryRevocationResponse = FdRetryRevocationResult;
export const FdAccountStateChangedPayload = FdAccountState;
