import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";

const makeEnvironmentAuthPolicyLayer = (
  overrides?: Partial<ServerConfig.ServerConfig["Service"]>,
) =>
  EnvironmentAuthPolicy.layer.pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return {
            ...config,
            ...overrides,
          } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-policy-test-" })),
      ),
    ),
  );

it.layer(NodeServices.layer)("EnvironmentAuthPolicy.layer", (it) => {
  it.effect("uses desktop-managed-local policy for desktop mode", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("desktop-managed-local");
      expect(descriptor.bootstrapMethods).toEqual([]);
      // Packaged desktop has no devUrl, but still needs the port scope: it
      // scans upward from 3773 for a free port and binds 127.0.0.1, so a second
      // instance shares this one's hostname on a different port.
      expect(descriptor.sessionCookieName).toBe("t3_session_3773");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "desktop",
          port: 3773,
        }),
      ),
    ),
  );

  it.effect("keeps desktop cookies port-scoped on the port a second instance lands on", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.sessionCookieName).toBe("t3_session_3774");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "desktop",
          port: 3774,
        }),
      ),
    ),
  );

  it.effect("uses the primary Desktop policy for the dev-only loopback host", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("desktop-managed-local");
      expect(descriptor.bootstrapMethods).toEqual([]);
      expect(descriptor.sessionCookieName).toMatch(/^t3_session_3773_[a-f0-9]{12}$/);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
        }),
      ),
    ),
  );
});
