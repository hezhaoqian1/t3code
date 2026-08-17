// @effect-diagnostics nodeBuiltinImport:off
import { pathToFileURL } from "node:url";

import {
  FdServerRuntimeCredentialProjection,
  type FdServerRuntimeCredentialProjection as FdCredentials,
} from "@t3tools/contracts/fd/runtime-credentials";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { FdResponsesClient } from "./FdResponsesClient.ts";
import {
  FD_RESPONSES_MODEL,
  FdResponsesError,
  appendFdResponsesFunctionOutputs,
  type FdResponsesEvent,
  type FdResponsesOutputItem,
} from "./FdResponsesProtocol.ts";

const MAX_PROBE_STDIN_BYTES = 64 * 1_024;
const PROBE_TOOL_NAME = "fd_protocol_probe";

export interface FdResponsesProbeMatrix {
  readonly status: "PASS";
  readonly exactModelIdentity: true;
  readonly textStreaming: true;
  readonly usage: true;
  readonly reasoningSummary: "emitted" | "not_emitted";
  readonly deterministicFunctionCall: true;
  readonly statelessFunctionOutputRound: true;
  readonly cancellation: true;
}

interface ProbeClient {
  stream(request: Parameters<FdResponsesClient["stream"]>[0]): AsyncIterable<FdResponsesEvent>;
}

export async function runFdResponsesProbe(client: ProbeClient): Promise<FdResponsesProbeMatrix> {
  const textEvents = await collectEvents(
    client.stream({
      model: FD_RESPONSES_MODEL,
      round: 1,
      input: [
        {
          role: "user",
          content: "Reply briefly that the FD Responses protocol is available.",
        },
      ],
      reasoningEffort: "high",
      timeoutMs: 60_000,
    }),
  );
  const textStreaming = textEvents.some(
    (event) => event.type === "text-delta" && event.text.length > 0,
  );
  const usage = textEvents.some(
    (event) =>
      event.type === "usage" &&
      typeof event.inputTokens === "number" &&
      typeof event.outputTokens === "number",
  );
  assertCompleted(textEvents);
  assertExactModel(textEvents);
  if (!textStreaming || !usage) throw new FdResponsesError("malformed_response");

  const toolInput = [
    {
      role: "user" as const,
      content: "Call fd_protocol_probe exactly once with value 7. After its output, reply briefly.",
    },
  ];
  const tools = [
    {
      name: PROBE_TOOL_NAME,
      description: "Returns a deterministic bounded result for protocol verification.",
      parameters: {
        type: "object" as const,
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  ];
  const firstToolRound = await collectEvents(
    client.stream({
      model: FD_RESPONSES_MODEL,
      round: 1,
      input: toolInput,
      tools,
      toolChoice: PROBE_TOOL_NAME,
      reasoningEffort: "none",
      timeoutMs: 60_000,
    }),
  );
  assertCompleted(firstToolRound);
  assertExactModel(firstToolRound);
  const call = firstToolRound.find(
    (event) =>
      event.type === "function-call" && event.name === PROBE_TOOL_NAME && event.arguments.valid,
  );
  if (!call || call.type !== "function-call") {
    throw new FdResponsesError("malformed_response");
  }
  const outputItems = firstToolRound.flatMap((event) =>
    event.type === "output-item" ? [event.item] : [],
  );
  const secondInput = appendFdResponsesFunctionOutputs(toolInput, outputItems, [
    { callId: call.callId, output: '{"ok":true,"value":7}' },
  ]);
  const secondToolRound = await collectEvents(
    client.stream({
      model: FD_RESPONSES_MODEL,
      round: 2,
      input: secondInput,
      tools,
      reasoningEffort: "none",
      timeoutMs: 60_000,
    }),
  );
  assertCompleted(secondToolRound);
  assertExactModel(secondToolRound);
  if (!secondToolRound.some((event) => event.type === "text-delta" && event.text.length > 0)) {
    throw new FdResponsesError("malformed_response");
  }

  const cancellation = new AbortController();
  let cancelled = false;
  try {
    for await (const event of client.stream({
      model: FD_RESPONSES_MODEL,
      round: 1,
      input: [
        {
          role: "user",
          content:
            "Produce a long protocol-test response that can be cancelled after streaming starts.",
        },
      ],
      reasoningEffort: "none",
      timeoutMs: 30_000,
      signal: cancellation.signal,
    })) {
      if (event.type === "response-metadata") {
        if (event.model !== FD_RESPONSES_MODEL) throw new FdResponsesError("malformed_response");
        cancellation.abort();
      }
    }
  } catch (error) {
    cancelled = error instanceof FdResponsesError && error.kind === "cancelled";
  }
  if (!cancelled) throw new FdResponsesError("malformed_response");

  return {
    status: "PASS",
    exactModelIdentity: true,
    textStreaming: true,
    usage: true,
    reasoningSummary: textEvents.some((event) => event.type === "reasoning-delta")
      ? "emitted"
      : "not_emitted",
    deterministicFunctionCall: true,
    statelessFunctionOutputRound: true,
    cancellation: true,
  };
}

export async function readProbeCredentials(
  input: AsyncIterable<Uint8Array | string>,
): Promise<FdCredentials> {
  const chunks: Buffer[] = [];
  let total = 0;
  let combined: Buffer | undefined;
  try {
    for await (const chunk of input) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > MAX_PROBE_STDIN_BYTES) {
        bytes.fill(0);
        throw new FdResponsesError("invalid_request");
      }
      chunks.push(bytes);
    }
    if (total === 0) throw new FdResponsesError("credentials_unavailable");
    combined = Buffer.concat(chunks, total);
    const decoded: unknown = JSON.parse(combined.toString("utf8"));
    return Schema.decodeUnknownSync(FdServerRuntimeCredentialProjection)(decoded);
  } catch (error) {
    if (error instanceof FdResponsesError) throw error;
    throw new FdResponsesError("invalid_request");
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    combined?.fill(0);
  }
}

async function collectEvents(stream: AsyncIterable<FdResponsesEvent>): Promise<FdResponsesEvent[]> {
  const events: FdResponsesEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function assertCompleted(events: ReadonlyArray<FdResponsesEvent>): void {
  if (!events.some((event) => event.type === "completed")) {
    throw new FdResponsesError("premature_close");
  }
}

function assertExactModel(events: ReadonlyArray<FdResponsesEvent>): void {
  const metadata = events.filter((event) => event.type === "response-metadata");
  if (metadata.length === 0 || metadata.some((event) => event.model !== FD_RESPONSES_MODEL)) {
    throw new FdResponsesError("malformed_response");
  }
}

function clearCredentialStrings(credentials: FdCredentials): void {
  const mutable = credentials as {
    runtimeApiKey: string;
    accessToken: string;
  };
  mutable.runtimeApiKey = "";
  mutable.accessToken = "";
}

async function main(): Promise<void> {
  let credentials: FdCredentials | undefined;
  try {
    credentials = await readProbeCredentials(process.stdin);
    const client = new FdResponsesClient({
      subscribe: Effect.succeed({ current: Option.some(credentials), changes: Stream.never }),
    });
    const matrix = await runFdResponsesProbe(client);
    process.stdout.write(`${JSON.stringify(matrix)}\n`);
  } catch (error) {
    const kind = error instanceof FdResponsesError ? error.kind : "probe_failed";
    process.stdout.write(`${JSON.stringify({ status: "FAIL", error: kind })}\n`);
    process.exitCode = 1;
  } finally {
    if (credentials) clearCredentialStrings(credentials);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
