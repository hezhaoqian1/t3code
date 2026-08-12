import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as FdCredentialPublisher from "./FdCredentialPublisher.ts";
import * as FdIdentity from "./FdIdentity.ts";
import { FdIdentityBroker } from "./FdIdentityBroker.ts";

it.effect("FdIdentity layer disposes its broker when the scope closes", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const rootDir = yield* path.fromFileUrl(new URL("../../../../", import.meta.url));
    const environment = DesktopEnvironment.DesktopEnvironment.of({
      path,
      isPackaged: false,
      resourcesPath: path.join(rootDir, "apps", "desktop", "resources"),
      rootDir,
      stateDir: path.join(rootDir, ".fd-identity-layer-test-unused"),
    } as DesktopEnvironment.DesktopEnvironment["Service"]);
    const dependencies = Layer.mergeAll(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
      FdCredentialPublisher.layerTest(),
    );
    const identityLayer = FdIdentity.layer.pipe(Layer.provide(dependencies));
    const dispose = vi.spyOn(FdIdentityBroker.prototype, "dispose");
    let releaseDispose!: () => void;
    const disposal = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    dispose.mockImplementation(() => disposal);
    try {
      let scopeClosed = false;
      const scope = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* FdIdentity.FdIdentity;
          assert.equal(dispose.mock.calls.length, 0);
        }).pipe(Effect.provide(identityLayer)),
      ).pipe(
        Effect.tap(() => Effect.sync(() => (scopeClosed = true))),
        Effect.forkChild,
      );
      yield* Effect.promise(() => vi.waitFor(() => assert.equal(dispose.mock.calls.length, 1)));
      yield* Effect.yieldNow;
      assert.isFalse(scopeClosed);
      releaseDispose();
      yield* Fiber.join(scope);
      assert.equal(dispose.mock.calls.length, 1);
      assert.isTrue(scopeClosed);
    } finally {
      dispose.mockRestore();
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
