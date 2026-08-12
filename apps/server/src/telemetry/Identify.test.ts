import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import * as ServerConfig from "../config.ts";
import * as Identify from "./Identify.ts";

interface CapturedLog {
  readonly annotations: Readonly<Record<string, unknown>>;
}

const sha256 = (value: string) =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

const makeCaptureLogger = (logs: CapturedLog[]) =>
  Logger.make(({ fiber }) => {
    logs.push({ annotations: fiber.getRef(References.CurrentLogAnnotations) });
  });

it.layer(NodeServices.layer)("anonymous telemetry identity", (it) => {
  it.effect("uses only the persisted anonymous id", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const anonymousId = "persisted-anonymous-id";
      yield* fileSystem.writeFileString(config.anonymousIdPath, anonymousId);

      assert.equal(yield* Identify.getTelemetryIdentifier, sha256(anonymousId));
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "fd-telemetry-identify-anonymous-" }),
      ),
    ),
  );

  it.effect("does not overwrite the identity path after a non-NotFound read failure", () => {
    const logs: CapturedLog[] = [];
    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(config.anonymousIdPath);

      assert.isNull(yield* Identify.getTelemetryIdentifier);
      assert.deepEqual(yield* fileSystem.readDirectory(config.anonymousIdPath), []);
      const readLog = logs.find((log) => log.annotations.errorTag === "TelemetryIdentityReadError");
      assert.isDefined(readLog);
      assert.equal(readLog?.annotations.source, "anonymous");
      assert.equal(readLog?.annotations.filePath, config.anonymousIdPath);
      assert.equal(readLog?.annotations.causeKind, "platform");
      assert.notEqual(readLog?.annotations.platformReason, "NotFound");
      assert.notProperty(readLog?.annotations ?? {}, "cause");
    }).pipe(
      Effect.provide(
        Layer.merge(
          ServerConfig.layerTest(process.cwd(), { prefix: "fd-telemetry-identify-read-" }),
          Logger.layer([makeCaptureLogger(logs)], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});
