// @effect-diagnostics nodeBuiltinImport:off
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { FdRuntimeCredentialStore, makeStore } from "../fd/FdRuntimeCredentialStore.ts";
import { makeFdCodexAdapter } from "./FdCodexAdapter.ts";
import { FD_CODEX_MODEL } from "./FdManagedCodexHome.ts";

const shouldRun = process.env.FD_RUN_REAL_APP_SERVER === "1";
const instanceId = ProviderInstanceId.make("fd-deepseek");

describe.skipIf(!shouldRun)("FD Codex App Server integration", () => {
  it("streams DeepSeek, executes a structured local Skill, and resumes the conversation", async () => {
    const binaryPath = requiredEnvironment("FD_CODEX_BINARY");
    const runtimeApiKey = requiredEnvironment("FD_NEW_API_KEY");
    if (!isAbsolute(binaryPath)) throw new Error("FD_CODEX_BINARY must be absolute");

    const root = await mkdtemp(join(tmpdir(), "fd-t3-codex-app-server-"));
    const projectRoot = join(root, "project");
    const skillRoot = join(projectRoot, ".agents", "skills", "fd-proof");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: fd-proof",
        "description: Prove structured local Skill execution.",
        "---",
        "When invoked, reply with exactly FD_LOCAL_SKILL_OK and nothing else.",
        "",
      ].join("\n"),
    );

    const credentials: FdServerRuntimeCredentialProjection = {
      userId: 1,
      runtimeTokenId: 1,
      newApiOrigin: process.env.FD_NEW_API_ORIGIN ?? "http://127.0.0.1:3001",
      runtimeApiKey,
      accessToken: "integration-access-token-must-not-enter-codex",
      accessExpiresAt: 4_102_444_800,
      policy: {
        version: 1,
        capability: "general_assistant",
        model: FD_CODEX_MODEL,
        expiresAt: 4_102_444_800,
      },
      generation: 1,
    };
    const serverLayer = ServerConfig.layerTest(projectRoot, root).pipe(
      Layer.provideMerge(NodeServices.layer),
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* makeStore();
            yield* store.apply({ version: 1, type: "set", credentials });
            const adapter = yield* makeFdCodexAdapter({ instanceId, binaryPath }).pipe(
              Effect.provideService(FdRuntimeCredentialStore, store.service),
            );
            const events: ProviderRuntimeEvent[] = [];
            const receipts = yield* Queue.unbounded<ProviderRuntimeEvent>();
            yield* Stream.runForEach(adapter.streamEvents, (event) =>
              Effect.sync(() => events.push(event)).pipe(
                Effect.andThen(Queue.offer(receipts, event)),
              ),
            ).pipe(Effect.forkScoped);

            const threadId = ThreadId.make("fd-real-codex-thread");
            const firstSession = yield* adapter.startSession({
              threadId,
              cwd: projectRoot,
              runtimeMode: "approval-required",
            });
            expect(firstSession.model).toBe(FD_CODEX_MODEL);

            const first = yield* adapter.sendTurn({
              threadId,
              input: "Remember the codeword FD_RESUME_CONTEXT_7319. Reply exactly FD_STREAM_OK.",
            });
            yield* waitForCompletedTurn(receipts, first.turnId).pipe(Effect.timeout("120 seconds"));
            expect(assistantText(events, first.turnId)).toBe("FD_STREAM_OK");
            expect(events).toContainEqual(
              expect.objectContaining({
                type: "content.delta",
                turnId: first.turnId,
                payload: expect.objectContaining({ streamKind: "assistant_text" }),
              }),
            );

            const skillTurn = yield* adapter.sendTurn({
              threadId,
              input: "$fd-proof run the selected Skill",
            });
            yield* waitForCompletedTurn(receipts, skillTurn.turnId).pipe(
              Effect.timeout("120 seconds"),
            );
            expect(assistantText(events, skillTurn.turnId)).toBe("FD_LOCAL_SKILL_OK");

            expect(skillTurn.resumeCursor).toEqual(
              expect.objectContaining({ threadId: expect.any(String) }),
            );
            const resumeCursor = skillTurn.resumeCursor;
            if (!resumeCursor) {
              return yield* Effect.die(new Error("Real App Server did not return a resume cursor"));
            }
            yield* adapter.stopSession(threadId);
            const resumedSession = yield* adapter.startSession({
              threadId,
              cwd: projectRoot,
              runtimeMode: "approval-required",
              resumeCursor,
            });
            expect(resumedSession.resumeCursor).toEqual(resumeCursor);

            const resumedTurn = yield* adapter.sendTurn({
              threadId,
              input: "What codeword did I ask you to remember? Reply with the codeword only.",
            });
            yield* waitForCompletedTurn(receipts, resumedTurn.turnId).pipe(
              Effect.timeout("120 seconds"),
            );
            expect(assistantText(events, resumedTurn.turnId)).toBe("FD_RESUME_CONTEXT_7319");
          }),
        ).pipe(Effect.provide(serverLayer)),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 360_000);
});

function requiredEnvironment(name: "FD_CODEX_BINARY" | "FD_NEW_API_KEY"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for real App Server integration`);
  return value;
}

const waitForCompletedTurn = Effect.fn("waitForCompletedTurn")(function* (
  receipts: Queue.Queue<ProviderRuntimeEvent>,
  turnId: TurnId,
) {
  while (true) {
    const event = yield* Queue.take(receipts);
    if (event.turnId !== turnId) continue;
    if (event.type === "turn.aborted") {
      return yield* Effect.die(new Error(`Real App Server turn aborted: ${event.payload.reason}`));
    }
    if (event.type !== "turn.completed") continue;
    if (event.payload.state !== "completed") {
      return yield* Effect.die(
        new Error(
          `Real App Server turn ended as ${event.payload.state}: ${event.payload.errorMessage ?? "unknown error"}`,
        ),
      );
    }
    return;
  }
});

function assistantText(
  events: ReadonlyArray<ProviderRuntimeEvent>,
  turnId: TurnId,
): string | undefined {
  const event = events.findLast(
    (event) =>
      event.type === "item.completed" &&
      event.turnId === turnId &&
      event.payload.itemType === "assistant_message",
  );
  return event?.type === "item.completed" ? event.payload.detail : undefined;
}
