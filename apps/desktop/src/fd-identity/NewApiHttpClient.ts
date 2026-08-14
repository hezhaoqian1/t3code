const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface NewApiResponse {
  body: { success: boolean; code?: string; message?: string; data?: unknown };
  setCookies: readonly string[];
}

export class NewApiHttpError extends Error {
  readonly kind: "unauthorized" | "unavailable";
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(kind: "unauthorized" | "unavailable", code?: string, status?: number) {
    super("New API request failed");
    this.name = "NewApiHttpError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface NewApiHttpOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class NewApiHttpClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: NewApiHttpOptions) {
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new Error("New API timeout must be a positive safe integer");
    }
  }

  get origin(): string {
    return this.#baseUrl.origin;
  }

  async request(path: string, init: RequestInit = {}): Promise<NewApiResponse> {
    try {
      const url = new URL(path, this.#baseUrl);
      if (url.origin !== this.#baseUrl.origin) throw new NewApiHttpError("unavailable");
      const response = await this.#fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "FD-Enterprise-Desktop/1",
          ...init.headers,
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const body = parseApiResponse(await readBoundedJson(response));
      if (!response.ok) {
        throw new NewApiHttpError(
          response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable",
          body.code,
          response.status,
        );
      }
      return { body, setCookies: responseCookies(response.headers) };
    } catch (error) {
      if (error instanceof NewApiHttpError) throw error;
      throw new NewApiHttpError("unavailable");
    }
  }
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("New API base URL is invalid");
  }
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("New API must use HTTPS or loopback HTTP");
  }
  return new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response is too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
}

function parseApiResponse(value: unknown): NewApiResponse["body"] {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof Reflect.get(value, "success") !== "boolean"
  ) {
    throw new Error("New API response is invalid");
  }
  const message = Reflect.get(value, "message");
  const code = Reflect.get(value, "code");
  if (code !== undefined && (typeof code !== "string" || code.length < 1 || code.length > 128)) {
    throw new Error("New API response code is invalid");
  }
  if (message !== undefined && (typeof message !== "string" || message.length > 2_000)) {
    throw new Error("New API response message is invalid");
  }
  return {
    success: Reflect.get(value, "success") as boolean,
    ...(code === undefined ? {} : { code: code as string }),
    ...(message === undefined ? {} : { message: message as string }),
    ...(Reflect.has(value, "data") ? { data: Reflect.get(value, "data") } : {}),
  };
}

function responseCookies(headers: Headers): readonly string[] {
  const cookieHeaders = headers as Headers & { getSetCookie?: () => string[] };
  return cookieHeaders.getSetCookie?.() ?? [headers.get("set-cookie")].filter(isString);
}

function isString(value: string | null): value is string {
  return value !== null;
}
