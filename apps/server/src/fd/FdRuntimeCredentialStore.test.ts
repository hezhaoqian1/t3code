import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  FdCredentialLineDecoder,
  FdRuntimeCredentialProtocolError,
  applyFdRuntimeCredentialCommand,
  decodeFdRuntimeCredentialLine,
  makeStore,
  runFdRuntimeCredentialChannel,
} from "./FdRuntimeCredentialStore.ts";

const projection = {
  userId: 31,
  runtimeTokenId: 41,
  newApiOrigin: "https://ai-api.fdsure.com",
  runtimeApiKey: "sk-runtime-secret",
  accessToken: "access-secret",
  accessExpiresAt: 2_000_000_000,
  policy: {
    version: 1,
    capability: "general_assistant",
    model: "deepseek-v4-flash",
    expiresAt: 2_000_000_000,
  },
  generation: 7,
} as const;

describe("FdRuntimeCredentialStore", () => {
  it("applies set/clear commands and ignores stale generations", () => {
    const empty = { generation: -1, credentials: Option.none() };
    const set = applyFdRuntimeCredentialCommand(empty, {
      version: 1,
      type: "set",
      credentials: projection,
    });
    assert.isTrue(Option.isSome(set.credentials));
    const stale = applyFdRuntimeCredentialCommand(set, {
      version: 1,
      type: "clear",
      generation: 6,
    });
    assert.strictEqual(stale, set);
    const cleared = applyFdRuntimeCredentialCommand(set, {
      version: 1,
      type: "clear",
      generation: 8,
    });
    assert.isTrue(Option.isNone(cleared.credentials));
  });

  it("keeps the projection memory-only and publishes changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore();
        yield* store.apply({ version: 1, type: "set", credentials: projection });
        const current = yield* store.service.current;
        assert.deepEqual(Option.getOrThrow(current), projection);
        yield* store.apply({ version: 1, type: "clear", generation: 8 });
        assert.isTrue(Option.isNone(yield* store.service.current));
      }),
    ));

  it("handles split lines and rejects malformed or oversized messages without echoing payloads", () => {
    const decoder = new FdCredentialLineDecoder();
    assert.deepEqual(decoder.push(Buffer.from('{"version":1,"type":"clear",')), []);
    assert.deepEqual(decoder.push(Buffer.from('"generation":3}\n')), [
      '{"version":1,"type":"clear","generation":3}',
    ]);
    assert.equal(
      decodeFdRuntimeCredentialLine('{"version":1,"type":"clear","generation":3}').type,
      "clear",
    );
    assert.throws(
      () =>
        decodeFdRuntimeCredentialLine(
          '{"version":1,"type":"set","credentials":{"refreshCookie":"secret"}}',
        ),
      FdRuntimeCredentialProtocolError,
    );
    assert.throws(
      () => decoder.push(Buffer.alloc(64 * 1_024 + 1, 120)),
      FdRuntimeCredentialProtocolError,
    );
  });

  it("rejects blank, outer whitespace, invalid UTF-8, oversized tails, and incomplete EOF", () => {
    expectProtocolError(() => new FdCredentialLineDecoder().push(Buffer.from("\n")), "malformed");
    expectProtocolError(
      () => new FdCredentialLineDecoder().push(Buffer.from(' {"version":1}\n')),
      "malformed",
    );
    expectProtocolError(
      () => new FdCredentialLineDecoder().push(Buffer.from('{"version":1} \n')),
      "malformed",
    );
    expectProtocolError(
      () => new FdCredentialLineDecoder().push(Uint8Array.from([0xff, 0x0a])),
      "malformed",
    );

    const oversized = new FdCredentialLineDecoder();
    oversized.push(Buffer.alloc(32 * 1_024, 120));
    expectProtocolError(() => oversized.push(Buffer.alloc(32 * 1_024 + 1, 120)), "oversized");

    const incomplete = new FdCredentialLineDecoder();
    incomplete.push(Buffer.from('{"version":1'));
    expectProtocolError(() => incomplete.close(), "malformed");
  });

  it.effect("clears the store fail-closed after protocol errors and clean EOF", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.apply({ version: 1, type: "set", credentials: projection });
      yield* runFdRuntimeCredentialChannel(
        Stream.make(Buffer.from("\n")),
        store.apply,
        store.clear,
      );
      assert.isTrue(Option.isNone(yield* store.service.current));

      yield* store.apply({
        version: 1,
        type: "set",
        credentials: { ...projection, generation: 9 },
      });
      yield* runFdRuntimeCredentialChannel(Stream.empty, store.apply, store.clear);
      assert.isTrue(Option.isNone(yield* store.service.current));
    }),
  );
});

function expectProtocolError(operation: () => unknown, kind: "malformed" | "oversized"): void {
  try {
    operation();
    assert.fail("Expected protocol error");
  } catch (error) {
    assert.instanceOf(error, FdRuntimeCredentialProtocolError);
    assert.equal((error as FdRuntimeCredentialProtocolError).kind, kind);
  }
}
