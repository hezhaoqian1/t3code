import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ServerConfig from "./config.ts";

it.layer(NodeServices.layer)("ServerConfig", (it) => {
  it.effect("owns a literal loopback host and no public runtime-state path", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const paths = yield* ServerConfig.deriveServerPaths("/tmp/t3-config-test", undefined);

      assert.equal(config.host, "127.0.0.1");
      assert.isFalse("serverRuntimeStatePath" in paths);
    }).pipe(Effect.provide(ServerConfig.layerTest(process.cwd(), "/tmp/t3-config-test"))),
  );
});
