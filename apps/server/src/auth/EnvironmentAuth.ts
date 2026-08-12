import {
  AuthAccessTokenType,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  type AuthAccessTokenResult,
  type AuthBrowserSessionResult,
  type AuthClientMetadata,
  type AuthEnvironmentScope,
  type AuthSessionId,
  type AuthSessionState,
  type ServerAuthDescriptor,
  type ServerAuthSessionMethod,
  type AuthWebSocketTicketResult,
} from "@t3tools/contracts";
import { encodeOAuthScope } from "@t3tools/shared/oauthScope";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";
import * as BootstrapCredentialStore from "./BootstrapCredentialStore.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import { layerConfig as SqlitePersistenceLayer } from "../persistence/Layers/Sqlite.ts";

export interface AuthenticatedSession {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly expiresAt?: DateTime.DateTime;
}

export const LocalEnvironmentScopes: ReadonlyArray<AuthEnvironmentScope> = [
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthReviewWriteScope,
];

const localScopesFrom = (
  scopes: ReadonlyArray<AuthEnvironmentScope>,
): ReadonlyArray<AuthEnvironmentScope> =>
  LocalEnvironmentScopes.filter((scope) => scopes.includes(scope));

const serverAuthInternalErrorContext = {
  cause: Schema.Defect(),
};

export class ServerAuthBootstrapCredentialValidationError extends Schema.TaggedErrorClass<ServerAuthBootstrapCredentialValidationError>()(
  "ServerAuthBootstrapCredentialValidationError",
  {
    ...serverAuthInternalErrorContext,
  },
) {
  override get message(): string {
    return "Failed to validate bootstrap credential.";
  }
}

export class ServerAuthSessionCredentialValidationError extends Schema.TaggedErrorClass<ServerAuthSessionCredentialValidationError>()(
  "ServerAuthSessionCredentialValidationError",
  {
    ...serverAuthInternalErrorContext,
  },
) {
  override get message(): string {
    return "Failed to validate session credential.";
  }
}

export class ServerAuthAuthenticatedSessionIssueError extends Schema.TaggedErrorClass<ServerAuthAuthenticatedSessionIssueError>()(
  "ServerAuthAuthenticatedSessionIssueError",
  {
    ...serverAuthInternalErrorContext,
  },
) {
  override get message(): string {
    return "Failed to issue authenticated session.";
  }
}

export class ServerAuthAuthenticatedAccessTokenIssueError extends Schema.TaggedErrorClass<ServerAuthAuthenticatedAccessTokenIssueError>()(
  "ServerAuthAuthenticatedAccessTokenIssueError",
  {
    ...serverAuthInternalErrorContext,
  },
) {
  override get message(): string {
    return "Failed to issue authenticated access token.";
  }
}

export class ServerAuthWebSocketTokenIssueError extends Schema.TaggedErrorClass<ServerAuthWebSocketTokenIssueError>()(
  "ServerAuthWebSocketTokenIssueError",
  {
    ...serverAuthInternalErrorContext,
  },
) {
  override get message(): string {
    return "Failed to issue websocket token.";
  }
}

export const ServerAuthInternalError = Schema.Union([
  ServerAuthBootstrapCredentialValidationError,
  ServerAuthSessionCredentialValidationError,
  ServerAuthAuthenticatedSessionIssueError,
  ServerAuthAuthenticatedAccessTokenIssueError,
  ServerAuthWebSocketTokenIssueError,
]);
export type ServerAuthInternalError = typeof ServerAuthInternalError.Type;
export const isServerAuthInternalError = Schema.is(ServerAuthInternalError);

export class ServerAuthMissingCredentialError extends Schema.TaggedErrorClass<ServerAuthMissingCredentialError>()(
  "ServerAuthMissingCredentialError",
  {},
) {
  override get message(): string {
    return "Server authentication credential is missing.";
  }
}

export class ServerAuthInvalidCredentialError extends Schema.TaggedErrorClass<ServerAuthInvalidCredentialError>()(
  "ServerAuthInvalidCredentialError",
  {
    diagnostic: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Server authentication credential is invalid.";
  }
}

