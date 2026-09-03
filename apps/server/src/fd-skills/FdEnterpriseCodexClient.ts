import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import * as Schema from "effect/Schema";

const FD_ENTERPRISE_CODEX_PROTOCOL = "fd-codex-runtime-v1" as const;
const FD_ENTERPRISE_CODEX_MAX_RESPONSE_BYTES = 512 * 1024;
const FD_ENTERPRISE_CODEX_MAX_ARGUMENT_BYTES = 128 * 1024;
const FD_ENTERPRISE_CODEX_TIMEOUT_MS = 30_000;

const ApiEnvelopeSchema = Schema.Struct({
  success: Schema.Boolean,
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});

const RuntimeToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: Schema.Record(Schema.String, Schema.Unknown),
});

const RuntimeReferenceSchema = Schema.Struct({
  title: Schema.String,
  source: Schema.String,
  content: Schema.String,
});

const RuntimeContextSchema = Schema.Struct({
  protocol: Schema.Literal(FD_ENTERPRISE_CODEX_PROTOCOL),
  release_digest: Schema.String,
  skill: Schema.Struct({
    version_id: Schema.Number,
    version: Schema.String,
    name: Schema.String,
    display_name: Schema.String,
    kind: Schema.String,
    risk_tier: Schema.String,
  }),
  developer_instructions: Schema.String,
  references: Schema.Array(RuntimeReferenceSchema),
  tools: Schema.Array(RuntimeToolSchema),
});

const ToolCallResultSchema = Schema.Struct({
  tool_name: Schema.String,
  audit_id: Schema.String,
  content: Schema.Unknown,
  row_count: Schema.optional(Schema.Number),
  truncated: Schema.optional(Schema.Boolean),
});

const decodeEnvelope = Schema.decodeUnknownSync(ApiEnvelopeSchema);
const decodeRuntimeContext = Schema.decodeUnknownSync(RuntimeContextSchema);
const decodeToolCallResult = Schema.decodeUnknownSync(ToolCallResultSchema);

export type FdEnterpriseCodexRuntimeContext = typeof RuntimeContextSchema.Type;
export type FdEnterpriseCodexToolCallResult = typeof ToolCallResultSchema.Type;

export interface FdEnterpriseCodexToolCallInput {
  readonly skillVersionId: number;
  readonly releaseDigest: string;
  readonly clientThreadId: string;
  readonly providerThreadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly signal?: AbortSignal;
}

export class FdEnterpriseCodexError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message = "FD enterprise Codex request failed.") {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "FdEnterpriseCodexError";
  }
}

type CredentialReader = () => Promise<FdServerRuntimeCredentialProjection | undefined>;
type FdFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export class FdEnterpriseCodexClient {
  readonly #credentials: CredentialReader;
  readonly #fetch: FdFetch;

  constructor(options: { readonly credentials: CredentialReader; readonly fetch?: FdFetch }) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
  }

  async getRuntimeContext(input: {
    readonly skillVersionId: number;
    readonly clientThreadId: string;
    readonly signal?: AbortSignal;
  }): Promise<FdEnterpriseCodexRuntimeContext> {
    assertPositiveInteger(input.skillVersionId);
    assertIdentifier(input.clientThreadId, 64);
    const data = await this.#post(
      "/api/fd-skills/desktop/runtime-context",
      { skill_version_id: input.skillVersionId, client_thread_id: input.clientThreadId },
      input.signal,
    );
    const runtimeContext = decodeRuntimeContext(data);
    if (
      runtimeContext.skill.version_id !== input.skillVersionId ||
      !/^[a-f0-9]{64}$/.test(runtimeContext.release_digest) ||
      runtimeContext.developer_instructions.length === 0 ||
      runtimeContext.developer_instructions.length > FD_ENTERPRISE_CODEX_MAX_RESPONSE_BYTES
    ) {
      throw new FdEnterpriseCodexError("invalid_runtime_context", 0);
    }
    return runtimeContext;
  }

  async executeToolCall(
    input: FdEnterpriseCodexToolCallInput,
  ): Promise<FdEnterpriseCodexToolCallResult> {
    assertPositiveInteger(input.skillVersionId);
    assertIdentifier(input.releaseDigest, 64);
    assertIdentifier(input.clientThreadId, 64);
    assertIdentifier(input.providerThreadId, 191);
    assertIdentifier(input.turnId, 36);
    assertIdentifier(input.callId, 191);
    assertIdentifier(input.tool, 96);
    const encodedArguments = JSON.stringify(input.arguments);
    if (Buffer.byteLength(encodedArguments, "utf8") > FD_ENTERPRISE_CODEX_MAX_ARGUMENT_BYTES) {
      throw new FdEnterpriseCodexError("arguments_too_large", 0);
    }
    const data = await this.#post(
      "/api/fd-skills/desktop/tool-calls",
      {
        skill_version_id: input.skillVersionId,
        release_digest: input.releaseDigest,
        client_thread_id: input.clientThreadId,
        provider_thread_id: input.providerThreadId,
        turn_id: input.turnId,
        call_id: input.callId,
        tool: input.tool,
        arguments: input.arguments,
      },
      input.signal,
    );
    const result = decodeToolCallResult(data);
    if (result.tool_name !== input.tool || !result.audit_id) {
      throw new FdEnterpriseCodexError("invalid_tool_result", 0);
    }
    return result;
  }

  async #post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const credentials = await this.#credentials();
    if (!credentials) throw new FdEnterpriseCodexError("credentials_unavailable", 401);
    const response = await this.#fetch(new URL(path, credentials.newApiOrigin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: timeoutSignal(signal),
    });
    const bytes = await readBoundedResponse(response);
    let envelope: typeof ApiEnvelopeSchema.Type;
    try {
      envelope = decodeEnvelope(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new FdEnterpriseCodexError("invalid_response", response.status);
    }
    if (!response.ok || !envelope.success) {
      throw new FdEnterpriseCodexError(
        fdEnterpriseToolFailureCode(envelope.code, response.ok ? "request_rejected" : "http_error"),
        response.status,
        envelope.message || "FD enterprise Codex request was rejected.",
      );
    }
    return envelope.data;
  }
}

function fdEnterpriseToolFailureCode(code: string | undefined, fallback: string): string {
  switch (code) {
    case "query_timed_out":
    case "connector_query_failed":
    case "tool_execution_failed":
      return code;
    default:
      return fallback;
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FdEnterpriseCodexError("invalid_request", 0);
  }
}

function assertIdentifier(value: string, maxLength: number): void {
  if (!value || value.trim() !== value || value.length > maxLength) {
    throw new FdEnterpriseCodexError("invalid_request", 0);
  }
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new FdEnterpriseCodexError("empty_response", response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > FD_ENTERPRISE_CODEX_MAX_RESPONSE_BYTES) {
        throw new FdEnterpriseCodexError("response_too_large", response.status);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(FD_ENTERPRISE_CODEX_TIMEOUT_MS)])
    : AbortSignal.timeout(FD_ENTERPRISE_CODEX_TIMEOUT_MS);
}
