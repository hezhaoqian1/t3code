import { assert, describe, it } from "@effect/vitest";
import { FdAccountLoginResponse } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as FdIdentity from "../../fd-identity/FdIdentity.ts";
import * as IpcChannels from "../channels.ts";
import { installAccountStateForwarding, login, reload } from "./account.ts";

const authenticatedState = {
  status: "authenticated",
  policyVersion: 1,
  profile: { id: 31, username: "employee", displayName: "方德员工" },
  capabilities: { generalAssistant: true },
  expiresAt: 2_000_000_000,
} as const;

const identityLayer = Layer.succeed(
  FdIdentity.FdIdentity,
  FdIdentity.FdIdentity.of({
    initialize: Effect.void,
    getState: Effect.succeed(authenticatedState),
    login: () => Effect.succeed({ ok: true, state: authenticatedState }),
    logout: Effect.succeed({ completed: true, state: { status: "anonymous" } }),
    reload: Effect.succeed({ state: authenticatedState }),
    retryRevocation: Effect.succeed({ completed: true, state: { status: "anonymous" } }),
    getUsageSummary: Effect.die("not mocked"),
    subscribe: (listener) => listener(authenticatedState),
  }),
);

describe("FD account IPC", () => {
  it.effect("decodes login payloads and encodes only renderer-safe summaries", () =>
    Effect.gen(function* () {
      const response = yield* login.handler({ username: "employee", password: "test-only" });
      const decodedResponse = yield* Schema.decodeUnknownEffect(FdAccountLoginResponse)(response);
      assert.deepEqual(decodedResponse, { ok: true, state: authenticatedState });
      assert.notProperty(decodedResponse, "accessToken");
      if (decodedResponse.ok) {
        assert.notProperty(decodedResponse.state, "runtimeApiKey");
      }

      const exit = yield* login
        .handler({ username: "employee", password: "test-only", runtimeApiKey: "forbidden" })
        .pipe(Effect.exit);
      assert.equal(exit._tag, "Failure");
    }).pipe(Effect.provide(identityLayer)),
  );

  it.effect("pushes only the public account state channel", () => {
    const sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
    return Effect.scoped(
      installAccountStateForwarding().pipe(
        Effect.provide(
          Layer.mergeAll(
            identityLayer,
            Layer.mock(ElectronWindow.ElectronWindow)({
              sendAll: (channel, payload) =>
                Effect.sync(() => {
                  sent.push({ channel, payload });
                }),
            }),
          ),
        ),
        Effect.andThen(
          Effect.sync(() => {
            assert.deepEqual(sent, [
              {
                channel: IpcChannels.FD_ACCOUNT_STATE_CHANGED_CHANNEL,
                payload: authenticatedState,
              },
            ]);
          }),
        ),
      ),
    );
  });

  it.effect("exposes an explicit schema-encoded account reload", () =>
    Effect.gen(function* () {
      const response = yield* reload.handler(undefined);
      assert.deepEqual(response, { state: authenticatedState });
      assert.notProperty((response as { state: object }).state, "accessToken");
      assert.notProperty((response as { state: object }).state, "model");
    }).pipe(Effect.provide(identityLayer)),
  );
});