export const ServerAuthCredentialError = Schema.Union([
  ServerAuthMissingCredentialError,
  ServerAuthInvalidCredentialError,
]);
export type ServerAuthCredentialError = typeof ServerAuthCredentialError.Type;
export const isServerAuthCredentialError = Schema.is(ServerAuthCredentialError);
export const serverAuthCredentialReason = (
  error: ServerAuthCredentialError,
): "missing_credential" | "invalid_credential" =>
  error._tag === "ServerAuthMissingCredentialError" ? "missing_credential" : "invalid_credential";

export class ServerAuthInvalidScopeError extends Schema.TaggedErrorClass<ServerAuthInvalidScopeError>()(
  "ServerAuthInvalidScopeError",
  {},
) {
  override get message(): string {
    return "The requested authentication scope is invalid.";
  }
}

export class ServerAuthScopeNotGrantedError extends Schema.TaggedErrorClass<ServerAuthScopeNotGrantedError>()(
  "ServerAuthScopeNotGrantedError",
  {},
) {
  override get message(): string {
    return "The requested authentication scope was not granted.";
  }
}

export const ServerAuthInvalidRequestError = Schema.Union([
  ServerAuthInvalidScopeError,
  ServerAuthScopeNotGrantedError,
]);
export type ServerAuthInvalidRequestError = typeof ServerAuthInvalidRequestError.Type;
export const isServerAuthInvalidRequestError = Schema.is(ServerAuthInvalidRequestError);
export const serverAuthInvalidRequestReason = (
  error: ServerAuthInvalidRequestError,
): "invalid_scope" | "scope_not_granted" =>
  error._tag === "ServerAuthInvalidScopeError" ? "invalid_scope" : "scope_not_granted";

export class EnvironmentAuth extends Context.Service<
  EnvironmentAuth,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
    readonly getSessionState: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthSessionState, ServerAuthInternalError>;
    readonly createBrowserSession: (
      credential: string,
      requestMetadata: AuthClientMetadata,
      input?: { readonly origin?: string },
    ) => Effect.Effect<
      {
        readonly response: AuthBrowserSessionResult;
        readonly sessionToken: string;
      },
      ServerAuthInvalidCredentialError | ServerAuthInternalError
    >;
    readonly exchangeBootstrapCredentialForAccessToken: (
      credential: string,
      requestedScopes: ReadonlyArray<AuthEnvironmentScope> | undefined,
      requestMetadata: AuthClientMetadata,
    ) => Effect.Effect<
      AuthAccessTokenResult,
      ServerAuthInvalidCredentialError | ServerAuthInvalidRequestError | ServerAuthInternalError
    >;
    readonly authenticateHttpRequest: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly authenticateWebSocketUpgrade: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly issueWebSocketTicket: (
      session: Pick<AuthenticatedSession, "sessionId">,
    ) => Effect.Effect<AuthWebSocketTicketResult, ServerAuthInternalError>;
  }
>()("t3/auth/EnvironmentAuth") {}

type BootstrapExchangeResult = {
  readonly response: AuthBrowserSessionResult;
  readonly sessionToken: string;
};

const AUTHORIZATION_PREFIX = "Bearer ";
const WEBSOCKET_TICKET_QUERY_PARAM = "wsTicket";

export function toBootstrapExchangeError(
  cause: BootstrapCredentialStore.BootstrapCredentialError,
): ServerAuthInvalidCredentialError | ServerAuthInternalError {
  if (BootstrapCredentialStore.isBootstrapCredentialInternalError(cause)) {
    return new ServerAuthBootstrapCredentialValidationError({ cause });
  }

  return new ServerAuthInvalidCredentialError({
    cause,
  });
}

