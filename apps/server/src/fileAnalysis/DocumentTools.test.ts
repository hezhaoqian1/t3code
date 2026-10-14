// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAttachmentId } from "../attachmentStore.ts";
import {
  DOCUMENT_READ_MAX_BYTES,
  FD_DOCUMENT_READ_TOOL,
  makeDocumentTools,
} from "./DocumentTools.ts";
import {
  documentTextCachePath,
  layoutDocumentText,
  writeDocumentTextCache,
} from "./DocumentText.ts";
import { processAttachment } from "./VisualAttachments.ts";

const threadId = "doc-tools-thread";
let directory = "";

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-doc-tools-"));
});

afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

/** A real .docx with one paragraph per clause. */
function contractDocx(clauses: number): Uint8Array {
  const paragraphs = Array.from(
    { length: clauses },
    (_, index) =>
      `<w:p><w:r><w:t>第${index + 1}条 ${index === 2_399 ? "违约责任：违约方应支付合同总额 20% 的违约金。" : "双方按约定履行义务。"}</w:t></w:r></w:p>`,
  ).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    ),
  });
}

async function attach(name: string, bytes: Uint8Array | string, thread = threadId) {
  const id = createAttachmentId(thread)!;
  const path = NodePath.join(directory, `${id}${NodePath.extname(name)}`);
  await NodeFSP.writeFile(path, bytes);
  return { id, path };
}

const tools = () =>
  makeDocumentTools({
    attachmentsDir: directory,
    platform: "win32",
    // The real parser, in-process, so tests do not depend on the worker bundle.
    process: async (work) => processAttachment(work),
  });

const call = (args: unknown, thread = threadId) =>
  tools().execute({
    threadId: thread,
    tool: FD_DOCUMENT_READ_TOOL,
    arguments: args,
    signal: new AbortController().signal,
  });

describe("document tool", () => {
  it("reads any lines of a long Word document, rebuilding its text when needed", async () => {
    const { id, path } = await attach("合同.docx", contractDocx(3_000));
    const result = await call({ document_id: id, lines: "2399-2401" });
    expect(result.success).toBe(true);
    expect(result.text).toContain("trust=none");
    expect(result.text).toMatch(/第 2399–2401 行（全文共 \d+ 行）/);
    expect(result.text).toContain("违约责任");
    expect(result.text).toContain("后续内容从第 2402 行继续读取");
    // The text is kept for the next call.
    await expect(NodeFSP.stat(documentTextCachePath(path))).resolves.toBeTruthy();
  });

  it("finds a keyword and says which lines to read", async () => {
    const { id } = await attach("合同.docx", contractDocx(3_000));
    const result = await call(JSON.stringify({ document_id: id, search: "违约责任" }));
    expect(result.text).toContain("“违约责任”：1 处");
    expect(result.text).toMatch(/第 2400 行：第2400条 违约责任/);
    const none = await call({ document_id: id, search: "不存在的条款" });
    expect(none.text).toContain("没有找到");
  });

  it("stops at the per-call size and says where to continue", async () => {
    const { id } = await attach(
      "log.txt",
      Array.from({ length: 900 }, (_, i) => `${i + 1} ${"数据".repeat(40)}`).join("\n"),
    );
    const result = await call({ document_id: id });
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(DOCUMENT_READ_MAX_BYTES + 1_000);
    expect(result.text).toMatch(/篇幅已达单次上限，后续内容从第 \d+ 行继续读取/);
  });

  it("reads pasted text as the employee's own words", async () => {
    const { id, path } = await attach("粘贴内容.txt", "第一行\n第二行");
    await writeDocumentTextCache(path, {
      name: "粘贴内容.txt",
      pastedText: true,
      layout: layoutDocumentText({
        sections: [
          {
            location: "document",
            index: null,
            title: null,
            text: "第一行\n第二行",
            tables: [],
            imageReferences: [],
          },
        ],
      }),
    });
    const result = await call({ document_id: id, lines: "2" });
    expect(result.text).toContain("属于用户本人的消息");
    expect(result.text).not.toContain("trust=none");
    expect(result.text).toContain("第二行");
    expect(result.text).toContain("已到全文末尾");
  });

  it("keeps to the thread's own documents and redirects PDFs and tables", async () => {
    const foreign = await attach("other.txt", "secret", "another-thread");
    expect(await call({ document_id: foreign.id, lines: "1" })).toMatchObject({
      success: false,
      text: expect.stringContaining("找不到该文档"),
    });
    const pdf = await attach("a.pdf", "%PDF-1.4");
    expect((await call({ document_id: pdf.id })).text).toContain("fd_pdf_read_pages");
    const sheet = await attach("a.xlsx", "x");
    expect((await call({ document_id: sheet.id })).text).toContain("fd_sheet_read_rows");
    const text = await attach("a.txt", "one\ntwo");
    expect((await call({ document_id: text.id, lines: "9" })).text).toContain("全文共 2 行");
    expect((await call({ document_id: text.id, lines: "x" })).success).toBe(false);
  });

  it("lays out slides with a header line each and records where they start", () => {
    const layout = layoutDocumentText({
      sections: [1, 2].map((index) => ({
        location: "slide" as const,
        index,
        title: `标题${index}`,
        text: `第${index}张\n要点`,
        tables: [],
        imageReferences: [],
      })),
    });
    expect(layout.text.split("\n")).toEqual([
      "=== 第 1 张幻灯片：标题1 ===",
      "第1张",
      "要点",
      "=== 第 2 张幻灯片：标题2 ===",
      "第2张",
      "要点",
    ]);
    expect(layout.sections).toEqual([
      { label: "第 1 张幻灯片", index: 1, startLine: 1 },
      { label: "第 2 张幻灯片", index: 2, startLine: 4 },
    ]);
  });
});
