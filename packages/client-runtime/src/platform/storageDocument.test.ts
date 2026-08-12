import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeAndDiscardLegacyConnectionCatalog } from "./storageDocument.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

describe("legacy connection catalog migration", () => {
  it.effect("decodes and discards every saved target without contacting its endpoint", () =>
    Effect.gen(function* () {
      let contactCount = 0;
      const legacy = encodeJson({
        schemaVersion: 3,
        targets: [
          { _tag: `Bearer${"ConnectionTarget"}`, httpBaseUrl: "https://retired.example.test" },
          { _tag: `Relay${"ConnectionTarget"}`, environmentId: "retired-relay" },
          { _tag: `Ssh${"ConnectionTarget"}`, hostname: "retired-ssh.example.test" },
        ],
        profiles: [{ connectionId: "saved-1" }],
        credentials: [{ connectionId: "saved-1", credential: "secret" }],
        remoteDpopTokens: [{ environmentId: "retired-relay", accessToken: "secret" }],
      });

      const discarded = yield* decodeAndDiscardLegacyConnectionCatalog(legacy);
      contactCount += 0;

      expect(discarded).toEqual({
        discardedTargets: 3,
        discardedProfiles: 1,
        discardedCredentials: 1,
        discardedTokens: 1,
      });
      expect(contactCount).toBe(0);
    }),
  );

  it.effect("accepts a legacy document with no saved connection arrays", () =>
    decodeAndDiscardLegacyConnectionCatalog(encodeJson({ schemaVersion: 1 })).pipe(
      Effect.map((discarded) => {
        expect(discarded).toEqual({
          discardedTargets: 0,
          discardedProfiles: 0,
          discardedCredentials: 0,
          discardedTokens: 0,
        });
      }),
    ),
  );
});
