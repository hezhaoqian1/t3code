import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, vi } from "vite-plus/test";

import { createModelSelection } from "@t3tools/shared/model";
import { FD_RUNTIME_PRO_MODEL } from "@t3tools/contracts/fd/runtime-credentials";

import type { FdResponsesStreamer } from "../fd-agent/FdAgentKernel.ts";
import { FD_DEEPSEEK_INSTANCE_ID } from "../fd-agent/FdModelPolicy.ts";
import {
  FD_RESPONSES_MODEL,
  type FdResponsesEvent,
  type FdResponsesRequest,
} from "../fd-agent/FdResponsesProtocol.ts";
import { makeFdDeepSeekTextGeneration } from "./FdDeepSeekTextGeneration.ts";

const MODEL_SELECTION = createModelSelection(FD_DEEPSEEK_INSTANCE_ID, FD_RESPONSES_MODEL);

function streamerFor(
  responses: ReadonlyArray<string>,
  requests: FdResponsesRequest[],
): FdResponsesStreamer {
  let index = 0;
  return {
    stream: async function* (request) {
      requests.push(request);
      const text = responses[index++];
      if (text === undefined) throw new Error("missing test response");
      yield { type: "text-delta", text } satisfies FdResponsesEvent;
      yield { type: "completed", finishReason: "stop" } satisfies FdResponsesEvent;
    },
  };
}

