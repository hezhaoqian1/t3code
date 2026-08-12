import { TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { FdResponsesStreamer } from "../fd-agent/FdAgentKernel.ts";
import { FD_RESPONSES_MODEL } from "../fd-agent/FdResponsesProtocol.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

type FdTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const requestError = (operation: FdTextGenerationOperation) =>
  new TextGenerationError({
    operation,
    detail: "FD DeepSeek text generation failed.",
  });
const isTextGenerationError = Schema.is(TextGenerationError);

export const makeFdDeepSeekTextGeneration = (client: FdResponsesStreamer) => {
  const runJson = <S extends Schema.Top>(
    operation: FdTextGenerationOperation,
    prompt: string,
    outputSchema: S,
    modelSelection: { readonly model: string },
  ): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> => {
    if (modelSelection.model !== FD_RESPONSES_MODEL) return Effect.fail(requestError(operation));
    return Effect.tryPromise({
      try: async () => {
        let text = "";
        let completed = false;
        for await (const event of client.stream({
          round: 1,
          input: [{ role: "user", content: prompt }],
          reasoningEffort: "none",
        })) {
          if (event.type === "text-delta") text += event.text;
          if (event.type === "completed") completed = true;
        }
        if (!completed) throw requestError(operation);
        return text;
      },
      catch: () => requestError(operation),
    }).pipe(
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(outputSchema))(extractJsonObject(text)),
      ),
      Effect.mapError((cause) => (isTextGenerationError(cause) ? cause : requestError(operation))),
    );
  };

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("FdDeepSeekTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runJson(
        "generateCommitMessage",
        prompt,
        outputSchema,
        input.modelSelection,
      );
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("FdDeepSeekTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        changeRequestTemplate: input.changeRequestTemplate,
        policy: input.policy,
      });
      const generated = yield* runJson(
        "generatePrContent",
        prompt,
        outputSchema,
        input.modelSelection,
      );
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("FdDeepSeekTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runJson(
        "generateBranchName",
        prompt,
        outputSchema,
        input.modelSelection,
      );
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("FdDeepSeekTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runJson(
        "generateThreadTitle",
        prompt,
        outputSchema,
        input.modelSelection,
      );
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return TextGeneration.TextGeneration.of({
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  });
};
