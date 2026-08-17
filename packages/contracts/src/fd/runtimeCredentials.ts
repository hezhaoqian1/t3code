import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const Secret = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16_384));
const MAX_FD_RUNTIME_ORIGIN_LENGTH = 2_048;

export const FD_RUNTIME_DEFAULT_MODEL = "deepseek-v4-flash" as const;
export const FD_RUNTIME_PRO_MODEL = "deepseek-v4-pro" as const;
export const FD_RUNTIME_MODELS = [FD_RUNTIME_DEFAULT_MODEL, FD_RUNTIME_PRO_MODEL] as const;
export type FdRuntimeModel = (typeof FD_RUNTIME_MODELS)[number];

export function isFdRuntimeModel(value: string): value is FdRuntimeModel {
  return FD_RUNTIME_MODELS.some((model) => model === value);
}

export const FdRuntimeNewApiOrigin = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_FD_RUNTIME_ORIGIN_LENGTH),
  Schema.makeFilter((value) => isFdRuntimeNewApiOrigin(value), {
    identifier: "FdRuntimeNewApiOrigin",
    description: "an HTTPS or loopback HTTP(S) origin",
  }),
);
export type FdRuntimeNewApiOrigin = typeof FdRuntimeNewApiOrigin.Type;

export const FdServerRuntimePolicyProjection = Schema.Struct({
  version: Schema.Literal(1),
  capability: Schema.Literal("general_assistant"),
  model: Schema.Literal(FD_RUNTIME_DEFAULT_MODEL),
  models: Schema.optionalKey(
    Schema.Tuple([Schema.Literal(FD_RUNTIME_DEFAULT_MODEL), Schema.Literal(FD_RUNTIME_PRO_MODEL)]),
  ),
  expiresAt: PositiveInt,
}).annotate(strict);
export type FdServerRuntimePolicyProjection = typeof FdServerRuntimePolicyProjection.Type;

export const FdServerRuntimeCredentialProjection = Schema.Struct({
  userId: PositiveInt,
  runtimeTokenId: PositiveInt,
  newApiOrigin: FdRuntimeNewApiOrigin,
  runtimeApiKey: Secret,
  accessToken: Secret,
  accessExpiresAt: PositiveInt,
  policy: FdServerRuntimePolicyProjection,
  generation: NonNegativeInt,
}).annotate(strict);
export type FdServerRuntimeCredentialProjection = typeof FdServerRuntimeCredentialProjection.Type;

export const FdRuntimeCredentialSetCommand = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("set"),
  credentials: FdServerRuntimeCredentialProjection,
}).annotate(strict);

export const FdRuntimeCredentialClearCommand = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("clear"),
  generation: NonNegativeInt,
  reason: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
}).annotate(strict);

export const FdRuntimeCredentialCommand = Schema.Union([
  FdRuntimeCredentialSetCommand,
  FdRuntimeCredentialClearCommand,
]);
export type FdRuntimeCredentialCommand = typeof FdRuntimeCredentialCommand.Type;

export const FD_RUNTIME_CREDENTIAL_PROTOCOL_VERSION = 1 as const;
export const FD_RUNTIME_CREDENTIAL_FD = 6 as const;
export const FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES = 64 * 1_024;

function isFdRuntimeNewApiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return (
      value === url.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" || (loopback && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}
