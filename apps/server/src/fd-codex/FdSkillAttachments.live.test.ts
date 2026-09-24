// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
  type TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";
import * as ServerConfig from "../config.ts";
import { FdRuntimeCredentialStore, makeStore } from "../fd/FdRuntimeCredentialStore.ts";
import { makeFdCodexAdapter } from "./FdCodexAdapter.ts";
import { makeFdDeepSeekAdapter } from "../provider/Layers/FdDeepSeekAdapter.ts";
import { FdAgentKernel } from "../fd-agent/FdAgentKernel.ts";
import { FdResponsesClient } from "../fd-agent/FdResponsesClient.ts";
import { prepareAttachments } from "../fileAnalysis/PrepareAttachments.ts";
import { resolveAttachmentPath } from "../attachmentStore.ts";

const instanceId = ProviderInstanceId.make("fd-deepseek");
describe.skipIf(process.env.FD_RUN_REAL_APP_SERVER !== "1")("live FD attachment acceptance", () => {
  for (const mode of ["ordinary", "enterprise", "native"] as const) {
    it.effect(
      `reads an attached file and remembers it in ${mode} mode`,
      () =>
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.promise(() =>
              NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-live-attachment-")),
            ),
            (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
          );
          const code = `FD_FILE_${NodeCrypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
          const bytes = Buffer.from(
            `Acceptance reference code: ${code}\nThis is synthetic test data.\n`,
          );
          const attachment = {
            type: "document" as const,
            id: `acceptance-${NodeCrypto.randomUUID()}`,
            name: "acceptance.txt",
            mimeType: "text/plain",
            sizeBytes: bytes.length,
          };
          const path = resolveAttachmentPath({ attachmentsDir: root, attachment });
          if (!path) throw new Error("Test attachment path invalid");
          yield* Effect.promise(async () => {
            await NodeFSP.writeFile(path, bytes);
            const skillDir = NodePath.join(root, ".agents", "skills", "fd-file-proof");
            await NodeFSP.mkdir(skillDir, { recursive: true });
            await NodeFSP.writeFile(
              NodePath.join(skillDir, "SKILL.md"),
              "---\nname: fd-file-proof\ndescription: Read the reference code in a supplied test attachment.\n---\nRead the attached text in the user message. Reply with LOCAL_SKILL_ACCEPTED followed by its Acceptance reference code. Do not call any tools.\n",
            );
          });
          yield* Effect.gen(function* () {
            const store = yield* makeStore();
            yield* store.apply({
              version: 1,
              type: "set",
              credentials: {
                userId: Number(process.env.FD_TEST_USER_ID),
                runtimeTokenId: Number(process.env.FD_TEST_TOKEN_ID),
                newApiOrigin: process.env.FD_NEW_API_ORIGIN!,
                runtimeApiKey: process.env.FD_NEW_API_KEY!,
                accessToken: process.env.FD_TEST_ACCESS_TOKEN!,
                accessExpiresAt: 4102444800,
                generation: 1,
                policy: {
                  version: 1,
                  capability: "general_assistant",
                  model: "deepseek-flash",
                  expiresAt: 4102444800,
                },
              },
            });
            const ordinaryAdapter = yield* makeFdCodexAdapter({
              instanceId,
              binaryPath: process.env.FD_CODEX_BINARY!,
            }).pipe(Effect.provideService(FdRuntimeCredentialStore, store.service));
            const adapter = yield* makeFdDeepSeekAdapter({
              ordinaryAdapter,
              kernel: new FdAgentKernel(new FdResponsesClient(store.service)),
              prepareAttachments: (turn, model, signal, onProgress) =>
                prepareAttachments({
                  turn,
                  model,
                  signal,
                  onProgress,
                  platform: "win32",
                  attachmentsDir: root,
                  vision: {
                    analyze: async () => {
                      throw new Error("Plain text must not need vision");
                    },
                  },
                }),
            });
            const receipts = yield* Queue.unbounded<ProviderRuntimeEvent>();
            const events: ProviderRuntimeEvent[] = [];
            yield* Stream.runForEach(adapter.streamEvents, (event) =>
              Effect.sync(() => events.push(event)).pipe(
                Effect.andThen(Queue.offer(receipts, event)),
              ),
            ).pipe(Effect.forkScoped);
            const threadId = ThreadId.make(NodeCrypto.randomUUID());
            const modelSelection = { instanceId, model: "kimi-k3" };
            const fields =
              mode === "enterprise"
                ? { fdSkillVersionId: Number(process.env.FD_ENTERPRISE_SKILL_VERSION_ID) }
                : mode === "native"
                  ? { nativeSkillNames: ["fd-file-proof"] }
                  : {};
            yield* adapter.startSession({
              threadId,
              cwd: root,
              modelSelection,
              runtimeMode: "approval-required",
            });
            const first = yield* adapter.sendTurn({
              threadId,
              modelSelection,
              ...fields,
              attachments: [attachment],
              input:
                mode === "native"
                  ? "$fd-file-proof 读取本轮附件中的 Acceptance reference code，按技能要求回答。不要调用其他工具。"
                  : "这是文件上传验收。只读取本轮附件，回复其中的 Acceptance reference code 原文。不要查询企业数据，不调用工具。",
            });
            yield* waitForTurn(receipts, first.turnId);
            expect(answer(events, first.turnId)).toContain(code);
            if (mode === "native")
              expect(answer(events, first.turnId)).toContain("LOCAL_SKILL_ACCEPTED");
            const followUp = yield* adapter.sendTurn({
              threadId,
              modelSelection,
              ...fields,
              input: "上一轮附件中的 Acceptance reference code 是什么？仅复述编号，不调用工具。",
            });
            yield* waitForTurn(receipts, followUp.turnId);
            expect(answer(events, followUp.turnId)).toContain(code);
            yield* adapter.stopSession(threadId);
          }).pipe(
            Effect.provide(
              ServerConfig.layerTest(root, root).pipe(Layer.provideMerge(NodeServices.layer)),
            ),
          );
        }).pipe(Effect.scoped),
      240_000,
    );
  }
});

const waitForTurn = (receipts: Queue.Queue<ProviderRuntimeEvent>, turnId: TurnId) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(receipts);
      if (event.turnId !== turnId) continue;
      if (event.type === "runtime.error" || event.type === "request.opened")
        throw new Error(`Unexpected ${event.type} during attachment acceptance`);
      if (event.type === "turn.completed") {
        expect(event.payload.state).toBe("completed");
        return;
      }
    }
  }).pipe(Effect.timeout("100 seconds"));

function answer(events: ProviderRuntimeEvent[], turnId: TurnId) {
  return events
    .filter(
      (event) =>
        event.turnId === turnId &&
        event.type === "content.delta" &&
        event.payload.streamKind === "assistant_text",
    )
    .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
    .join("");
}
