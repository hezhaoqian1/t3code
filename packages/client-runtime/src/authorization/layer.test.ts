import { AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { localHttpClientLayer } from "../rpc/http.ts";
import { bootstrapLocalBearerSession } from "./local.ts";
import * as PrimaryAuthorization from "./service.ts";

type FetchCall = readonly [RequestInfo | URL, RequestInit];

function recordedFetch(responses: ReadonlyArray<Response>) {
  const calls: FetchCall[] = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    return response === undefined
      ? Promise.reject(new Error(`Unexpected fetch call to ${String(input)}`))
      : Promise.resolve(response);
  }) satisfies typeof fetch;
  return { calls, fetchFn };
}

const ticketResponse = (ticket: string) =>
  Response.json({ ticket, expiresAt: "2026-08-09T12:05:00.000Z" });

describe("primary environment authorization", () => {
  it.effect("bootstraps the local Desktop bearer session", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch([
        Response.json({
          access_token: "primary-bearer",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3_600,
          scope: AuthStandardClientScopes.join(" "),
        }),
      ]);

      const token = yield* bootstrapLocalBearerSession({
        httpBaseUrl: "http://127.0.0.1:3777",
        credential: "desktop-bootstrap",
      }).pipe(Effect.provide(localHttpClientLayer(fetch.fetchFn)));

      expect(token.access_token).toBe("primary-bearer");
      expect(token.scope).toBe(AuthStandardClientScopes.join(" "));
      expect(fetch.calls).toHaveLength(1);
      expect(String(fetch.calls[0]?.[0])).toBe("http://127.0.0.1:3777/oauth/token");
      const body = fetch.calls[0]?.[1].body;
      expect(body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body)).toContain(
        "subject_token=desktop-bootstrap",
      );
    }),
  );

  it.effect("refreshes the WebSocket ticket for every connection attempt", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch([ticketResponse("first"), ticketResponse("second")]);
      const authorization = yield* PrimaryAuthorization.make.pipe(
        Effect.provide(localHttpClientLayer(fetch.fetchFn)),
      );
      const target = new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make("primary"),
        label: "Desktop",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      const first = yield* authorization.authorize(target, "primary-bearer");
      const second = yield* authorization.authorize(target, "primary-bearer");

      expect(first).toBe("ws://127.0.0.1:3777/ws?wsTicket=first");
      expect(second).toBe("ws://127.0.0.1:3777/ws?wsTicket=second");
      expect(fetch.calls).toHaveLength(2);
      for (const [, init] of fetch.calls) {
        expect(init.headers).toEqual(
          expect.objectContaining({ authorization: "Bearer primary-bearer" }),
        );
      }
    }),
  );
});