describe("FdDeepSeekTextGeneration", () => {
  it.effect("generates commit, PR, branch, and title content through the exact FD request", () =>
    Effect.gen(function* () {
      const requests: FdResponsesRequest[] = [];
      const service = makeFdDeepSeekTextGeneration(
        streamerFor(
          [
            '{"subject":"Add FD support.","body":"  Body  ","branch":"Feature FD"}',
            '{"title":"Ship FD support","body":"  ## Summary\\n- FD  "}',
            '{"branch":"Fix Runtime Flow"}',
            '{"title":"FD Runtime Flow"}',
          ],
          requests,
        ),
      );

      expect(
        yield* service.generateCommitMessage({
          cwd: "/workspace",
          branch: "main",
          stagedSummary: "one file",
          stagedPatch: "+change",
          includeBranch: true,
          modelSelection: MODEL_SELECTION,
        }),
      ).toEqual({ subject: "Add FD support", body: "Body", branch: "feature/feature-fd" });
      expect(
        yield* service.generatePrContent({
          cwd: "/workspace",
          baseBranch: "main",
          headBranch: "feature-fd",
          commitSummary: "Add FD support",
          diffSummary: "one file",
          diffPatch: "+change",
          modelSelection: MODEL_SELECTION,
        }),
      ).toEqual({ title: "Ship FD support", body: "## Summary\n- FD" });
      expect(
        yield* service.generateBranchName({
          cwd: "/workspace",
          message: "Fix runtime flow",
          modelSelection: MODEL_SELECTION,
        }),
      ).toEqual({ branch: "fix-runtime-flow" });
      expect(
        yield* service.generateThreadTitle({
          cwd: "/workspace",
          message: "Fix the FD runtime flow",
          modelSelection: MODEL_SELECTION,
        }),
      ).toEqual({ title: "FD Runtime Flow" });

      expect(requests).toHaveLength(4);
      for (const request of requests) {
        expect(request).toMatchObject({
          model: FD_RESPONSES_MODEL,
          round: 1,
          reasoningEffort: "none",
        });
        expect(request.input).toHaveLength(1);
        expect(request.input[0]).toMatchObject({ role: "user" });
        expect(typeof (request.input[0] as { content?: unknown }).content).toBe("string");
        expect(request).not.toHaveProperty("tools");
      }
    }),
  );

  it.effect("accepts a Pro task selection while keeping helper generation on Flash", () =>
    Effect.gen(function* () {
      const requests: FdResponsesRequest[] = [];
      const service = makeFdDeepSeekTextGeneration(
        streamerFor(['{"branch":"pro-task"}'], requests),
      );

      yield* service.generateBranchName({
        cwd: "/workspace",
        message: "Create a branch",
        modelSelection: createModelSelection(FD_DEEPSEEK_INSTANCE_ID, FD_RUNTIME_PRO_MODEL),
      });

      expect(requests).toEqual([expect.objectContaining({ model: FD_RESPONSES_MODEL })]);
    }),
  );

  it.effect("rejects any model outside the exact managed model list before transport", () =>
    Effect.gen(function* () {
      const stream = vi.fn<FdResponsesStreamer["stream"]>();
      const service = makeFdDeepSeekTextGeneration({ stream });
      const result = yield* service
        .generateBranchName({
          cwd: "/workspace",
          message: "private request",
          modelSelection: createModelSelection(FD_DEEPSEEK_INSTANCE_ID, "other-model"),
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(stream).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "omits attachment identity and local paths from outbound text-generation requests",
    () =>
      Effect.gen(function* () {
        const requests: FdResponsesRequest[] = [];
        const service = makeFdDeepSeekTextGeneration(
          streamerFor(
            ['{"branch":"fix-visual-layout"}', '{"title":"Fix Visual Layout"}'],
            requests,
          ),
        );
        const privateAttachment = {
          type: "image" as const,
          id: "private-attachment-id",
          name: "/Users/fdemployee/Library/attachmentsDir/customer-layout.png",
          mimeType: "image/png",
          sizeBytes: 12_345,
        };

        yield* service.generateBranchName({
          cwd: "/Users/fdemployee/private-project",
          message: "Fix the visual layout",
          attachments: [privateAttachment],
          modelSelection: MODEL_SELECTION,
        });
        yield* service.generateThreadTitle({
          cwd: "/Users/fdemployee/private-project",
          message: "Fix the visual layout",
          attachments: [privateAttachment],
          modelSelection: MODEL_SELECTION,
        });

        expect(requests).toHaveLength(2);
        for (const request of requests) {
          const content = (request.input[0] as { readonly content: string }).content;
          expect(content).toContain("Fix the visual layout");
          expect(content).toContain("1 image attachment provided");
          expect(content).not.toContain(privateAttachment.name);
          expect(content).not.toContain(privateAttachment.id);
          expect(content).not.toContain(privateAttachment.mimeType);
          expect(content).not.toContain(String(privateAttachment.sizeBytes));
          expect(content).not.toContain("/Users/fdemployee");
          expect(content).not.toContain("attachmentsDir");
          expect(content).not.toContain("private-project");
        }
      }),
  );

  it.effect("fails when the response ends without a completed event", () =>
    Effect.gen(function* () {
      const service = makeFdDeepSeekTextGeneration({
        stream: async function* () {
          yield { type: "text-delta", text: '{"branch":"partial"}' };
        },
      });
      const result = yield* service
        .generateBranchName({
          cwd: "/workspace",
          message: "private request",
          modelSelection: MODEL_SELECTION,
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure._tag).toBe("TextGenerationError");
    }),
  );

  it.effect("maps malformed or failed responses without retaining private input or causes", () =>
    Effect.gen(function* () {
      const privateMarker = "PRIVATE_MARKER_DO_NOT_EXPOSE";
      const cases: FdResponsesStreamer[] = [
        streamerFor(["not-json"], []),
        {
          stream: async function* () {
            throw new Error(privateMarker);
          },
        },
      ];

      for (const client of cases) {
        const result = yield* makeFdDeepSeekTextGeneration(client)
          .generateThreadTitle({
            cwd: "/workspace",
            message: privateMarker,
            modelSelection: MODEL_SELECTION,
          })
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("TextGenerationError");
          expect(result.failure.cause).toBeUndefined();
          expect(result.failure.detail).not.toContain(privateMarker);
          expect(result.failure.message).not.toContain(privateMarker);
        }
      }
    }),
  );
});
