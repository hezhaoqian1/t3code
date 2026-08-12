import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DesktopBackendBootstrap } from "./desktopBootstrap.ts";

const validBootstrap = {
  mode: "desktop",
  noBrowser: true,
  port: 4888,
  t3Home: "/tmp/t3-home",
  host: "127.0.0.1",
  desktopBootstrapToken: "desktop-bootstrap-token",
} as const;

const decodeBootstrap = Schema.decodeUnknownEffect(DesktopBackendBootstrap);

it.effect("decodes the loopback-only desktop bootstrap", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeBootstrap(validBootstrap);

    assert.deepEqual(decoded, validBootstrap);
  }),
);

it.effect("rejects a desktop bootstrap without t3Home", () =>
  Effect.gen(function* () {
    const missingT3Home: Record<string, unknown> = { ...validBootstrap };
    delete missingT3Home.t3Home;

    const exit = yield* Effect.exit(decodeBootstrap(missingT3Home));

    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("rejects non-loopback desktop bootstrap hosts", () =>
  Effect.gen(function* () {
    for (const host of ["0.0.0.0", "192.168.1.25", "100.64.0.7", "::1", "::", "2001:db8::1"]) {
      const exit = yield* Effect.exit(decodeBootstrap({ ...validBootstrap, host }));

      assert.strictEqual(exit._tag, "Failure", `expected bootstrap host ${host} to be rejected`);
    }
  }),
);

it.effect("rejects retired Tailscale desktop bootstrap fields", () =>
  Effect.gen(function* () {
    for (const extra of [
      { tailscaleServeEnabled: false },
      { tailscaleServePort: 443 },
      { tailscaleAuthKey: "secret" },
    ]) {
      const exit = yield* Effect.exit(decodeBootstrap({ ...validBootstrap, ...extra }));

      assert.strictEqual(exit._tag, "Failure", `expected ${Object.keys(extra)[0]} to be rejected`);
    }
  }),
);

it.effect("carries only the private FD credential descriptor", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeBootstrap({ ...validBootstrap, fdRuntimeCredentialFd: 6 });
    assert.equal(decoded.fdRuntimeCredentialFd, 6);

    const wrongFd = yield* Effect.exit(
      decodeBootstrap({ ...validBootstrap, fdRuntimeCredentialFd: 7 }),
    );
    assert.strictEqual(wrongFd._tag, "Failure");

    for (const field of ["accessToken", "runtimeApiKey", "refreshCookie", "password"]) {
      const exit = yield* Effect.exit(
        decodeBootstrap({ ...validBootstrap, fdRuntimeCredentialFd: 6, [field]: "secret" }),
      );
      assert.strictEqual(exit._tag, "Failure", `expected ${field} to be rejected`);
    }
  }),
);
