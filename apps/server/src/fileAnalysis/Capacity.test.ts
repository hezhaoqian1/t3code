import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type ChatAttachment } from "@t3tools/contracts";
import type { DocumentContext, DocumentSection } from "./DocumentContext.ts";
import { PREPARED_PROMPT_MAX_BYTES, prepareAttachments } from "./PrepareAttachments.ts";
import type { ProcessedAttachment } from "./VisualAttachments.ts";

const id = (n: number) => `cap-00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const doc = (n: number, name: string, extra: Partial<ChatAttachment> = {}) =>
  ({
    type: "document",
    id: id(n),
    name,
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    ...extra,
  }) as ChatAttachment;

const attachments = [
  doc(1, "粘贴内容.txt", { source: "pasted-text" } as Partial<ChatAttachment>),
  doc(2, "合同.docx"),
  doc(3, "汇报.pptx"),
  doc(4, "年报一.pdf"),
  doc(5, "年报二.pdf"),
  doc(6, "年报三.pdf"),
  doc(7, "截图.png"),
];

function context(attachment: ChatAttachment, sections: DocumentSection[]): DocumentContext {
  return {
    attachment: attachment as DocumentContext["attachment"],
    parser: "test",
    sections,
    warnings: [],
    extractedCharacters: 0,
    truncated: false,
    ocrUsed: false,
  };
}

const section = (
  location: DocumentSection["location"],
  index: number | null,
  text: string,
): DocumentSection => ({ location, index, title: null, text, tables: [], imageReferences: [] });

/** Every attachment as large as employees send them, all in one turn. */
async function process(work: { attachment: ChatAttachment }): Promise<ProcessedAttachment> {
  const { attachment } = work;
  if (attachment.name === "合同.docx")
    return {
      images: [],
      context: context(attachment, [
        section(
          "document",
          null,
          Array.from({ length: 6_000 }, (_, line) => `第${line + 1}条 合同条款内容`).join("\n"),
        ),
      ]),
    };
  if (attachment.name === "汇报.pptx")
    return {
      images: [],
      context: context(
        attachment,
        Array.from({ length: 80 }, (_, slide) =>
          section("slide", slide + 1, `幻灯片${slide + 1} ${"业绩回顾".repeat(800)}`),
        ),
      ),
    };
  if (attachment.name.endsWith(".pdf"))
    return {
      images: Array.from({ length: 10 }, (_, page) => ({
        label: `${attachment.name}：第 ${page + 1}/300 页`,
        page: page + 1,
        bytes: new Uint8Array([1]),
      })),
      context: context(
        attachment,
        Array.from({ length: 300 }, (_, page) =>
          section("page", page + 1, `第${page + 1}页 ${"财务数据".repeat(300)}`),
        ),
      ),
      pdf: {
        pageCount: 300,
        pages: Array.from({ length: 300 }, (_, page) => ({
          index: page + 1,
          kind: page < 10 ? ("scanned" as const) : ("text" as const),
          characters: 1_200,
          imageCoverage: 0,
          title: `第 ${page + 1} 节 ${"标题".repeat(20)}`,
        })),
        deferredScannedPages: [],
      },
    };
  return {
    images: Array.from({ length: 12 }, (_, tile) => ({
      label: `${attachment.name}：分段 ${tile + 1}/12`,
      bytes: new Uint8Array([1]),
    })),
  };
}

function prepare(options: { pageTools: boolean; input?: string }) {
  const written: Array<{ path: string; pasted: boolean; lines: number }> = [];
  return {
    written,
    run: prepareAttachments({
      platform: "win32",
      turn: {
        threadId: ThreadId.make("cap"),
        input: options.input ?? "请对比这些材料，找出风险点",
        attachments,
      },
      model: "kimi-k3",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      pageTools: options.pageTools,
      process: async (work) => process(work),
      readText: async () => "日志行 ".repeat(60_000),
      writePageCache: async () => undefined,
      writeDocumentText: async (path, value) => {
        written.push({ path, pasted: value.pastedText, lines: value.layout.lineCount });
      },
      vision: { analyze: async () => `识别结果 ${"数据".repeat(2_000)}` },
    }),
  };
}

describe("turn capacity", () => {
  it("fits a worst-case turn and points at the tools for everything left out", async () => {
    const { run, written } = prepare({ pageTools: true });
    const result = await run;
    const input = result.input ?? "";
    expect(Buffer.byteLength(input, "utf8")).toBeLessThanOrEqual(PREPARED_PROMPT_MAX_BYTES);
    expect(input).toContain("请对比这些材料，找出风险点");
    // The Word body: cut at a line, with where to continue.
    expect(input).toContain("[文档附件说明]");
    expect(input).toMatch(new RegExp(`合同\\.docx（document_id=${id(2)}，全文共 6,000 行）`));
    expect(input).toMatch(/本段内容已截断：以上为全文第 1–\d+ 行/);
    // Slides: whole slides, the rest listed with the line they start at.
    expect(input).toMatch(
      /汇报\.pptx（document_id=.*）：第 \d+–80 张幻灯片未放入，从全文第 [\d,]+ 行开始/,
    );
    // Pasted text and the PDFs.
    expect(input).toMatch(
      new RegExp(`fd_document_read（document_id=${id(1)}）从第 \\d+ 行继续读取`),
    );
    expect(input).toContain("[PDF 附件说明]");
    expect(input).toContain("fd_document_read");
    expect(input).toContain("fd_pdf_read_pages");
    // Caches for the documents cut short and the paste.
    expect(
      written.map((entry) => [
        entry.path.includes(id(2)),
        entry.path.includes(id(3)),
        entry.pasted,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [true, false, false],
        [false, true, false],
        [false, false, true],
      ]),
    );
  });

  it("also fits without the tools, saying what was left out", async () => {
    const result = await prepare({ pageTools: false }).run;
    const input = result.input ?? "";
    expect(Buffer.byteLength(input, "utf8")).toBeLessThanOrEqual(PREPARED_PROMPT_MAX_BYTES);
    expect(input).not.toContain("fd_document_read");
    expect(input).toContain("不能声称已完整阅读");
  });

  it("refuses only a typed message that alone exceeds the turn", async () => {
    await expect(
      prepare({ pageTools: true, input: "很长的问题".repeat(20_000) }).run,
    ).rejects.toThrow("请把长文本保存为文件作为附件发送");
  });
});
