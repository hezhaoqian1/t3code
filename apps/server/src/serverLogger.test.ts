import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import { redactingCredentials } from "./serverLogger.ts";

describe("ServerLoggerLive", () => {
  it.effect("logs request failures without their connection tickets", () =>
    Effect.gen(function* () {
      const printed: Array<string> = [];
      const capture = Logger.make<unknown, void>(({ cause }) => {
        printed.push(Cause.pretty(cause));
      });

      yield* Effect.logError(
        Cause.die(
          new Error("RequestParseError (GET /ws?wsTicket=ticket-secret&dpop=proof-secret)"),
        ),
      ).pipe(
        Effect.provide(Logger.layer([redactingCredentials(capture)], { mergeWithExisting: false })),
      );
      yield* Effect.logError("plain message").pipe(
        Effect.provide(Logger.layer([redactingCredentials(capture)], { mergeWithExisting: false })),
      );

      const output = printed.join("\n");
      assert.include(output, "wsTicket=<redacted>&dpop=<redacted>");
      assert.notInclude(output, "ticket-secret");
      assert.notInclude(output, "proof-secret");
    }),
  );
});
