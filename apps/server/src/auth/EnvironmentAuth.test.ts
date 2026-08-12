import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as BootstrapCredentialStore from "./BootstrapCredentialStore.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const TEST_SERVER_PORT = 13_773;
const LOCAL_SCOPES = [
  "orchestration:read",
  "orchestration:operate",
  "terminal:operate",
  "review:write",
] as const;

const makeEnvironmentAuthLayer = EnvironmentAuth.layer.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        return {
          ...config,
          port: TEST_SERVER_PORT,
          desktopBootstrapToken: "desktop-bootstrap-token",
        } satisfies ServerConfig.ServerConfig["Service"];
      }),
    ).pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-server-test-" })),
    ),
  ),
);

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Electron",
  ipAddress: "127.0.0.1",
};

it.layer(NodeServices.layer)("EnvironmentAuth.layer", (it) => {
  it.effect("classifies invalid bootstrap credentials for the HTTP boundary", () =>
    Effect.sync(() => {
      const error = EnvironmentAuth.toBootstrapExchangeError(
        new BootstrapCredentialStore.UnknownBootstrapCredentialError({}),
      );
      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }),
  );

  it.effect("maps unexpected bootstrap failures to internal errors", () =>
    Effect.sync(() => {
      const cause = new BootstrapCredentialStore.BootstrapCredentialConsumeError({
        cause: new Error("sqlite is unavailable"),
      });
      const error = EnvironmentAuth.toBootstrapExchangeError(cause);

      expect(error._tag).toBe("ServerAuthBootstrapCredentialValidationError");
      if (error._tag === "ServerAuthBootstrapCredentialValidationError") {
        expect(error.cause).toBe(cause);
      }
    }),
  );

  it.effect("creates an authenticated local browser session from Desktop bootstrap", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const exchanged = yield* serverAuth.createBrowserSession(
        "desktop-bootstrap-token",
        requestMetadata,
      );
      const authenticated = yield* serverAuth.authenticateHttpRequest({
        cookies: { [sessions.cookieName]: exchanged.sessionToken },
        headers: {},
      } as never);

      expect(exchanged.response.scopes).toEqual(LOCAL_SCOPES);
      expect(authenticated.scopes).toEqual(LOCAL_SCOPES);
      expect(authenticated.subject).toBe("desktop-bootstrap");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer)),
  );

  it.effect("limits access-token exchange to local runtime scopes", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        "desktop-bootstrap-token",
        undefined,
        requestMetadata,
      );
      const rejected = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(
          "desktop-bootstrap-token",
          ["retired-scope"] as never,
          requestMetadata,
        )
        .pipe(Effect.flip);

      expect(token.scope).toBe(LOCAL_SCOPES.join(" "));
      expect(rejected._tag).toBe("ServerAuthInvalidScopeError");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer)),
  );
});
