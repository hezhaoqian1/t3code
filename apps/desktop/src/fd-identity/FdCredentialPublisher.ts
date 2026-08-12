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
import * as Stream from "effect/Stream";

const encodeCommand = Schema.encodeSync(Schema.fromJsonString(FdRuntimeCredentialCommand));
const textEncoder = new TextEncoder();

export function encodeFdRuntimeCredentialCommand(
  command: FdRuntimeCredentialCommandValue,
): Uint8Array {
  const encoded = textEncoder.encode(`${encodeCommand(command)}\n`);
  assertFdRuntimeCredentialCommandSize(encoded);
  return encoded;
}

export function assertFdRuntimeCredentialCommandSize(encoded: Uint8Array): void {
  if (encoded.byteLength > FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES) {
    encoded.fill(0);
    throw new Error("FD runtime credential command exceeds the protocol limit");
  }
}

export class FdCredentialPublisher extends Context.Service<
  FdCredentialPublisher,
  {
    readonly latest: Effect.Effect<Option.Option<FdRuntimeCredentialCommandValue>>;
    readonly encoded: Stream.Stream<Uint8Array>;
    readonly set: (credentials: FdServerRuntimeCredentialProjection) => Effect.Effect<void>;
    readonly clear: (reason: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/fd-identity/FdCredentialPublisher") {}

export const make = Effect.fn("fdCredentialPublisher.make")(function* () {
  const latest = yield* Ref.make(Option.none<FdRuntimeCredentialCommandValue>());
  const changes = yield* PubSub.sliding<FdRuntimeCredentialCommandValue>(8);
  const mutation = yield* Semaphore.make(1);

  const publish = (command: FdRuntimeCredentialCommandValue) =>
    mutation.withPermits(1)(
      Ref.set(latest, Option.some(command)).pipe(
        Effect.andThen(PubSub.publish(changes, command)),
        Effect.asVoid,
      ),
    );

  const set: FdCredentialPublisher["Service"]["set"] = (credentials) =>
    publish({ version: 1, type: "set", credentials });

  const clear: FdCredentialPublisher["Service"]["clear"] = (reason) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(latest);
        const generation = Option.match(current, {
          onNone: () => 1,
          onSome: (command) =>
            command.type === "set" ? command.credentials.generation + 1 : command.generation + 1,
        });
        const command: FdRuntimeCredentialCommandValue = {
          version: 1,
          type: "clear",
          generation,
          ...(reason.trim().length > 0 ? { reason: reason.trim().slice(0, 64) } : {}),
        };
        yield* Ref.set(latest, Option.some(command));
        yield* PubSub.publish(changes, command);
      }),
    );

  const commands = Stream.unwrap(
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const initial = yield* Ref.get(latest);
        return Stream.concat(
          Option.match(initial, { onNone: () => Stream.empty, onSome: Stream.make }),
          Stream.fromSubscription(subscription),
        );
      }),
    ),
  );

  return FdCredentialPublisher.of({
    latest: Ref.get(latest),
    encoded: commands.pipe(Stream.map(encodeFdRuntimeCredentialCommand)),
    set,
    clear,
  });
});

export const layer = Layer.effect(FdCredentialPublisher, make());

export const layerTest = (
  overrides: Partial<FdCredentialPublisher["Service"]> = {},
): Layer.Layer<FdCredentialPublisher> =>
  Layer.effect(
    FdCredentialPublisher,
    make().pipe(Effect.map((service) => FdCredentialPublisher.of({ ...service, ...overrides }))),
  );
