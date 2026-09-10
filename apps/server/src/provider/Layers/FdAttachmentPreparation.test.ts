import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderSendTurnInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { FdAgentKernel } from "../../fd-agent/FdAgentKernel.ts";
import { makeFdDeepSeekAdapter, FD_DEEPSEEK_INSTANCE_ID } from "./FdDeepSeekAdapter.ts";

const threadId = ThreadId.make("attachment-test");
const selection = { instanceId: FD_DEEPSEEK_INSTANCE_ID, model: "kimi-k3" };
const turn: ProviderSendTurnInput = {
  threadId,
  modelSelection: selection,
  input: "Read PDF",
  attachments: [
    {
      type: "document",
      id: "fixture",
      name: "scan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    },
  ],
};

function ordinary(sent: ProviderSendTurnInput[]): ProviderAdapterShape<never> {
  const provider = ProviderDriverKind.make("codex");
  return {
    provider,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (input) =>
      Effect.succeed({
        provider,
        providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
        threadId: input.threadId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        model: input.modelSelection?.model ?? selection.model,
        createdAt: "2026-09-10T00:00:00Z",
        updatedAt: "2026-09-10T00:00:00Z",
      }),
    sendTurn: (input) => {
      sent.push(input);
      return Effect.succeed({ threadId, turnId: TurnId.make("prepared-turn") });
    },
    interruptTurn: () => Effect.void,
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: () => Effect.void,
    stopAll: () => Effect.void,
    listSessions: () => Effect.succeed([]),
    hasSession: () => Effect.succeed(true),
    readThread: () => Effect.succeed({ threadId, turns: [] }),
    rollbackThread: () => Effect.succeed({ threadId, turns: [] }),
    streamEvents: Stream.empty,
  };
}

describe("FD attachment preparation lifecycle", () => {
  it.effect(
    "prepares document evidence with the selected model before starting the ordinary turn",
    () =>
      Effect.gen(function* () {
        const sent: ProviderSendTurnInput[] = [];
        const adapter = yield* makeFdDeepSeekAdapter({
          kernel: new FdAgentKernel({ stream: async function* () {} }),
          ordinaryAdapter: ordinary(sent),
          prepareAttachments: async (input, model) => {
            expect(model).toBe("kimi-k3");
            expect(input.attachments?.[0]?.type).toBe("document");
            return { ...input, input: "scan.pdf page 1: Revenue 123", attachments: [] };
          },
        });
        yield* adapter.startSession({
          threadId,
          modelSelection: selection,
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn(turn);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.input).toContain("page 1");
        expect(sent[0]?.attachments).toEqual([]);
      }),
  );

  it.effect("cancels preparation, blocks duplicate sends, and accepts a later retry", () =>
    Effect.gen(function* () {
      const sent: ProviderSendTurnInput[] = [];
      const entered = Promise.withResolvers<void>();
      let calls = 0;
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel({ stream: async function* () {} }),
        ordinaryAdapter: ordinary(sent),
        prepareAttachments: async (input, _model, signal) => {
          calls++;
          if (calls === 1) {
            entered.resolve();
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(new Error("cancelled")), {
                once: true,
              }),
            );
          }
          return { ...input, attachments: [] };
        },
      });
      yield* adapter.startSession({
        threadId,
        modelSelection: selection,
        runtimeMode: "approval-required",
      });
      const pending = yield* adapter.sendTurn(turn).pipe(Effect.exit, Effect.forkChild);
      yield* Effect.promise(() => entered.promise);
      expect(Exit.isFailure(yield* Effect.exit(adapter.sendTurn(turn)))).toBe(true);
      expect(
        Exit.isFailure(yield* Effect.exit(adapter.sendTurn({ ...turn, attachments: [] }))),
      ).toBe(true);
      yield* adapter.interruptTurn(threadId);
      expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true);
      expect(sent).toHaveLength(0);
      yield* adapter.sendTurn(turn);
      expect(sent).toHaveLength(1);
    }),
  );
});
