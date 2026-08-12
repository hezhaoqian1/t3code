import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

const REQUEST_TIMEOUT_MS = 10_000;

export const bootstrapLocalBearerSession = Effect.fn(
  "clientRuntime.authorization.bootstrapLocalBearerSession",
)(function* (input: { readonly httpBaseUrl: string; readonly credential: string }) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  const requestUrl = environmentEndpointUrl(input.httpBaseUrl, "/oauth/token");
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    REQUEST_TIMEOUT_MS,
    client.auth.token({
      payload: {
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.credential,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
      },
    }),
  );
});

export const issueLocalWebSocketTicket = Effect.fn(
  "clientRuntime.authorization.issueLocalWebSocketTicket",
)(function* (input: { readonly httpBaseUrl: string; readonly bearerToken: string }) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  const requestUrl = environmentEndpointUrl(input.httpBaseUrl, "/api/auth/websocket-ticket");
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    REQUEST_TIMEOUT_MS,
    client.auth.webSocketTicket({ headers: { authorization: `Bearer ${input.bearerToken}` } }),
  );
});

export const resolveLocalWebSocketConnectionUrl = Effect.fn(
  "clientRuntime.authorization.resolveLocalWebSocketConnectionUrl",
)(function* (input: {
  readonly wsBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}) {
  const issued = yield* issueLocalWebSocketTicket(input);
  const url = new URL(input.wsBaseUrl);
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/ws";
  }
  url.searchParams.set("wsTicket", issued.ticket);
  return url.toString();
});
