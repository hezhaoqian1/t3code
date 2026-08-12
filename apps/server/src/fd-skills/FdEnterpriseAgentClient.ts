// @effect-diagnostics globalDate:off
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import { FD_RESPONSES_MODEL } from "../fd-agent/FdResponsesProtocol.ts";

export const FD_ENTERPRISE_AGENT_PROTOCOL = "enterprise-agent-v1" as const;
export const FD_ENTERPRISE_AGENT_LIMITS = {
  maxCatalogBytes: 512 * 1024,
  maxStreamBytes: 4 * 1024 * 1024,
  maxEventBytes: 256 * 1024,
  maxMessageChars: 128 * 1024,
  maxSkills: 256,
  maxHistoryBytes: 1024 * 1024,
  maxHistoryMessages: 2_000,
  maxEventIdChars: 128,
} as const;

const DEFAULT_ENTERPRISE_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ENTERPRISE_STREAM_TIMEOUT_MS = 150_000;

export interface FdManagedSkillSummary {
  readonly id: number;
  readonly versionId: number;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly kind: string;
  readonly riskTier: string;
}

export interface FdSkillCatalogResponse {
  readonly skills: ReadonlyArray<FdManagedSkillSummary>;
  readonly modelCapabilities: Readonly<Record<string, { fdSkills: boolean; protocol?: string }>>;
}

export interface FdEnterpriseHistoryMessage {
  readonly id: number;
  readonly conversationId: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface FdEnterpriseHistory {
  readonly clientThreadId: string;
  readonly conversationId: number;
  readonly messages: ReadonlyArray<FdEnterpriseHistoryMessage>;
  readonly truncated: boolean;
}

export type FdEnterpriseAgentEvent =
  | {
      readonly type: "turn.started";
      readonly turnId: string;
      readonly conversationId: number;
      readonly model: string;
      readonly replayed?: boolean;
    }
  | {
      readonly type: "tool.started";
      readonly turnId: string;
      readonly callId: string;
      readonly tool: string;
      readonly toolClass: "capability" | "data_read";
      readonly label: string;
    }
  | {
      readonly type: "tool.completed";
      readonly turnId: string;
      readonly callId: string;
      readonly tool: string;
      readonly toolClass: "capability" | "data_read";
      readonly status: "succeeded" | "failed";
      readonly auditId?: string;
      readonly rowCount?: number;
      readonly truncated?: boolean;
      readonly retrying?: boolean;
    }
  | { readonly type: "assistant.reasoning"; readonly turnId: string; readonly delta: string }
  | { readonly type: "assistant.delta"; readonly turnId: string; readonly delta: string }
  | {
      readonly type: "turn.completed";
      readonly turnId: string;
      readonly message: {
        readonly id: number;
        readonly conversationId: number;
        readonly role: "assistant";
        readonly text: string;
        readonly createdAt: string;
      };
      readonly toolCalls: number;
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
      readonly replayed?: boolean;
    }
  | {
      readonly type: "turn.failed";
      readonly turnId: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly userMessagePersisted: boolean;
      readonly replayed?: boolean;
    };

export interface FdEnterpriseAgentTurnInput {
  readonly clientThreadId: string;
  readonly skillVersionId: number;
  readonly message: string;
  readonly modelInput?: string;
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}

export class FdEnterpriseAgentError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message = "Enterprise Agent request failed.") {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "FdEnterpriseAgentError";
  }
}

type CredentialReader = () => Promise<FdServerRuntimeCredentialProjection | undefined>;
type FdFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export interface FdEnterpriseAgentClientOptions {
  readonly credentials: CredentialReader;
  readonly fetch?: FdFetch;
  readonly requestTimeoutMs?: number;
  readonly streamTimeoutMs?: number;
}

export class FdEnterpriseAgentClient {
  readonly #credentials: CredentialReader;
  readonly #fetch: FdFetch;
  readonly #requestTimeoutMs: number;
  readonly #streamTimeoutMs: number;

