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
import { makeFdDeepSeekAdapter } from "../provider/Layers/FdDeepSeekAdapter.ts";
import { FdAgentKernel } from "../fd-agent/FdAgentKernel.ts";
import { FdResponsesClient } from "../fd-agent/FdResponsesClient.ts";

const shouldRun = process.env.FD_RUN_REAL_APP_SERVER === "1";
const instanceId = ProviderInstanceId.make("fd-deepseek");

describe.skipIf(!shouldRun)("FD Codex App Server integration", () => {
  it.skipIf(!process.env.FD_ENTERPRISE_SKILL_VERSION_ID)(
    "retains a managed Kimi Skill answer across follow-up turns and session restart",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "fd-enterprise-context-"));
      const credentials: FdServerRuntimeCredentialProjection = {
        userId: Number(process.env.FD_TEST_USER_ID),
        runtimeTokenId: Number(process.env.FD_TEST_TOKEN_ID),
        newApiOrigin: process.env.FD_NEW_API_ORIGIN!,
        runtimeApiKey: requiredEnvironment("FD_NEW_API_KEY"),
        accessToken: process.env.FD_TEST_ACCESS_TOKEN!,
        accessExpiresAt: 4_102_444_800,
        policy: {
          version: 1,
          capability: "general_assistant",
          model: FD_CODEX_MODEL,
          expiresAt: 4_102_444_800,
        },
        generation: 1,
      };
      const layer = ServerConfig.layerTest(root, root).pipe(Layer.provideMerge(NodeServices.layer));
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* makeStore();
              yield* store.apply({ version: 1, type: "set", credentials });
              const ordinaryAdapter = yield* makeFdCodexAdapter({
                instanceId,
                binaryPath: requiredEnvironment("FD_CODEX_BINARY"),
              }).pipe(Effect.provideService(FdRuntimeCredentialStore, store.service));
              const adapter = yield* makeFdDeepSeekAdapter({
                ordinaryAdapter,
                kernel: new FdAgentKernel(new FdResponsesClient(store.service)),
              });
              const events: ProviderRuntimeEvent[] = [];
              const receipts = yield* Queue.unbounded<ProviderRuntimeEvent>();
              yield* Stream.runForEach(adapter.streamEvents, (event) =>
                Effect.sync(() => events.push(event)).pipe(
                  Effect.andThen(Queue.offer(receipts, event)),
                ),
              ).pipe(Effect.forkScoped);
              const threadId = ThreadId.make("fd-enterprise-context-proof");
              const modelSelection = { instanceId, model: "kimi-k3" };
              const sessionInput = {
                threadId,
                cwd: root,
                runtimeMode: "approval-required" as const,
                modelSelection,
              };
              const fdSkillVersionId = Number(process.env.FD_ENTERPRISE_SKILL_VERSION_ID);
              yield* adapter.startSession(sessionInput);
              const first = yield* adapter.sendTurn({
                threadId,
                modelSelection,
                fdSkillVersionId,
                input:
                  "这是上下文恢复测试，不查询企业数据、不调用工具。假设筛选得到394只候选，规则编号FD_RULE_8371。仅回复：可以导出394只候选，规则FD_RULE_8371。",
              });
              yield* waitForCompletedTurn(receipts, first.turnId).pipe(
                Effect.timeout("180 seconds"),
              );
              expect(assistantText(events, first.turnId)).toContain("FD_RULE_8371");
              expect(
                events.find(
                  (event) =>
                    event.turnId === first.turnId &&
                    event.type === "item.completed" &&
                    event.payload.itemType === "assistant_message",
                )?.persistence,
              ).toBe("memory-only");
              const followUp = yield* adapter.sendTurn({
                threadId,
                modelSelection,
                fdSkillVersionId,
                input:
                  "你上一条回答承诺导出多少只候选，用哪个规则编号？只复述数量和编号，不调用工具。",
              });
              yield* waitForCompletedTurn(receipts, followUp.turnId).pipe(
                Effect.timeout("180 seconds"),
              );
              expect(followUp.resumeCursor).toEqual(first.resumeCursor);
              expect(assistantText(events, followUp.turnId)).toContain("394");
              expect(assistantText(events, followUp.turnId)).toContain("FD_RULE_8371");
              yield* adapter.stopSession(threadId);
              yield* adapter.startSession({ ...sessionInput, resumeCursor: followUp.resumeCursor });
              const resumed = yield* adapter.sendTurn({
                threadId,
                modelSelection,
                fdSkillVersionId,
                input: "继续刚才的对话：候选数量和规则编号是什么？只复述，不调用工具。",
              });
              yield* waitForCompletedTurn(receipts, resumed.turnId).pipe(
                Effect.timeout("180 seconds"),
              );
              expect(resumed.resumeCursor).toEqual(first.resumeCursor);
              expect(assistantText(events, resumed.turnId)).toContain("394");
              expect(assistantText(events, resumed.turnId)).toContain("FD_RULE_8371");
              const switched = yield* adapter.sendTurn({
                threadId,
                fdSkillVersionId,
                modelSelection: { instanceId, model: "deepseek-v4-flash" },
                input: "上轮的候选数量和规则编号是什么？只复述，不调用工具。",
              });
              yield* waitForCompletedTurn(receipts, switched.turnId).pipe(
                Effect.timeout("180 seconds"),
              );
              expect(switched.resumeCursor).toEqual(first.resumeCursor);
              expect(assistantText(events, switched.turnId)).toContain("FD_RULE_8371");
              expect(
                (yield* adapter.readThread(threadId)).turns.every(
                  (turn) => turn.items.length === 0,
                ),
              ).toBe(true);
            }),
          ).pipe(Effect.provide(layer)),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    600_000,
  );

  it("streams DeepSeek, executes a local Skill, compacts, and resumes the conversation", async () => {
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

            yield* adapter.compaction!.start(threadId);
            yield* Effect.gen(function* () {
              while (true) {
                const event = yield* Queue.take(receipts);
                if (event.type === "thread.state.changed" && event.payload.state === "compacted")
                  return;
                if (event.type === "runtime.error")
                  return yield* Effect.die(new Error("Real compaction failed"));
              }
            }).pipe(Effect.timeout("180 seconds"));

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

            const switchedTurn = yield* adapter.sendTurn({
              threadId,
              modelSelection: { instanceId, model: "kimi-k3" },
              input: "What codeword did I ask you to remember? Reply with the codeword only.",
            });
            yield* waitForCompletedTurn(receipts, switchedTurn.turnId).pipe(
              Effect.timeout("120 seconds"),
            );
            expect(switchedTurn.resumeCursor).toEqual(resumeCursor);
            expect(assistantText(events, switchedTurn.turnId)).toBe("FD_RESUME_CONTEXT_7319");

            yield* adapter.stopSession(threadId);
            const missingCursor = { threadId: "00000000-0000-7000-8000-000000000001" };
            const freshSession = yield* adapter.startSession({
              threadId,
              cwd: projectRoot,
              runtimeMode: "approval-required",
              resumeCursor: missingCursor,
            });
            expect(freshSession.resumeCursor).not.toEqual(missingCursor);
            const freshTurn = yield* adapter.sendTurn({
              threadId,
              input: "Reply exactly FD_FRESH_CONTEXT_OK.",
            });
            yield* waitForCompletedTurn(receipts, freshTurn.turnId).pipe(
              Effect.timeout("120 seconds"),
            );
            expect(assistantText(events, freshTurn.turnId)).toBe("FD_FRESH_CONTEXT_OK");
          }),
        ).pipe(Effect.provide(serverLayer)),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 540_000);
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
  if (event?.type !== "item.completed") return undefined;
  const data = event.payload.data;
  return typeof data === "object" &&
    data !== null &&
    "finalText" in data &&
    typeof data.finalText === "string"
    ? data.finalText
    : event.payload.detail;
}
