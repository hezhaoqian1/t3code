// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeStream from "@effect/platform-node/NodeStream";
import {
  FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES,
  FdRuntimeCredentialCommand,
  type FdRuntimeCredentialCommand as FdRuntimeCredentialCommandValue,
  type FdServerRuntimeCredentialProjection,
} from "@t3tools/contracts/fd/runtime-credentials";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";

export class FdRuntimeCredentialProtocolError extends Error {
  readonly kind: "malformed" | "oversized" | "stream";

  constructor(kind: "malformed" | "oversized" | "stream") {
    super(`FD runtime credential channel ${kind}`);
    this.name = "FdRuntimeCredentialProtocolError";
    this.kind = kind;
  }
}

export interface FdRuntimeCredentialSnapshot {
  readonly generation: number;
  readonly credentials: Option.Option<FdServerRuntimeCredentialProjection>;
}

export class FdRuntimeCredentialStore extends Context.Service<
  FdRuntimeCredentialStore,
  {
    readonly current: Effect.Effect<Option.Option<FdServerRuntimeCredentialProjection>>;
    readonly changes: Stream.Stream<Option.Option<FdServerRuntimeCredentialProjection>>;
    readonly subscribe: Effect.Effect<
      {
        readonly current: Option.Option<FdServerRuntimeCredentialProjection>;
        readonly changes: Stream.Stream<Option.Option<FdServerRuntimeCredentialProjection>>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/fd/FdRuntimeCredentialStore") {}

export class FdCredentialLineDecoder {
  readonly #parts: Buffer[] = [];
  #lineBytes = 0;
  readonly #utf8 = new TextDecoder("utf-8", { fatal: true });

  push(chunk: Uint8Array): readonly string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.byteLength : newline;
      const segmentBytes = end - offset;
      if (this.#lineBytes + segmentBytes > FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES) {
        this.#reset();
        throw new FdRuntimeCredentialProtocolError("oversized");
      }
      if (segmentBytes > 0) {
        this.#parts.push(Buffer.from(chunk.subarray(offset, end)));
        this.#lineBytes += segmentBytes;
      }
      if (newline < 0) break;
      lines.push(this.#finishLine());
      offset = newline + 1;
    }
    return lines;
  }

  close(): void {
    if (this.#lineBytes > 0) {
      this.#reset();
      throw new FdRuntimeCredentialProtocolError("malformed");
    }
    this.#reset();
  }

  #finishLine(): string {
    if (this.#lineBytes === 0) {
      this.#reset();
      throw new FdRuntimeCredentialProtocolError("malformed");
    }
    const bytes =
      this.#parts.length === 1 ? this.#parts[0]! : Buffer.concat(this.#parts, this.#lineBytes);
    try {
      const first = bytes[0];
      const last = bytes[bytes.byteLength - 1];
      if (isJsonOuterWhitespace(first) || isJsonOuterWhitespace(last)) {
        throw new FdRuntimeCredentialProtocolError("malformed");
      }
      return this.#utf8.decode(bytes);
    } catch (error) {
      if (error instanceof FdRuntimeCredentialProtocolError) throw error;
      throw new FdRuntimeCredentialProtocolError("malformed");
    } finally {
      this.#reset();
    }
  }

  #reset(): void {
    for (const part of this.#parts) part.fill(0);
    this.#parts.length = 0;
    this.#lineBytes = 0;
  }
}

function isJsonOuterWhitespace(value: number | undefined): boolean {
  return value === 0x20 || value === 0x09 || value === 0x0d || value === 0x0a;
}

const decodeCommand = Schema.decodeUnknownSync(FdRuntimeCredentialCommand);

export function decodeFdRuntimeCredentialLine(line: string): FdRuntimeCredentialCommandValue {
  if (Buffer.byteLength(line, "utf8") > FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES) {
    throw new FdRuntimeCredentialProtocolError("oversized");
  }
  try {
    return decodeCommand(JSON.parse(line));
  } catch {
    throw new FdRuntimeCredentialProtocolError("malformed");
  }
}

export function applyFdRuntimeCredentialCommand(
  current: FdRuntimeCredentialSnapshot,
  command: FdRuntimeCredentialCommandValue,
): FdRuntimeCredentialSnapshot {
  const generation = command.type === "set" ? command.credentials.generation : command.generation;
  if (generation <= current.generation) return current;
  return {
    generation,
    credentials: command.type === "set" ? Option.some(command.credentials) : Option.none(),
  };
}

