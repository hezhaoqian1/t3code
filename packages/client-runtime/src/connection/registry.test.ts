import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { PrimaryConnectionRegistration } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import { PrimaryConnectionTarget } from "./model.ts";
import type { PreparedConnection } from "./model.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const registration = new PrimaryConnectionRegistration({
  target: new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("primary"),
    label: "Desktop",
    httpBaseUrl: "http://127.0.0.1:3777",
    wsBaseUrl: "ws://127.0.0.1:3777",
  }),
});

describe("EnvironmentRegistry platform reconciliation", () => {
  it.effect("reconciles exactly one optional primary registration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = Layer.mergeAll(
          Connectivity.layer({ status: Effect.succeed("offline"), changes: Stream.empty }),
          ConnectionWakeups.layer({ changes: Stream.empty }),
          Layer.succeed(
            ConnectionDriver.ConnectionDriver,
            ConnectionDriver.ConnectionDriver.of({
              connect: () => Effect.die("offline reconciliation must not contact the endpoint"),
            }),
          ),
        );
        const registry = yield* EnvironmentRegistry.make.pipe(Effect.provide(dependencies));

        yield* registry.reconcilePlatform(Option.some(registration));
        expect([...(yield* SubscriptionRef.get(registry.entries)).keys()]).toEqual(["primary"]);

        yield* registry.reconcilePlatform(Option.none());
        expect((yield* SubscriptionRef.get(registry.entries)).size).toBe(0);
      }),
    ),
  );

  it.effect(
    "closes the previous primary scope when the platform target is replaced or removed",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* Queue.unbounded<string>();
          const releases = yield* Ref.make(0);
          const dependencies = Layer.mergeAll(
            Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.empty }),
            ConnectionWakeups.layer({ changes: Stream.empty }),
            Layer.succeed(
              ConnectionDriver.ConnectionDriver,
              ConnectionDriver.ConnectionDriver.of({
                connect: (entry) =>
                  Effect.gen(function* () {
                    const prepared: PreparedConnection = {
                      environmentId: entry.target.environmentId,
                      label: entry.target.label,
                      httpBaseUrl: entry.target.httpBaseUrl,
                      socketUrl: `${entry.target.wsBaseUrl}/ws`,
                      target: entry.target,
                    };
                    const session = yield* Effect.acquireRelease(
                      Effect.succeed({
                        client: {} as WsRpcProtocolClient,
                        initialConfig: Effect.never,
                        ready: Effect.void,
                        probe: Effect.void,
                        closed: Effect.never,
                      } satisfies RpcSession),
                      () => Ref.update(releases, (count) => count + 1),
                    );
                    yield* Queue.offer(opened, entry.target.environmentId);
                    return { prepared, session };
                  }),
              }),
            ),
          );
          const registry = yield* EnvironmentRegistry.make.pipe(Effect.provide(dependencies));
          const replacement = new PrimaryConnectionRegistration({
            target: new PrimaryConnectionTarget({
              environmentId: EnvironmentId.make("replacement"),
              label: "Replacement",
              httpBaseUrl: "http://127.0.0.1:3888",
              wsBaseUrl: "ws://127.0.0.1:3888",
            }),
          });

          yield* registry.reconcilePlatform(Option.some(registration));
          expect(yield* Queue.take(opened)).toBe("primary");
          yield* registry.reconcilePlatform(Option.some(replacement));
          expect(yield* Queue.take(opened)).toBe("replacement");
          expect(yield* Ref.get(releases)).toBe(1);
          expect([...(yield* SubscriptionRef.get(registry.entries)).keys()]).toEqual([
            "replacement",
          ]);

          yield* registry.reconcilePlatform(Option.none());
          expect(yield* Ref.get(releases)).toBe(2);
          expect((yield* SubscriptionRef.get(registry.entries)).size).toBe(0);
        }),
      ),
  );
});
