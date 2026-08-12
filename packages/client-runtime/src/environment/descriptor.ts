import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "./endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

const DEFAULT_DESCRIPTOR_REQUEST_TIMEOUT_MS = 10_000;

export const fetchEnvironmentDescriptor = Effect.fn(
  "clientRuntime.environment.fetchEnvironmentDescriptor",
)(function* (input: { readonly httpBaseUrl: string; readonly timeoutMs?: number }) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/.well-known/t3/environment"),
    input.timeoutMs ?? DEFAULT_DESCRIPTOR_REQUEST_TIMEOUT_MS,
    client.metadata.descriptor(),
  );
});
