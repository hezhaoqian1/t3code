import { it as effectIt } from "@effect/vitest";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

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
import { describe, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { FdRuntimeCredentialStore, makeStore } from "../fd/FdRuntimeCredentialStore.ts";
import { FdAgentKernel } from "../fd-agent/FdAgentKernel.ts";
import { FdResponsesClient } from "../fd-agent/FdResponsesClient.ts";
import { makeFdDeepSeekAdapter } from "../provider/Layers/FdDeepSeekAdapter.ts";
import { resolveProviderRollbackTurnCount } from "../provider/Layers/ProviderService.ts";
import { makeFdCodexAdapter } from "./FdCodexAdapter.ts";
import { FD_CODEX_MODEL } from "./FdManagedCodexHome.ts";

// Runs the bundled Codex App Server against a local stand-in for the model
// gateway, so it needs no FD account:
//   FD_RUN_REAL_APP_SERVER=1 FD_CODEX_BINARY=/abs/path/to/codex vp test run <this file>
const shouldRun =
  process.env.FD_RUN_REAL_APP_SERVER === "1" && process.env.FD_CODEX_BINARY !== undefined;
const instanceId = ProviderInstanceId.make("fd-deepseek");

describe.skipIf(!shouldRun)("FD Codex rewind against the real App Server", () => {
  effectIt.live(
    "removes rewound turns from the model's history, also after a restart",
    () =>
      Effect.gen(function* () {
        const binaryPath = process.env.FD_CODEX_BINARY!;
        const gateway = yield* Effect.acquireRelease(
          Effect.promise(() => startFakeResponsesGateway()),
          (server) => Effect.promise(() => server.close()),
        );
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-codex-rewind-"))),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const taskFolder = NodePath.join(root, "Tasks", "20261029-120000");
        yield* Effect.promise(() => NodeFSP.mkdir(taskFolder, { recursive: true }));

        const credentials: FdServerRuntimeCredentialProjection = {
          userId: 1,
          runtimeTokenId: 1,
          newApiOrigin: gateway.origin,
          runtimeApiKey: "fake-runtime-key",
          accessToken: "fake-access-token",
          accessExpiresAt: 4_102_444_800,
          policy: {
            version: 1,
            capability: "general_assistant",
            model: FD_CODEX_MODEL,
            expiresAt: 4_102_444_800,
          },
          generation: 1,
        };
        const store = yield* makeStore();
        yield* store.apply({ version: 1, type: "set", credentials });
        const ordinaryAdapter = yield* makeFdCodexAdapter({ instanceId, binaryPath }).pipe(
          Effect.provideService(FdRuntimeCredentialStore, store.service),
        );
        const adapter = yield* makeFdDeepSeekAdapter({
          ordinaryAdapter,
          kernel: new FdAgentKernel(new FdResponsesClient(store.service)),
        });
        const receipts = yield* Queue.unbounded<ProviderRuntimeEvent>();
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Queue.offer(receipts, event),
        ).pipe(Effect.forkScoped);

        const threadId = ThreadId.make("fd-codex-rewind-thread");
        const sessionInput = {
          threadId,
          cwd: taskFolder,
          runtimeMode: "full-access" as const,
          modelSelection: { instanceId, model: FD_CODEX_MODEL },
        };
        yield* adapter.startSession(sessionInput);
        const send = (input: string) =>
          Effect.gen(function* () {
            const turn = yield* adapter.sendTurn({ threadId, input });
            yield* waitForCompletedTurn(receipts, turn.turnId).pipe(Effect.timeout("120 seconds"));
            return turn;
          });

        const alpha = yield* send("Remember REWIND_ALPHA.");
        const bravo = yield* send("Remember REWIND_BRAVO.");
        const charlie = yield* send("Remember REWIND_CHARLIE.");
        const history = yield* adapter.readThread(threadId);
        expect(history.turns.map((turn) => turn.id)).toEqual([
          alpha.turnId,
          bravo.turnId,
          charlie.turnId,
        ]);

        // What ProviderService does for "rewind to before REWIND_BRAVO".
        const numTurns = resolveProviderRollbackTurnCount({
          providerTurnIds: history.turns.map((turn) => turn.id),
          removedTurnIds: [bravo.turnId, charlie.turnId],
        });
        expect(numTurns).toBe(2);
        const rewound = yield* adapter.rollbackThread(threadId, numTurns);
        expect(rewound.turns.map((turn) => turn.id)).toEqual([alpha.turnId]);

        yield* send("Which words do you remember? REWIND_DELTA");
        const afterRewind = gateway.lastRequestBody();
        expect(afterRewind).toContain("REWIND_ALPHA");
        expect(afterRewind).toContain("REWIND_DELTA");
        expect(afterRewind).not.toContain("REWIND_BRAVO");
        expect(afterRewind).not.toContain("REWIND_CHARLIE");

        // A restart resumes the rewound history, not the original one.
        const cursor = (yield* adapter.listSessions())[0]?.resumeCursor;
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({ ...sessionInput, resumeCursor: cursor });
        expect((yield* adapter.readThread(threadId)).turns).toHaveLength(2);
        yield* send("Anything else? REWIND_ECHO");
        const afterRestart = gateway.lastRequestBody();
        expect(afterRestart).toContain("REWIND_ALPHA");
        expect(afterRestart).toContain("REWIND_DELTA");
        expect(afterRestart).not.toContain("REWIND_BRAVO");
        expect(afterRestart).not.toContain("REWIND_CHARLIE");
        yield* adapter.stopSession(threadId);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ServerConfig.layerTest(NodeOS.tmpdir(), {
            prefix: "fd-codex-rewind-state-",
          }).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      ),
    300_000,
  );
});

interface FakeResponsesGateway {
  readonly origin: string;
  readonly lastRequestBody: () => string;
  readonly close: () => Promise<void>;
}

// Answers every Responses request with a short assistant message and keeps
// the request bodies, which show exactly what history Codex sent the model.
async function startFakeResponsesGateway(): Promise<FakeResponsesGateway> {
  const bodies: string[] = [];
  let responseCount = 0;
  const server = NodeHttp.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
        response.writeHead(404).end();
        return;
      }
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      responseCount += 1;
      const id = `resp_${responseCount}`;
      const events = [
        ["response.created", `{"type":"response.created","response":{"id":"${id}"}}`],
        [
          "response.output_item.done",
          `{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg_${responseCount}","content":[{"type":"output_text","text":"OK ${responseCount}"}]}}`,
        ],
        [
          "response.completed",
          `{"type":"response.completed","response":{"id":"${id}","usage":{"input_tokens":1,"input_tokens_details":null,"output_tokens":1,"output_tokens_details":null,"total_tokens":2}}}`,
        ],
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events.map(([type, data]) => `event: ${type}\ndata: ${data}\n\n`).join(""));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No gateway address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    lastRequestBody: () => bodies.at(-1) ?? "",
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const waitForCompletedTurn = Effect.fn("waitForCompletedTurn")(function* (
  receipts: Queue.Queue<ProviderRuntimeEvent>,
  turnId: TurnId,
) {
  while (true) {
    const event = yield* Queue.take(receipts);
    if (event.turnId !== turnId) continue;
    if (event.type === "turn.aborted") {
      return yield* Effect.die(new Error(`Codex turn aborted: ${event.payload.reason}`));
    }
    if (event.type !== "turn.completed") continue;
    if (event.payload.state !== "completed") {
      return yield* Effect.die(
        new Error(
          `Codex turn ended as ${event.payload.state}: ${event.payload.errorMessage ?? "unknown"}`,
        ),
      );
    }
    return;
  }
});