export const makeStore = Effect.fn("fdRuntimeCredentialStore.makeStore")(function* () {
  const state = yield* Ref.make<FdRuntimeCredentialSnapshot>({
    generation: -1,
    credentials: Option.none(),
  });
  const changes = yield* PubSub.sliding<Option.Option<FdServerRuntimeCredentialProjection>>(8);
  const mutation = yield* Semaphore.make(1);

  const apply = (command: FdRuntimeCredentialCommandValue) =>
    mutation.withPermits(1)(
      Ref.modify(state, (current) => {
        const next = applyFdRuntimeCredentialCommand(current, command);
        return [
          next === current ? Option.none<typeof next.credentials>() : Option.some(next.credentials),
          next,
        ];
      }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (credentials) => PubSub.publish(changes, credentials).pipe(Effect.asVoid),
          }),
        ),
      ),
    );

  const clear = mutation.withPermits(1)(
    Ref.modify(state, (current) => {
      const changed = Option.isSome(current.credentials);
      const next = { generation: current.generation + 1, credentials: Option.none() };
      return [changed, next] as const;
    }).pipe(
      Effect.flatMap((changed) =>
        changed ? PubSub.publish(changes, Option.none()).pipe(Effect.asVoid) : Effect.void,
      ),
    ),
  );

  const service = FdRuntimeCredentialStore.of({
    current: Ref.get(state).pipe(Effect.map((snapshot) => snapshot.credentials)),
    changes: Stream.fromPubSub(changes),
    subscribe: mutation.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const current = (yield* Ref.get(state)).credentials;
        return { current, changes: Stream.fromSubscription(subscription) };
      }),
    ),
  });

  return { service, apply, clear } as const;
});

const consumeChunks = Effect.fn("fdRuntimeCredentialStore.consumeChunks")(function* (
  chunks: Stream.Stream<Uint8Array, FdRuntimeCredentialProtocolError>,
  apply: (command: FdRuntimeCredentialCommandValue) => Effect.Effect<void>,
) {
  const decoder = new FdCredentialLineDecoder();
  yield* chunks.pipe(
    Stream.runForEach((chunk) =>
      Effect.try({
        try: () => decoder.push(chunk),
        catch: (error) =>
          error instanceof FdRuntimeCredentialProtocolError
            ? error
            : new FdRuntimeCredentialProtocolError("malformed"),
      }).pipe(
        Effect.flatMap((lines) =>
          Effect.forEach(
            lines,
            (line) =>
              Effect.try({
                try: () => decodeFdRuntimeCredentialLine(line),
                catch: (error) =>
                  error instanceof FdRuntimeCredentialProtocolError
                    ? error
                    : new FdRuntimeCredentialProtocolError("malformed"),
              }).pipe(Effect.flatMap(apply)),
            { discard: true },
          ),
        ),
      ),
    ),
  );
  yield* Effect.try({
    try: () => decoder.close(),
    catch: (error) =>
      error instanceof FdRuntimeCredentialProtocolError
        ? error
        : new FdRuntimeCredentialProtocolError("malformed"),
  });
});

export const runFdRuntimeCredentialChannel = Effect.fn("fdRuntimeCredentialStore.runChannel")(
  function* (
    chunks: Stream.Stream<Uint8Array, FdRuntimeCredentialProtocolError>,
    apply: (command: FdRuntimeCredentialCommandValue) => Effect.Effect<void>,
    clear: Effect.Effect<void>,
  ) {
    yield* consumeChunks(chunks, apply).pipe(
      Effect.catch(() => Effect.void),
      Effect.ensuring(clear),
    );
  },
);

export const make = Effect.fn("fdRuntimeCredentialStore.make")(function* () {
  const config = yield* ServerConfig;
  const store = yield* makeStore();
  const fd = config.fdRuntimeCredentialFd;
  if (fd !== undefined) {
    const readable = yield* Effect.acquireRelease(
      Effect.try({
        try: () => NodeFS.createReadStream("", { fd, autoClose: true }),
        catch: () => new FdRuntimeCredentialProtocolError("stream"),
      }),
      (stream) => Effect.sync(() => stream.destroy()),
    );
    const chunks = NodeStream.fromReadable<Uint8Array, FdRuntimeCredentialProtocolError>({
      evaluate: () => readable,
      closeOnDone: true,
      onError: () => new FdRuntimeCredentialProtocolError("stream"),
    });
    yield* runFdRuntimeCredentialChannel(chunks, store.apply, store.clear).pipe(Effect.forkScoped);
  }
  return store.service;
});

export const layer = Layer.effect(FdRuntimeCredentialStore, make());
export const layerTest = Layer.effect(
  FdRuntimeCredentialStore,
  makeStore().pipe(Effect.map((x) => x.service)),
);