const mapSessionVerificationErrors = <A, R>(
  effect: Effect.Effect<A, SessionStore.SessionCredentialError, R>,
): Effect.Effect<A, ServerAuthInvalidCredentialError | ServerAuthInternalError, R> =>
  effect.pipe(
    Effect.mapError((cause) =>
      SessionStore.isSessionCredentialInvalidError(cause)
        ? new ServerAuthInvalidCredentialError({ cause })
        : new ServerAuthSessionCredentialValidationError({ cause }),
    ),
  );

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export const make = Effect.gen(function* () {
  const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
  const bootstrapCredentials = yield* BootstrapCredentialStore.BootstrapCredentialStore;
  const sessions = yield* SessionStore.SessionStore;
  const descriptor = yield* policy.getDescriptor();

  const authenticateToken = (
    token: string,
  ): Effect.Effect<
    AuthenticatedSession,
    ServerAuthInvalidCredentialError | ServerAuthInternalError
  > =>
    sessions.verify(token).pipe(
      Effect.tapError((cause) =>
        SessionStore.isSessionCredentialInvalidError(cause)
          ? Effect.logWarning("Rejected authenticated session credential.").pipe(
              Effect.annotateLogs({
                reason: cause.message,
              }),
            )
          : Effect.void,
      ),
      Effect.map((session) => ({
        sessionId: session.sessionId,
        subject: session.subject,
        method: session.method,
        scopes: session.scopes,
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
      })),
      mapSessionVerificationErrors,
    );

  const authenticateRequest = (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError> => {
    const cookieToken = request.cookies[sessions.cookieName];
    const bearerToken = parseBearerToken(request);
    const credential = cookieToken ?? bearerToken;
    if (!credential) {
      return Effect.fail(new ServerAuthMissingCredentialError({}));
    }
    return authenticateToken(credential);
  };

  const getSessionState: EnvironmentAuth["Service"]["getSessionState"] = (request) =>
    authenticateRequest(request).pipe(
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            auth: descriptor,
            scopes: session.scopes,
            sessionMethod: session.method,
            ...(session.expiresAt ? { expiresAt: DateTime.toUtc(session.expiresAt) } : {}),
          }) satisfies AuthSessionState,
      ),
      Effect.catchIf(isServerAuthCredentialError, () =>
        Effect.succeed({
          authenticated: false,
          auth: descriptor,
        } satisfies AuthSessionState),
      ),
      Effect.withSpan("EnvironmentAuth.getSessionState"),
    );

  const createBrowserSession: EnvironmentAuth["Service"]["createBrowserSession"] = (
    credential,
    requestMetadata,
    input,
  ) =>
    bootstrapCredentials
      .consume(credential, {
        use: "browser-session",
        ...(input?.origin ? { origin: input.origin } : {}),
      })
      .pipe(
        Effect.mapError(toBootstrapExchangeError),
        Effect.flatMap((grant) =>
          sessions
            .issue({
              method: "browser-session-cookie",
              subject: grant.subject,
              scopes: localScopesFrom(grant.scopes),
              client: {
                ...requestMetadata,
                ...(grant.label ? { label: grant.label } : {}),
              },
            })
            .pipe(
              Effect.mapError((cause) => new ServerAuthAuthenticatedSessionIssueError({ cause })),
            ),
        ),
        Effect.map(
          (session) =>
            ({
              response: {
                authenticated: true,
                scopes: session.scopes,
                sessionMethod: session.method,
                expiresAt: DateTime.toUtc(session.expiresAt),
              } satisfies AuthBrowserSessionResult,
              sessionToken: session.token,
            }) satisfies BootstrapExchangeResult,
        ),
        Effect.withSpan("EnvironmentAuth.createBrowserSession"),
      );

  const exchangeBootstrapCredentialForAccessToken: EnvironmentAuth["Service"]["exchangeBootstrapCredentialForAccessToken"] =
    (credential, requestedScopes, requestMetadata) =>
      bootstrapCredentials
        .consume(credential, {
          use: "access-token",
        })
        .pipe(
          Effect.mapError(toBootstrapExchangeError),
          Effect.flatMap((grant) =>
            Effect.gen(function* () {
              if (requestedScopes?.some((scope) => !LocalEnvironmentScopes.includes(scope))) {
                return yield* new ServerAuthInvalidScopeError({});
              }
              const localGrantScopes = localScopesFrom(grant.scopes);
              const grantedScopes = requestedScopes ?? localGrantScopes;
              if (!grantedScopes.every((scope) => localGrantScopes.includes(scope))) {
                return yield* new ServerAuthScopeNotGrantedError({});
              }
              return yield* sessions
                .issue({
                  method: "bearer-access-token",
                  subject: grant.subject,
                  scopes: grantedScopes,
                  client: {
                    ...requestMetadata,
                    ...(grant.label ? { label: grant.label } : {}),
                  },
                })
                .pipe(
                  Effect.mapError(
                    (cause) => new ServerAuthAuthenticatedAccessTokenIssueError({ cause }),
                  ),
                );
            }),
          ),
          Effect.flatMap((session) =>
            DateTime.now.pipe(
              Effect.map(
                (now) =>
                  ({
                    access_token: session.token,
                    issued_token_type: AuthAccessTokenType,
                    token_type: "Bearer",
                    expires_in: Math.max(
                      0,
                      Math.floor(
                        (session.expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000,
                      ),
                    ),
                    scope: encodeOAuthScope(session.scopes),
                  }) satisfies AuthAccessTokenResult,
              ),
            ),
          ),
          Effect.withSpan("EnvironmentAuth.exchangeBootstrapCredentialForAccessToken"),
        );

  const issueWebSocketTicket: EnvironmentAuth["Service"]["issueWebSocketTicket"] = (session) =>
    sessions.issueWebSocketToken(session.sessionId).pipe(
      Effect.mapError((cause) => new ServerAuthWebSocketTokenIssueError({ cause })),
      Effect.map(
        (issued) =>
          ({
            ticket: issued.token,
            expiresAt: DateTime.toUtc(issued.expiresAt),
          }) satisfies AuthWebSocketTicketResult,
      ),
      Effect.withSpan("EnvironmentAuth.issueWebSocketTicket"),
    );

  const authenticateHttpRequest: EnvironmentAuth["Service"]["authenticateHttpRequest"] = (
    request,
  ) =>
    authenticateRequest(request).pipe(Effect.withSpan("EnvironmentAuth.authenticateHttpRequest"));

  const authenticateWebSocketUpgrade: EnvironmentAuth["Service"]["authenticateWebSocketUpgrade"] =
    Effect.fn("EnvironmentAuth.authenticateWebSocketUpgrade")(function* (request) {
      const requestUrl = HttpServerRequest.toURL(request);
      if (Option.isSome(requestUrl)) {
        const websocketTicket = requestUrl.value.searchParams.get(WEBSOCKET_TICKET_QUERY_PARAM);
        if (websocketTicket && websocketTicket.trim().length > 0) {
          return yield* sessions.verifyWebSocketToken(websocketTicket).pipe(
            Effect.map((session) => ({
              sessionId: session.sessionId,
              subject: session.subject,
              method: session.method,
              scopes: session.scopes,
              ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
            })),
            mapSessionVerificationErrors,
          );
        }
      }

      return yield* authenticateRequest(request);
    });

  return EnvironmentAuth.of({
    getDescriptor: () =>
      Effect.succeed(descriptor).pipe(Effect.withSpan("EnvironmentAuth.getDescriptor")),
    getSessionState,
    createBrowserSession,
    exchangeBootstrapCredentialForAccessToken,
    authenticateHttpRequest,
    authenticateWebSocketUpgrade,
    issueWebSocketTicket,
  });
});

export const layer = Layer.effect(EnvironmentAuth, make).pipe(
  Layer.provideMerge(BootstrapCredentialStore.layer),
  Layer.provideMerge(SessionStore.layer),
  Layer.provideMerge(EnvironmentAuthPolicy.layer),
);

export const storageLayer = Layer.mergeAll(ServerSecretStore.layer, SqlitePersistenceLayer);

export const runtimeLayer = layer.pipe(Layer.provideMerge(storageLayer));
