import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { PersistenceSqlError } from "../persistence/Errors.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as SessionStore from "./SessionStore.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const makeServerConfigLayer = (
  overrides?: Partial<Pick<ServerConfig.ServerConfig["Service"], "desktopBootstrapToken">>,
) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-session-test-" })));

const makeSessionStoreLayer = (
  overrides?: Partial<Pick<ServerConfig.ServerConfig["Service"], "desktopBootstrapToken">>,
) =>
  SessionStore.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

const repositoryFailure = new PersistenceSqlError({
  operation: "AuthSessionRepository.getById:query",
  detail: "sqlite is unavailable",
});

const failingSessionLookupRepositoryLayer = Layer.succeed(AuthSessions.AuthSessionRepository, {
  create: () => Effect.void,
  getById: () => Effect.fail(repositoryFailure),
  setLastConnectedAt: () => Effect.void,
});

const failingSessionLookupCredentialLayer = Layer.effect(
  SessionStore.SessionStore,
  SessionStore.make,
).pipe(
  Layer.provide(failingSessionLookupRepositoryLayer),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(makeServerConfigLayer()),
);

it.layer(NodeServices.layer)("SessionStore.layer", (it) => {
  it.effect("issues and verifies signed browser session tokens", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue({
        subject: "desktop-bootstrap",
        scopes: ["orchestration:read", "review:write"],
        client: {
          label: "Desktop app",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
          ipAddress: "127.0.0.1",
        },
      });
      const verified = yield* sessions.verify(issued.token);

      expect(verified.method).toBe("browser-session-cookie");
      expect(verified.subject).toBe("desktop-bootstrap");
      expect(verified.scopes).toEqual(["orchestration:read", "review:write"]);
      expect(verified.client.label).toBe("Desktop app");
      expect(verified.client.browser).toBe("Electron");
      expect(verified.expiresAt?.toString()).toBe(issued.expiresAt.toString());
    }).pipe(Effect.provide(makeSessionStoreLayer())),
  );
  it.effect("rejects malformed session tokens", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const error = yield* Effect.flip(sessions.verify("not-a-session-token"));

      expect(error._tag).toBe("MalformedSessionTokenError");
      expect(error.message).toContain("Malformed session token");
    }).pipe(Effect.provide(makeSessionStoreLayer())),
  );
  it.effect("preserves repository failures while verifying session and websocket credentials", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "repository-failure",
      });
      const websocket = yield* sessions.issueWebSocketToken(issued.sessionId);

      const sessionError = yield* Effect.flip(sessions.verify(issued.token));
      const websocketError = yield* Effect.flip(sessions.verifyWebSocketToken(websocket.token));

      expect(sessionError._tag).toBe("SessionCredentialVerificationError");
      expect(websocketError._tag).toBe("WebSocketTokenVerificationError");
      expect(sessionError.cause).toBe(repositoryFailure);
      expect(websocketError.cause).toBe(repositoryFailure);
      if (sessionError._tag === "SessionCredentialVerificationError") {
        expect(sessionError.sessionId).toBe(issued.sessionId);
      }
      if (websocketError._tag === "WebSocketTokenVerificationError") {
        expect(websocketError.sessionId).toBe(issued.sessionId);
      }
    }).pipe(Effect.provide(failingSessionLookupCredentialLayer)),
  );
  it.effect("verifies session tokens against the Effect clock", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "test-clock",
      });
      const verified = yield* sessions.verify(issued.token);

      expect(verified.method).toBe("bearer-access-token");
      expect(verified.subject).toBe("test-clock");
      expect(verified.scopes).toEqual([
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
      ]);
      expect(verified.scopes).not.toContain("relay:read");
      expect(verified.scopes).not.toContain("relay:write");
      expect(verified.scopes).not.toContain("access:read");
      expect(verified.scopes).not.toContain("access:write");
    }).pipe(Effect.provide(Layer.merge(makeSessionStoreLayer(), TestClock.layer()))),
  );

  it.effect("rejects websocket tokens once the parent session has expired", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "short-lived",
        ttl: Duration.seconds(1),
      });
      const websocket = yield* sessions.issueWebSocketToken(issued.sessionId);

      yield* TestClock.adjust(Duration.seconds(2));

      const error = yield* Effect.flip(sessions.verifyWebSocketToken(websocket.token));
      expect(error._tag).toBe("WebSocketSessionExpiredError");
      if (error._tag === "WebSocketSessionExpiredError") {
        expect(error.sessionId).toBe(issued.sessionId);
        expect(error.expiresAt.epochMilliseconds).toBe(issued.expiresAt.epochMilliseconds);
        expect(error.observedAt.epochMilliseconds).toBeGreaterThan(
          error.expiresAt.epochMilliseconds,
        );
      }
    }).pipe(Effect.provide(Layer.merge(makeSessionStoreLayer(), TestClock.layer()))),
  );

  it.effect("includes expiry context when session and websocket tokens expire", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "short-lived-token",
        ttl: Duration.seconds(1),
      });
      const websocket = yield* sessions.issueWebSocketToken(issued.sessionId, {
        ttl: Duration.seconds(1),
      });

      yield* TestClock.adjust(Duration.seconds(2));

      const sessionError = yield* Effect.flip(sessions.verify(issued.token));
      const websocketError = yield* Effect.flip(sessions.verifyWebSocketToken(websocket.token));

      expect(sessionError._tag).toBe("SessionTokenExpiredError");
      if (sessionError._tag === "SessionTokenExpiredError") {
        expect(sessionError.sessionId).toBe(issued.sessionId);
        expect(sessionError.expiresAt.epochMilliseconds).toBe(issued.expiresAt.epochMilliseconds);
        expect(sessionError.observedAt.epochMilliseconds).toBeGreaterThan(
          sessionError.expiresAt.epochMilliseconds,
        );
      }
      expect(websocketError._tag).toBe("WebSocketTokenExpiredError");
      if (websocketError._tag === "WebSocketTokenExpiredError") {
        expect(websocketError.sessionId).toBe(issued.sessionId);
        expect(websocketError.expiresAt.epochMilliseconds).toBe(
          websocket.expiresAt.epochMilliseconds,
        );
        expect(websocketError.observedAt.epochMilliseconds).toBeGreaterThan(
          websocketError.expiresAt.epochMilliseconds,
        );
      }
    }).pipe(Effect.provide(Layer.merge(makeSessionStoreLayer(), TestClock.layer()))),
  );

  it.effect("persists lastConnectedAt on first connect and updates it after reconnect", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const repository = yield* AuthSessions.AuthSessionRepository;
      const issued = yield* sessions.issue({
        subject: "reconnect-test",
        method: "bearer-access-token",
      });

      const beforeConnect = yield* repository.getById({ sessionId: issued.sessionId });
      expect(beforeConnect.pipe(Option.getOrThrow).lastConnectedAt).toBeNull();

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const firstConnect = yield* repository.getById({ sessionId: issued.sessionId });
      const firstConnectedAt = firstConnect.pipe(Option.getOrThrow).lastConnectedAt;

      expect(firstConnectedAt).not.toBeNull();

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const stillConnected = yield* repository.getById({ sessionId: issued.sessionId });

      expect(stillConnected.pipe(Option.getOrThrow).lastConnectedAt?.toString()).toBe(
        firstConnectedAt?.toString(),
      );

      yield* sessions.markDisconnected(issued.sessionId);
      yield* sessions.markDisconnected(issued.sessionId);
      const afterDisconnect = yield* repository.getById({ sessionId: issued.sessionId });

      expect(afterDisconnect.pipe(Option.getOrThrow).lastConnectedAt?.toString()).toBe(
        firstConnectedAt?.toString(),
      );

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const afterReconnect = yield* repository.getById({ sessionId: issued.sessionId });
      const reconnectedAt = afterReconnect.pipe(Option.getOrThrow).lastConnectedAt;

      expect(reconnectedAt).not.toBeNull();
      expect(reconnectedAt?.toString()).not.toBe(firstConnectedAt?.toString());
    }).pipe(Effect.provide(Layer.merge(makeSessionStoreLayer(), TestClock.layer()))),
  );
});
