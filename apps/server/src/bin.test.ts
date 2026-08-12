import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import { cli } from "./bin.ts";

const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
  );

const assertRejected = Effect.fn(function* (args: ReadonlyArray<string>) {
  const error = yield* runCli(args).pipe(Effect.flip);
  if (!CliError.isCliError(error)) {
    assert.fail(`Expected CliError for ${args.join(" ")}, got ${String(error)}`);
  }
});

it.effect("accepts root command global flags without starting the server", () =>
  runCli(["--log-level", "debug", "--version"]),
);

it.effect("does not register or parse retired public commands", () =>
  Effect.gen(function* () {
    assert.deepEqual(cli.subcommands, []);
    for (const command of ["connect", "pair", "auth", "project", "service"] as const) {
      yield* assertRejected([command]);
    }
  }),
);

it.effect("rejects retired network exposure flags", () =>
  Effect.gen(function* () {
    yield* assertRejected(["--host", "0.0.0.0"]);
    yield* assertRejected(["--tailscale-serve"]);
    yield* assertRejected(["--tailscale-serve-port", "8443"]);
  }),
);
