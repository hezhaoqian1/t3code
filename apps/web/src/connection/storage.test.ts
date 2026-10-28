import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { discardLegacyCatalog, writeDatabaseValue } from "./storage";

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

describe("writeDatabaseValue", () => {
  it.effect("fails IndexedDB writes whose commit aborts", () =>
    Effect.gen(function* () {
      const transaction = Object.assign(new EventTarget(), {
        error: null as DOMException | null,
        objectStore: () => ({
          put: () => {
            // A failed commit aborts the transaction without an "error" event.
            queueMicrotask(() => {
              transaction.error = new DOMException("Quota exceeded", "QuotaExceededError");
              transaction.dispatchEvent(new Event("abort"));
            });
          },
        }),
      });

      const error = yield* writeDatabaseValue(
        { transaction: () => transaction } as never,
        "shell",
        "environment-1",
        "{}",
      ).pipe(Effect.flip);

      expect(error.message).toContain("QuotaExceededError");
    }),
  );

  it.effect("succeeds when the transaction completes", () =>
    Effect.gen(function* () {
      const put = vi.fn();
      const transaction = Object.assign(new EventTarget(), {
        error: null,
        objectStore: () => ({
          put: (value: unknown, key: unknown) => {
            put(value, key);
            queueMicrotask(() => transaction.dispatchEvent(new Event("complete")));
          },
        }),
      });

      yield* writeDatabaseValue(
        { transaction: () => transaction } as never,
        "shell",
        "environment-1",
        "{}",
      );

      expect(put).toHaveBeenCalledWith("{}", "environment-1");
    }),
  );
});
