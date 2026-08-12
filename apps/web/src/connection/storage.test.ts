import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { discardLegacyCatalog } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discardLegacyCatalog", () => {
  it.effect("removes old saved targets without contacting their endpoints", () =>
    Effect.gen(function* () {
      const fetch = vi.fn();
      const remove = vi.fn();
      const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
      vi.stubGlobal("fetch", fetch);
      const legacy = yield* encodeJson({
        schemaVersion: 1,
        targets: [
          { _tag: `Bearer${"ConnectionTarget"}`, httpBaseUrl: "https://retired.invalid" },
          { _tag: `Ssh${"ConnectionTarget"}`, host: "retired.invalid" },
        ],
        profiles: [{ connectionId: "saved-profile" }],
        credentials: [{ connectionId: "saved-credential" }],
        remoteDpopTokens: [{ environmentId: "saved-token" }],
      });

      yield* discardLegacyCatalog({
        read: Effect.succeed(legacy),
        remove: Effect.sync(remove),
      });

      expect(remove).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    }),
  );

  it.effect("removes malformed legacy state instead of retrying or quarantining it", () =>
    Effect.gen(function* () {
      const remove = vi.fn();
      yield* discardLegacyCatalog({
        read: Effect.succeed("{not-json"),
        remove: Effect.sync(remove),
      });

      expect(remove).toHaveBeenCalledOnce();
    }),
  );

  it.effect("removes a non-string legacy catalog record", () =>
    Effect.gen(function* () {
      const remove = vi.fn();
      yield* discardLegacyCatalog({
        read: Effect.succeed({ retired: true }),
        remove: Effect.sync(remove),
      });

      expect(remove).toHaveBeenCalledOnce();
    }),
  );
});
