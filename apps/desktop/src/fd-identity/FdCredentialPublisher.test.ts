import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES,
  FdRuntimeCredentialCommand,
} from "@t3tools/contracts/fd/runtime-credentials";

import { assertFdRuntimeCredentialCommandSize, make } from "./FdCredentialPublisher.ts";

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

describe("FdCredentialPublisher", () => {
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(FdRuntimeCredentialCommand));

  it.effect("rehydrates every backend stream with the current validated projection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* make();
        yield* publisher.set(projection);
        const first = yield* publisher.encoded.pipe(
          Stream.take(1),
          Stream.decodeText(),
          Stream.mkString,
        );
        const restarted = yield* publisher.encoded.pipe(
          Stream.take(1),
          Stream.decodeText(),
          Stream.mkString,
        );
        const firstCommand = decode(first);
        assert.deepEqual(firstCommand, decode(restarted));
        assert.equal(firstCommand.type, "set");
        if (firstCommand.type === "set") assert.equal(firstCommand.credentials.generation, 7);
      }),
    ),
  );

  it.effect("publishes a higher-generation clear without retaining credentials", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* make();
        yield* publisher.set(projection);
        yield* publisher.clear("logout");
        const encoded = yield* publisher.encoded.pipe(
          Stream.take(1),
          Stream.decodeText(),
          Stream.mkString,
        );
        const command = decode(encoded);
        assert.equal(command.type, "clear");
        if (command.type === "clear") assert.equal(command.generation, 8);
        assert.isFalse("credentials" in command);
        assert.notInclude(encoded, "access-secret");
        assert.notInclude(encoded, "sk-runtime-secret");
      }),
    ),
  );

  it("rejects an encoded command larger than the pipe protocol bound", () => {
    const oversized = new Uint8Array(FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES + 1).fill(120);
    assert.throws(() => assertFdRuntimeCredentialCommandSize(oversized), /protocol limit/);
    assert.isTrue(oversized.every((byte) => byte === 0));
  });
});
