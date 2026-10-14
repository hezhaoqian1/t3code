import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { PREPARED_PROMPT_MAX_BYTES, prepareAttachments } from "./PrepareAttachments.ts";
import type { FdVisionAnalyzeInput } from "../fd-vision/FdVisionService.ts";
import { FdResponsesError } from "../fd-agent/FdResponsesProtocol.ts";
import type { DocumentContext } from "./DocumentContext.ts";
import type { PdfPageKind } from "./PdfPages.ts";
import type { ProcessedAttachment } from "./VisualAttachments.ts";

const turn = {
  threadId: ThreadId.make("test"),
  input: "分析报告",
  attachments: [
    {
      type: "document" as const,
      id: "test-00000000-0000-0000-0000-000000000001",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    },
  ],
};

describe("prepare attachments", () => {
  it("handles more than eight PDF pages using the selected Kimi model and source labels", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "kimi-k3",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => ({
        images: Array.from({ length: 12 }, (_, index) => ({
          label: `report.pdf page ${index + 1}`,
          bytes: new Uint8Array([1, 2]),
        })),
      }),
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "revenue 123";
        },
      },
    });
    expect(requests).toHaveLength(12);
    expect(
      requests.every((request) => request.model === "kimi-k3" && request.images.length === 1),
    ).toBe(true);
    expect(result.attachments).toEqual([]);
    expect(result.input).toContain("report.pdf page 12");
    expect(result.input).toContain('trust="none"');
  });

  it("uses the shared vision preprocessor for PDF pages with text models", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    let visualRequested = false;
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "glm-5.2",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async (input) => {
        visualRequested = input.visual;
        return { images: [{ label: "page 1", bytes: new Uint8Array([1]) }] };
      },
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "text";
        },
      },
    });
    expect(requests[0]?.model).toBe("deepseek-flash");
    expect(visualRequested).toBe(true);
    expect(result.input).toContain("page 1");
  });

  it("uses the selected dynamically authorized visual model on native routes", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    await prepareAttachments({
      platform: "win32",
      turn,
      model: "qwen-vl-enterprise",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => ({ images: [{ label: "page 1", bytes: new Uint8Array([1]) }] }),
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "text";
        },
      },
    });
    expect(requests[0]?.model).toBe("qwen-vl-enterprise");
  });

  it("still rejects standalone images for models without a vision route", async () => {
    const originalAttachment = turn.attachments[0]!;
    const imageTurn = {
      ...turn,
      attachments: [
        {
          type: "image" as const,
          id: originalAttachment.id,
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: originalAttachment.sizeBytes,
        },
      ],
    };
    let calls = 0;
    await expect(
      prepareAttachments({
        platform: "win32",
        turn: imageTurn,
        model: "glm-5.2",
        attachmentsDir: "/tmp/attachments",
        signal: new AbortController().signal,
        process: async () => ({ images: [{ label: "image.png", bytes: new Uint8Array([1]) }] }),
        vision: {
          analyze: async () => {
            calls++;
            return "text";
          },
        },
      }),
    ).rejects.toThrow("未开通视觉");
    expect(calls).toBe(0);
  });

  it("stops before the next page after cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      prepareAttachments({
        platform: "win32",
        turn,
        model: "kimi-k3",
        attachmentsDir: "/tmp/attachments",
        signal: controller.signal,
        process: async () => ({
          images: Array.from({ length: 3 }, () => ({ label: "page", bytes: new Uint8Array([1]) })),
        }),
        vision: {
          analyze: async () => {
            calls++;
            controller.abort();
            return "text";
          },
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

/** A parsed PDF as the worker returns it: page texts plus the page outline. */
function parsedPdf(
  kinds: ReadonlyArray<PdfPageKind>,
  text: (page: number) => string = (page) => `page ${page} revenue ${page * 100}`,
): ProcessedAttachment {
  const attachment = turn.attachments[0]!;
  const sections = kinds.map((_, offset) => ({
    location: "page" as const,
    index: offset + 1,
    title: null,
    text: text(offset + 1),
    tables: [],
    imageReferences: [],
  }));
  const context: DocumentContext = {
    attachment,
    parser: "test",
    sections,
    warnings: [],
    extractedCharacters: 0,
    truncated: false,
    ocrUsed: false,
  };
  return {
    images: [],
    context,
    pdf: {
      pageCount: kinds.length,
      pages: kinds.map((kind, offset) => ({
        index: offset + 1,
        kind,
        characters: 100,
        imageCoverage: kind === "figure" ? 0.3 : 0.01,
        title: `Section ${offset + 1}`,
      })),
      deferredScannedPages: [],
    },
  };
}

describe("PDF pages", () => {
  it("leaves chart pages to the page tool instead of recognizing them up front", async () => {
    let visionCalls = 0;
    const cached: unknown[] = [];
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "deepseek-flash",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      pageTools: true,
      process: async () => parsedPdf(["text", "figure", "figure", "text"]),
      writePageCache: async (_path, cache) => {
        cached.push(cache);
      },
      vision: {
        analyze: async () => {
          visionCalls++;
          return "unused";
        },
      },
    });
    expect(visionCalls).toBe(0);
    expect(result.input).toContain("page 4 revenue 400");
    expect(result.input).toContain(`document_id=${turn.attachments[0]!.id}`);
    expect(result.input).toContain("第 2–3 页含图表或图片");
    expect(result.input).toContain("fd_pdf_view_pages");
    expect(cached).toMatchObject([
      {
        name: "report.pdf",
        pageCount: 4,
        pages: [{ index: 1, text: "page 1 revenue 100" }, {}, {}, {}],
      },
    ]);
  });

  it("recognizes chart pages up front, within a budget, when the session has no page tools", async () => {
    const renders: Array<ReadonlyArray<number> | undefined> = [];
    const requests: FdVisionAnalyzeInput[] = [];
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "glm-5.2",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async (work) => {
        renders.push(work.renderPages);
        if (!work.renderPages) return parsedPdf(["text", "figure"]);
        return {
          images: work.renderPages.map((page) => ({
            label: `report.pdf：第 ${page}/2 页`,
            page,
            bytes: new Uint8Array([page]),
          })),
        };
      },
      writePageCache: async () => undefined,
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "chart peak 1.85";
        },
      },
    });
    expect(renders).toEqual([undefined, [2]]);
    expect(requests.map((request) => request.model)).toEqual(["deepseek-flash"]);
    expect(result.input).toContain("chart peak 1.85");
    expect(result.input).toContain("第 2 页含图表或图片，已识别");
    expect(result.input).not.toContain("fd_pdf_view_pages");
  });

  it("keeps the turn when one scanned page cannot be recognized", async () => {
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "kimi-k3",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      pageTools: true,
      process: async () => ({
        ...parsedPdf(["scanned", "scanned"]),
        images: [1, 2].map((page) => ({
          label: `report.pdf：第 ${page}/2 页`,
          page,
          bytes: new Uint8Array([page]),
        })),
      }),
      writePageCache: async () => undefined,
      vision: {
        analyze: async (request) => {
          if (String(request.userPrompt).includes("第 1/2 页"))
            throw new FdResponsesError("forbidden");
          return "scanned contract clause 7";
        },
      },
    });
    expect(result.input).toContain("scanned contract clause 7");
    expect(result.input).toContain("[本页未能识别");
    expect(result.input).toContain("[附件识别提示]");
  });

  it("sends a long PDF's first pages and lists the rest for the page tool instead of failing", async () => {
    const long = (page: number) => `第${page}页 ${"持仓明细数据".repeat(500)}`;
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "deepseek-v4-pro",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      pageTools: true,
      process: async () =>
        parsedPdf(
          Array.from({ length: 200 }, () => "text"),
          long,
        ),
      writePageCache: async () => undefined,
      vision: {
        analyze: async () => {
          throw new Error("no vision for text pages");
        },
      },
    });
    expect(Buffer.byteLength(result.input ?? "", "utf8")).toBeLessThanOrEqual(
      PREPARED_PROMPT_MAX_BYTES,
    );
    expect(result.input).toContain("第1页 ");
    expect(result.input).not.toContain("第200页 ");
    expect(result.input).toMatch(/第 \d+–200 页的文字因篇幅未放入本轮/);
    expect(result.input).toContain("fd_pdf_read_pages");
    expect(result.input).toContain("第 200 页：Section 200");
  });
});

describe("pasted text attachments", () => {
  const pastedTurn = {
    threadId: ThreadId.make("test"),
    input: "帮我找出报错原因",
    attachments: [
      {
        type: "document" as const,
        id: "test-00000000-0000-0000-0000-000000000002",
        name: "粘贴内容.txt",
        mimeType: "text/plain",
        sizeBytes: 40_000,
        source: "pasted-text" as const,
      },
    ],
  };

  it("sends a folded paste as the employee's own words without parsing it", async () => {
    const result = await prepareAttachments({
      platform: "win32",
      turn: pastedTurn,
      model: "deepseek-v4-flash",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => {
        throw new Error("pasted text must not go through the document parser");
      },
      readText: async () => "ERROR at line 42\r\nretrying",
      vision: {
        analyze: async () => {
          throw new Error("no vision for pasted text");
        },
      },
    });
    expect(result.attachments).toEqual([]);
    expect(result.input).toContain("帮我找出报错原因");
    expect(result.input).toContain('<pasted-text name="粘贴内容.txt">\nERROR at line 42\nretrying');
    expect(result.input).toContain("按用户的原话对待");
    expect(result.input).not.toContain('trust="none"');
  });
});
