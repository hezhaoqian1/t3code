// @effect-diagnostics nodeBuiltinImport:off - Entry point for the inherited-pipe shutdown regression test.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as DesktopTelemetryReceiver from "../../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as FdRuntimeCredentialStore from "../FdRuntimeCredentialStore.ts";

// The parent spawns this with pipes on fds 3-5 and keeps them open: telemetry
// input, telemetry control, and FD runtime credentials. The process must still
// exit once its scope closes.
Effect.gen(function* () {
  const base = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "fd-pipe-lifecycle-" })),
  );
  const context = yield* Layer.build(
    Layer.merge(DesktopTelemetryReceiver.layer, FdRuntimeCredentialStore.layer).pipe(
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(
        Layer.succeed(ServerConfig.ServerConfig, {
          ...base,
          desktopTelemetryFd: 3,
          desktopTelemetryControlFd: 4,
          fdRuntimeCredentialFd: 5,
        }),
      ),
    ),
  );
  const telemetry = Context.get(context, DesktopTelemetryReceiver.DesktopTelemetryReceiver);
  const credentials = Context.get(context, FdRuntimeCredentialStore.FdRuntimeCredentialStore);
  const health = yield* telemetry.subscribeHealth;
  const healthy = yield* health.changes.pipe(
    Stream.filter((value) => value.status === "healthy"),
    Stream.runHead,
    Effect.forkScoped,
  );
  yield* Console.log("ready");
  yield* Fiber.join(healthy);
  // A "clear" from the desktop leaves the store empty; reaching here proves the
  // credential reader is open on the inherited pipe without blocking exit.
  if (Option.isSome(yield* credentials.current)) {
    return yield* Effect.die("Unexpected runtime credential.");
  }
  yield* Console.log("verified");
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