  constructor(options: FdEnterpriseAgentClientOptions) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = positiveTimeout(
      options.requestTimeoutMs ?? DEFAULT_ENTERPRISE_REQUEST_TIMEOUT_MS,
    );
    this.#streamTimeoutMs = positiveTimeout(
      options.streamTimeoutMs ?? DEFAULT_ENTERPRISE_STREAM_TIMEOUT_MS,
    );
  }

  async getCatalog(signal?: AbortSignal): Promise<FdSkillCatalogResponse> {
    const credentials = await this.#requireCredentials();
    const response = await this.#fetch(new URL("/api/fd-skills/self", credentials.newApiOrigin), {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: timeoutSignal(signal, this.#requestTimeoutMs),
    });
    if (!response.ok) throw new FdEnterpriseAgentError("catalog_http_error", response.status);
    const bytes = await readBoundedResponse(
      response,
      FD_ENTERPRISE_AGENT_LIMITS.maxCatalogBytes,
      "catalog_too_large",
    );
    return parseFdSkillCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  }

  async *streamTurn(input: FdEnterpriseAgentTurnInput): AsyncGenerator<FdEnterpriseAgentEvent> {
    if (
      !isUuid(input.clientThreadId) ||
      !isIdempotencyKey(input.idempotencyKey) ||
      !Number.isSafeInteger(input.skillVersionId) ||
      input.skillVersionId <= 0 ||
      input.message.trim().length === 0 ||
      input.message.length > FD_ENTERPRISE_AGENT_LIMITS.maxMessageChars ||
      (input.modelInput?.length ?? 0) > FD_ENTERPRISE_AGENT_LIMITS.maxMessageChars
    ) {
      throw new FdEnterpriseAgentError("invalid_request", 0);
    }
    const credentials = await this.#requireCredentials();
    const response = await this.#fetch(new URL("/api/agent/turns", credentials.newApiOrigin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        client_thread_id: input.clientThreadId,
        model: FD_RESPONSES_MODEL,
        token_id: credentials.runtimeTokenId,
        skill_version_ids: [input.skillVersionId],
        message: input.message,
        ...(input.modelInput ? { model_input: input.modelInput } : {}),
        client: "fd_desktop",
      }),
      cache: "no-store",
      signal: timeoutSignal(input.signal, this.#streamTimeoutMs),
    });
    if (!response.ok) throw new FdEnterpriseAgentError("turn_http_error", response.status);
    if (
      !response.body ||
      !(response.headers.get("content-type") ?? "").includes("text/event-stream")
    ) {
      throw new FdEnterpriseAgentError("stream_unavailable", response.status);
    }
    yield* parseFdEnterpriseAgentStream(response.body, input.signal);
  }

  async getHistory(
    clientThreadId: string,
    signal?: AbortSignal,
  ): Promise<FdEnterpriseHistory | undefined> {
    if (!isUuid(clientThreadId)) {
      throw new FdEnterpriseAgentError("invalid_request", 0);
    }
    const credentials = await this.#requireCredentials();
    const response = await this.#fetch(
      new URL(
        `/api/agent/desktop/threads/${encodeURIComponent(clientThreadId)}/history`,
        credentials.newApiOrigin,
      ),
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
        cache: "no-store",
        signal: timeoutSignal(signal, this.#requestTimeoutMs),
      },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new FdEnterpriseAgentError("history_http_error", response.status);
    const bytes = await readBoundedResponse(
      response,
      FD_ENTERPRISE_AGENT_LIMITS.maxHistoryBytes,
      "history_too_large",
    );
    try {
      const history = parseFdEnterpriseHistory(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (history.clientThreadId !== clientThreadId) {
        throw new FdEnterpriseAgentError("invalid_history", 0);
      }
      return history;
    } catch (error) {
      if (error instanceof FdEnterpriseAgentError) throw error;
      throw new FdEnterpriseAgentError("invalid_history", 0);
    }
  }

  async #requireCredentials(): Promise<FdServerRuntimeCredentialProjection> {
    const credentials = await this.#credentials();
    const now = Math.floor(Date.now() / 1_000);
    if (!credentials || credentials.accessExpiresAt <= now || credentials.policy.expiresAt <= now) {
      throw new FdEnterpriseAgentError("credentials_unavailable", 401);
    }
    return credentials;
  }
}

export class FdSkillCatalog {
  #snapshot: FdSkillCatalogResponse = { skills: [], modelCapabilities: {} };
  readonly client: FdEnterpriseAgentClient;
  constructor(client: FdEnterpriseAgentClient) {
    this.client = client;
  }
  get snapshot(): FdSkillCatalogResponse {
    return this.#snapshot;
  }
  clear(): void {
    this.#snapshot = { skills: [], modelCapabilities: {} };
  }
  async refresh(signal?: AbortSignal): Promise<FdSkillCatalogResponse> {
    this.#snapshot = await this.client.getCatalog(signal);
    return this.#snapshot;
  }
  get authorized(): boolean {
    const capability = this.#snapshot.modelCapabilities[FD_RESPONSES_MODEL];
    return capability?.fdSkills === true && capability.protocol === FD_ENTERPRISE_AGENT_PROTOCOL;
  }
  findVersion(versionId: number): FdManagedSkillSummary | undefined {
    return this.authorized
      ? this.#snapshot.skills.find((skill) => skill.versionId === versionId)
      : undefined;
  }
}

export async function* parseFdEnterpriseAgentStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<FdEnterpriseAgentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let terminal = false;
  try {
    while (true) {
      if (signal?.aborted) throw new FdEnterpriseAgentError("cancelled", 0);
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > FD_ENTERPRISE_AGENT_LIMITS.maxStreamBytes) {
        await reader.cancel();
        throw new FdEnterpriseAgentError("stream_too_large", 0);
      }
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n|\r/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseEventBlock(block);
        if (event) {
          if (!terminal) yield event;
          terminal ||= event.type === "turn.completed" || event.type === "turn.failed";
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseEventBlock(buffer);
      if (event && !terminal) {
        yield event;
        terminal = event.type === "turn.completed" || event.type === "turn.failed";
      }
    }
  } catch (error) {
    if (error instanceof FdEnterpriseAgentError) throw error;
    throw new FdEnterpriseAgentError("invalid_stream", 0);
  } finally {
    reader.releaseLock();
  }
  if (!terminal) throw new FdEnterpriseAgentError("incomplete_stream", 0);
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  errorCode: string,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      await response.body?.cancel();
      throw new FdEnterpriseAgentError(errorCode, response.status);
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new FdEnterpriseAgentError(errorCode, response.status);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseEventBlock(block: string): FdEnterpriseAgentEvent | undefined {
  if (Buffer.byteLength(block, "utf8") > FD_ENTERPRISE_AGENT_LIMITS.maxEventBytes) {
    throw new FdEnterpriseAgentError("event_too_large", 0);
  }
  let type = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!type || data.length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  return mapEvent(type, record(value));
}

function mapEvent(type: string, data: Record<string, unknown>): FdEnterpriseAgentEvent {
  const turnId = eventTurnId(type, data.turn_id);
  if (type === "turn.started")
    return {
      type,
      turnId,
      conversationId: nonNegativeInteger(data.conversation_id),
      model: text(data.model),
      ...optionalBoolean("replayed", data.replayed),
    };
  if (type === "tool.started")
    return {
      type,
      turnId,
      callId: boundedId(data.call_id),
      tool: text(data.tool),
      toolClass: toolClass(data.tool_class),
      label: text(data.label),
    };
  if (type === "tool.completed") {
    if (data.status !== "succeeded" && data.status !== "failed")
      throw new FdEnterpriseAgentError("invalid_event", 0);
    return {
      type,
      turnId,
      callId: boundedId(data.call_id),
      tool: text(data.tool),
      toolClass: toolClass(data.tool_class),
      status: data.status,
      ...optionalBoundedId("auditId", data.audit_id),
      ...optionalInteger("rowCount", data.row_count),
      ...optionalBoolean("truncated", data.truncated),
      ...optionalBoolean("retrying", data.retrying),
    };
  }
  if (type === "assistant.reasoning" || type === "assistant.delta")
    return { type, turnId, delta: text(data.delta) };
  if (type === "turn.failed")
    return {
      type,
      turnId,
      code: text(data.code),
      message: text(data.message),
      retryable: data.retryable === true,
      userMessagePersisted: data.user_message_persisted === true,
      ...optionalBoolean("replayed", data.replayed),
    };
  if (type === "turn.completed") {
    const message = record(data.message);
    const usage = record(data.usage);
    if (message.role !== "assistant") throw new FdEnterpriseAgentError("invalid_event", 0);
    return {
      type,
      turnId,
      message: {
        id: integer(message.id),
        conversationId: nonNegativeInteger(message.conversation_id),
        role: "assistant",
        text: text(message.text),
        createdAt: unixTimestampIso(message.created_at),
      },
      toolCalls: nonNegativeInteger(data.tool_calls),
      usage: {
        inputTokens: optionalInt(usage.input_tokens),
        outputTokens: optionalInt(usage.output_tokens),
      },
      ...optionalBoolean("replayed", data.replayed),
    };
  }
  throw new FdEnterpriseAgentError("unsupported_event", 0);
}

