import * as Effect from "effect/Effect";
import { GlobalFlag } from "effect/unstable/cli";

import { ServerConfig } from "../config.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig } from "./config.ts";

export const runServerCommand = (flags: CliServerFlags) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(flags, logLevel);
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
  });
