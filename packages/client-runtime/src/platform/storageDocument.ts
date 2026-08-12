import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const LegacyConnectionCatalogDocument = Schema.Struct({
  schemaVersion: Schema.Unknown,
  targets: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  profiles: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  credentials: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  remoteDpopTokens: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export interface LegacyConnectionCatalogDiscard {
  readonly discardedTargets: number;
  readonly discardedProfiles: number;
  readonly discardedCredentials: number;
  readonly discardedTokens: number;
}

const decodeLegacyConnectionCatalog = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LegacyConnectionCatalogDocument),
);

export const decodeAndDiscardLegacyConnectionCatalog = Effect.fn(
  "clientRuntime.platform.decodeAndDiscardLegacyConnectionCatalog",
)(function* (raw: string): Effect.fn.Return<LegacyConnectionCatalogDiscard, Schema.SchemaError> {
  const legacy = yield* decodeLegacyConnectionCatalog(raw);
  return {
    discardedTargets: legacy.targets?.length ?? 0,
    discardedProfiles: legacy.profiles?.length ?? 0,
    discardedCredentials: legacy.credentials?.length ?? 0,
    discardedTokens: legacy.remoteDpopTokens?.length ?? 0,
  };
});
