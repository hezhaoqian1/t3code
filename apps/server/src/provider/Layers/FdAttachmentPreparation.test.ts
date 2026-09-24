// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import {
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ChatAttachment,
  type ProviderSendTurnInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { FdAgentKernel } from "../../fd-agent/FdAgentKernel.ts";
import { prepareAttachments } from "../../fileAnalysis/PrepareAttachments.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
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
  for (const profile of [
    { name: "ordinary chat", fields: {} },
    { name: "FD Skill", fields: { fdSkillVersionId: 10004 } },
    { name: "local Skill", fields: { nativeSkillNames: ["fd-acceptance"] } },
  ]) {
    it.effect(`parses real TXT, XLSX, PDF and PNG files for ${profile.name}`, () =>
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-skill-files-"))),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const attachments = yield* Effect.promise(async () => {
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
              ["Product", "Revenue"],
              ["FD_XLSX_PROOF", 7319],
            ]),
            "Revenue",
          );
          const pdf = await PDFDocument.create();
          const font = await pdf.embedFont(StandardFonts.Helvetica);
          pdf.addPage([300, 300]).drawText("FD_PDF_PROOF 8426", { x: 20, y: 200, font, size: 14 });
          const canvas = createCanvas(64, 64);
          const context = canvas.getContext("2d");
          context.fillStyle = "red";
          context.fillRect(0, 0, 64, 64);
          const imageBytes = await canvas.encode("png");
          const embeddedImage = await pdf.embedPng(imageBytes);
          pdf
            .addPage([300, 300])
            .drawImage(embeddedImage, { x: 20, y: 20, width: 200, height: 200 });
          const files = [
            { name: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("FD_TXT_PROOF 6297") },
            {
              name: "sales.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              bytes: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
            },
            { name: "report.pdf", mimeType: "application/pdf", bytes: await pdf.save() },
            { name: "chart.png", mimeType: "image/png", bytes: imageBytes },
          ];
          return Promise.all(
            files.map(async (file, index): Promise<ChatAttachment> => {
              const attachment: ChatAttachment = {
                type: file.name.endsWith(".png") ? "image" : "document",
                id: `acceptance-00000000-0000-0000-0000-00000000000${index}`,
                name: file.name,
                mimeType: file.mimeType,
                sizeBytes: file.bytes.length,
              };
              const path = resolveAttachmentPath({ attachmentsDir: directory, attachment });
              if (!path) throw new Error("Invalid test attachment path");
              await NodeFSP.writeFile(path, file.bytes);
              return attachment;
            }),
          );
        });
        const sent: ProviderSendTurnInput[] = [];
        let recognizedPages = 0;
        const adapter = yield* makeFdDeepSeekAdapter({
          kernel: new FdAgentKernel({ stream: async function* () {} }),
          ordinaryAdapter: ordinary(sent),
          prepareAttachments: (input, model, signal, onProgress) =>
            prepareAttachments({
              turn: input,
              model,
              signal,
              onProgress,
              platform: "win32",
              attachmentsDir: directory,
              vision: {
                analyze: async (request) => {
                  recognizedPages++;
                  expect(request.model).toBe(selection.model);
                  expect(request.images[0]?.image_url).toMatch(/^data:image\/jpeg;base64,/);
                  return "FD_VISION_PROOF 9538";
                },
              },
            }),
        });
        yield* adapter.startSession({
          threadId,
          modelSelection: selection,
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ ...turn, ...profile.fields, attachments });
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ ...profile.fields, attachments: [attachments[3]] });
        expect(sent[0]?.input).toContain("Read PDF");
        for (const proof of [
          "FD_TXT_PROOF 6297",
          "FD_XLSX_PROOF",
          "7319",
          "FD_PDF_PROOF 8426",
          "FD_VISION_PROOF 9538",
        ]) {
          expect(sent[0]?.input).toContain(proof);
        }
        expect(recognizedPages).toBe(1);
        expect(sent[0]?.input).toContain('trust="none"');
      }).pipe(Effect.scoped),
    );
  }

  it.effect("delivers PDF evidence and native images to the selected FD Skill", () =>
    Effect.gen(function* () {
      const sent: ProviderSendTurnInput[] = [];
      const image = {
        type: "image" as const,
        id: "attachment-test-00000000-0000-0000-0000-000000000002",
        name: "chart.png",
        mimeType: "image/png",
        sizeBytes: 64,
      };
      const skillTurn = {
        ...turn,
        fdSkillVersionId: 10004,
        attachments: [
          { ...turn.attachments![0]!, id: "attachment-test-00000000-0000-0000-0000-000000000001" },
          image,
        ],
      };
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel({ stream: async function* () {} }),
        ordinaryAdapter: ordinary(sent),
        prepareAttachments: (input, model, signal, onProgress) =>
          prepareAttachments({
            turn: input,
            model,
            signal,
            onProgress,
            platform: "win32",
            attachmentsDir: "/tmp/attachments",
            process: async ({ attachment }) =>
              attachment.type === "image"
                ? { images: [], passthrough: true }
                : { images: [{ label: "scan.pdf page 1", bytes: new Uint8Array([1, 2]) }] },
            vision: {
              analyze: async (request) => {
                expect(request.model).toBe(selection.model);
                return "Revenue 123";
              },
            },
          }),
      });
      yield* adapter.startSession({
        threadId,
        modelSelection: selection,
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn(skillTurn);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ fdSkillVersionId: 10004, attachments: [image] });
      expect(sent[0]?.input).toContain("Read PDF");
      expect(sent[0]?.input).toContain("scan.pdf page 1");
      expect(sent[0]?.input).toContain("Revenue 123");
      expect(sent[0]?.input).toContain('trust="none"');
    }),
  );

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

  for (const profile of [
    { name: "ordinary chat", fields: {} },
    { name: "FD Skill", fields: { fdSkillVersionId: 10004 } },
    { name: "local Skill", fields: { nativeSkillNames: ["fd-acceptance"] } },
  ]) {
    it.effect(
      `cancels ${profile.name} preparation and retries only when files are attached again`,
      () =>
        Effect.gen(function* () {
          const attachedTurn = { ...turn, ...profile.fields };
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
          const pending = yield* adapter.sendTurn(attachedTurn).pipe(Effect.exit, Effect.forkChild);
          yield* Effect.promise(() => entered.promise);
          expect(Exit.isFailure(yield* Effect.exit(adapter.sendTurn(attachedTurn)))).toBe(true);
          expect(
            Exit.isFailure(
              yield* Effect.exit(adapter.sendTurn({ ...attachedTurn, attachments: [] })),
            ),
          ).toBe(true);
          yield* adapter.interruptTurn(threadId);
          expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true);
          expect(sent).toHaveLength(0);
          yield* adapter.sendTurn({ ...attachedTurn, input: "continue", attachments: [] });
          expect(sent).toHaveLength(1);
          expect(sent[0]).toMatchObject({ ...profile.fields, input: "continue", attachments: [] });
          expect(calls).toBe(1);
          yield* adapter.sendTurn(attachedTurn);
          expect(sent).toHaveLength(2);
          expect(calls).toBe(2);
        }),
    );
  }
});