export function parseFdSkillCatalog(value: unknown): FdSkillCatalogResponse {
  const envelope = record(value);
  const data = record(envelope.data ?? value);
  const rawSkills = Array.isArray(data.skills) ? data.skills : [];
  if (rawSkills.length > FD_ENTERPRISE_AGENT_LIMITS.maxSkills)
    throw new FdEnterpriseAgentError("catalog_too_large", 0);
  const skills = rawSkills.map((raw) => {
    const item = record(raw);
    return {
      id: integer(item.id),
      versionId: integer(item.version_id),
      name: text(item.name),
      displayName: text(item.display_name),
      description: typeof item.description === "string" ? item.description : "",
      kind: typeof item.kind === "string" ? item.kind : "",
      riskTier: typeof item.risk_tier === "string" ? item.risk_tier : "",
    };
  });
  const capabilities: Record<string, { fdSkills: boolean; protocol?: string }> = {};
  for (const [model, raw] of Object.entries(record(data.model_capabilities ?? {}))) {
    const item = record(raw);
    capabilities[model] = {
      fdSkills: item.fd_skills === true,
      ...(typeof item.fd_skill_protocol === "string" ? { protocol: item.fd_skill_protocol } : {}),
    };
  }
  return { skills, modelCapabilities: capabilities };
}

export function parseFdEnterpriseHistory(value: unknown): FdEnterpriseHistory {
  const envelope = record(value);
  const data = record(envelope.data ?? value);
  const clientThreadId = text(data.client_thread_id);
  if (!isUuid(clientThreadId)) throw new FdEnterpriseAgentError("invalid_history", 0);
  const conversationId = nonNegativeInteger(data.conversation_id);
  if (!Array.isArray(data.messages)) {
    throw new FdEnterpriseAgentError("invalid_history", 0);
  }
  const rawMessages = data.messages;
  if (rawMessages.length > FD_ENTERPRISE_AGENT_LIMITS.maxHistoryMessages) {
    throw new FdEnterpriseAgentError("history_too_large", 0);
  }
  let textBytes = 0;
  const messages = rawMessages.map((raw) => {
    const item = record(raw);
    if (item.role !== "user" && item.role !== "assistant") {
      throw new FdEnterpriseAgentError("invalid_history", 0);
    }
    const message = {
      id: integer(item.id),
      conversationId: nonNegativeInteger(item.conversation_id),
      role: item.role,
      text: text(item.text),
      createdAt: unixTimestampIso(item.created_at),
    } as FdEnterpriseHistoryMessage;
    if (message.conversationId !== conversationId) {
      throw new FdEnterpriseAgentError("invalid_history", 0);
    }
    textBytes += Buffer.byteLength(message.text, "utf8");
    if (textBytes > FD_ENTERPRISE_AGENT_LIMITS.maxHistoryBytes) {
      throw new FdEnterpriseAgentError("history_too_large", 0);
    }
    return message;
  });
  return {
    clientThreadId,
    conversationId,
    messages,
    truncated: data.truncated === true,
  };
}

function positiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Enterprise Agent timeout must be a positive safe integer");
  }
  return value;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FdEnterpriseAgentError("invalid_event", 0);
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new FdEnterpriseAgentError("invalid_event", 0);
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new FdEnterpriseAgentError("invalid_event", 0);
  return value;
}
function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  return value;
}
function unixTimestampIso(value: unknown): string {
  const seconds = integer(value);
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  return date.toISOString();
}
function optionalInt(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function optionalBoundedId<K extends string>(key: K, value: unknown): { [P in K]?: string } {
  if (value === undefined || value === null || value === "") return {};
  return { [key]: boundedId(value) } as { [P in K]?: string };
}
function optionalInteger<K extends string>(key: K, value: unknown): { [P in K]?: number } {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? ({ [key]: value } as { [P in K]?: number })
    : {};
}
function optionalBoolean<K extends string>(key: K, value: unknown): { [P in K]?: boolean } {
  return typeof value === "boolean" ? ({ [key]: value } as { [P in K]?: boolean }) : {};
}
function toolClass(value: unknown): "capability" | "data_read" {
  if (value !== "capability" && value !== "data_read") {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  return value;
}
function boundedId(value: unknown): string {
  const id = text(value);
  if (id.length > FD_ENTERPRISE_AGENT_LIMITS.maxEventIdChars) {
    throw new FdEnterpriseAgentError("invalid_event", 0);
  }
  return id;
}
function eventTurnId(type: string, value: unknown): string {
  const id = boundedId(value);
  if (isUuid(id) || (type === "turn.failed" && isIdempotencyKey(id))) return id;
  throw new FdEnterpriseAgentError("invalid_event", 0);
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
