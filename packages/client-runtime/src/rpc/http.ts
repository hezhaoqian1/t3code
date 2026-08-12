import {
  EnvironmentHttpCommonError,
  LocalEnvironmentHttpApi,
  type EnvironmentAuthInvalidError,
  type EnvironmentInternalError,
  type EnvironmentRequestInvalidError,
  type EnvironmentResourceNotFoundError,
  type EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import { httpHeaderRedactionLayer } from "@t3tools/shared/httpObservability";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export class LocalEnvironmentRequestFetchError extends Data.TaggedError(
  "LocalEnvironmentRequestFetchError",
)<{ readonly message: string; readonly cause: unknown }> {}

export class LocalEnvironmentRequestInvalidJsonError extends Data.TaggedError(
  "LocalEnvironmentRequestInvalidJsonError",
)<{ readonly message: string; readonly cause: unknown }> {}

export class LocalEnvironmentRequestUndeclaredStatusError extends Data.TaggedError(
  "LocalEnvironmentRequestUndeclaredStatusError",
)<{ readonly message: string; readonly status: number; readonly requestUrl: string }> {
  constructor(requestUrl: string, status: number) {
    super({
      message: `Local environment endpoint ${requestUrl} returned undeclared status ${status}.`,
      requestUrl,
      status,
    });
  }
}

export class LocalEnvironmentRequestTimeoutError extends Data.TaggedError(
  "LocalEnvironmentRequestTimeoutError",
)<{ readonly message: string; readonly requestUrl: string; readonly timeoutMs: number }> {
  constructor(requestUrl: string, timeoutMs: number) {
    super({
      message: `Local environment endpoint ${requestUrl} timed out after ${timeoutMs}ms.`,
      requestUrl,
      timeoutMs,
    });
  }
}

export type LocalEnvironmentRequestError =
  | EnvironmentRequestInvalidError
  | EnvironmentAuthInvalidError
  | EnvironmentScopeRequiredError
  | EnvironmentResourceNotFoundError
  | EnvironmentInternalError
  | LocalEnvironmentRequestFetchError
  | LocalEnvironmentRequestInvalidJsonError
  | LocalEnvironmentRequestUndeclaredStatusError
  | LocalEnvironmentRequestTimeoutError;

export const localHttpClientLayer = (
  fetchFn: typeof globalThis.fetch,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.merge(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    httpHeaderRedactionLayer,
  );

const apiBaseUrl = (httpBaseUrl: string): string => {
  const url = new URL(httpBaseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const makeEnvironmentHttpApiClient = (httpBaseUrl: string) =>
  HttpApiClient.make(LocalEnvironmentHttpApi, { baseUrl: apiBaseUrl(httpBaseUrl) });

const failLocalRequest = (
  requestUrl: string,
  cause: unknown,
): Effect.Effect<never, LocalEnvironmentRequestError> => {
  if (cause instanceof LocalEnvironmentRequestTimeoutError || isEnvironmentHttpCommonError(cause)) {
    return Effect.fail(cause);
  }
  if (Schema.isSchemaError(cause)) {
    return Effect.fail(
      new LocalEnvironmentRequestInvalidJsonError({
        message: `Local environment endpoint returned an invalid response from ${requestUrl}.`,
        cause,
      }),
    );
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    return cause.response.status < 200 || cause.response.status >= 300
      ? Effect.fail(
          new LocalEnvironmentRequestUndeclaredStatusError(requestUrl, cause.response.status),
        )
      : Effect.fail(
          new LocalEnvironmentRequestInvalidJsonError({
            message: `Local environment endpoint returned an invalid response from ${requestUrl}.`,
            cause,
          }),
        );
  }
  return Effect.fail(
    new LocalEnvironmentRequestFetchError({
      message: `Failed to fetch local environment endpoint ${requestUrl} (${String(cause)}).`,
      cause,
    }),
  );
};

export const executeEnvironmentHttpRequest = <A, E, R>(
  requestUrl: string,
  timeoutMs: number,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, LocalEnvironmentRequestError, R> =>
  request.pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new LocalEnvironmentRequestTimeoutError(requestUrl, timeoutMs)),
        onSome: Effect.succeed,
      }),
    ),
    Effect.catch((cause) => failLocalRequest(requestUrl, cause)),
  );
