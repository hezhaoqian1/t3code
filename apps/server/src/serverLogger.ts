import * as SharedObservability from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Layer from "effect/Layer";

import { ServerConfig } from "./config.ts";

// HTTP errors logged with --log-ws-events carry the request URL and its connection ticket.
export const redactingCredentials = <Output>(logger: Logger.Logger<unknown, Output>) =>
  Logger.make<unknown, Output>((options) =>
    logger.log({ ...options, cause: SharedObservability.redactCauseCredentials(options.cause) }),
  );

export const ServerLoggerLive = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const minimumLogLevelLayer = Layer.succeed(References.MinimumLogLevel, config.logLevel);
  const loggerLayer = Logger.layer(
    [redactingCredentials(Logger.consolePretty()), Logger.tracerLogger],
    { mergeWithExisting: false },
  );

  return Layer.mergeAll(loggerLayer, minimumLogLevelLayer);
}).pipe(Layer.unwrap);
