// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAttachmentId } from "../attachmentStore.ts";
import type { FdVisionAnalyzeInput } from "../fd-vision/FdVisionService.ts";
import { pdfPageCachePath } from "./PdfPageCache.ts";
import {
  FD_PDF_READ_PAGES_TOOL,
  FD_PDF_VIEW_PAGES_TOOL,
  makePdfPageTools,
} from "./PdfPageTools.ts";
import { reportPdf } from "./testing/reportPdf.ts";
import { processAttachment } from "./VisualAttachments.ts";

const threadId = "pdf-tools-thread";
let directory = "";
let documentId = "";

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-pdf-tools-"));
  documentId = createAttachmentId(threadId)!;
  await NodeFSP.writeFile(NodePath.join(directory, `${documentId}.pdf`), await reportPdf());
});

afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

function tools(model: string | undefined, requests: FdVisionAnalyzeInput[]) {
  return makePdfPageTools({
    attachmentsDir: directory,
    platform: "win32",
    modelForThread: (id) => (id === threadId ? model : undefined),
    // The real parser, in-process, so tests do not depend on the worker bundle.
    process: async (work) => processAttachment(work),
    vision: {
      analyze: async (request) => {
        requests.push(request);
        return `recognized ${request.images.length} image`;
      },
    },
  });
}

const call = (
  pageTools: ReturnType<typeof tools>,
  tool: string,
  args: unknown,
  thread = threadId,
) =>
  pageTools.execute({
    threadId: thread,
    tool,
    arguments: args,
    signal: new AbortController().signal,
  });

describe("PDF page tools", () => {
  it("reads page text and points chart and scanned pages at the viewer", async () => {
    const pageTools = tools("deepseek-v4-pro", []);
    const result = await call(pageTools, FD_PDF_READ_PAGES_TOOL, {
      document_id: documentId,
      pages: "1-3",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("trust=none");
    expect(result.text).toContain("第 1/3 页（文字页）");
    expect(result.text).toContain("Electronics | 69.31");
    expect(result.text).toContain(`${FD_PDF_VIEW_PAGES_TOOL} 查看第 2 页`);
    expect(result.text).toContain("本页为扫描页");
    // The parsed text is cached beside the attachment for later calls.
    await expect(
      NodeFSP.stat(pdfPageCachePath(NodePath.join(directory, `${documentId}.pdf`))),
    ).resolves.toBeTruthy();
  });

  it("recognizes pages with the shared preprocessor for text-only models and caches the result", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    const pageTools = tools("deepseek-v4-pro", requests);
    const first = await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: "2",
    });
    expect(first).toMatchObject({ success: true });
    expect(first.text).toContain("第 2/3 页（画面识别，模型 deepseek-flash）");
    expect(first.text).toContain("recognized 1 image");
    expect(requests.map((request) => request.model)).toEqual(["deepseek-flash"]);
    expect(requests[0]?.images[0]?.image_url).toMatch(/^data:image\/jpeg;base64,/);

    const again = await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: 2,
    });
    expect(again.text).toContain("recognized 1 image");
    expect(requests).toHaveLength(1);
  });

  it("reads one requested value with focus and does not cache the narrow reading", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    const pageTools = tools("glm-5.2", requests);
    const focused = await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: "2",
      focus: "PE 曲线最高点的数值和日期",
    });
    expect(focused.text).toContain("画面识别：PE 曲线最高点的数值和日期");
    expect(requests[0]?.userPrompt).toContain("请从本页画面中准确读出：PE 曲线最高点的数值和日期");
    await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, { document_id: documentId, pages: "2" });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.userPrompt).toContain("请完整、准确地提取本页内容");
  });

  it("hands visual models the page images instead of a second model's reading", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    const result = await call(tools("kimi-k3", requests), FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: [2, 3],
    });
    expect(requests).toHaveLength(0);
    expect(result.success).toBe(true);
    expect(result.text).toContain("trust=none");
    expect(result.text).toContain("第 2、3 页的画面（共 3 页）");
    expect("images" in result ? result.images : undefined).toEqual([
      {
        label: expect.stringContaining("第 2/3 页"),
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      },
      {
        label: expect.stringContaining("第 3/3 页"),
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      },
    ]);
  });

  it("tells the model to use the tools rather than look for the files", () => {
    const pageTools = tools("deepseek-flash", []);
    for (const spec of pageTools.specs) expect(spec.description).toContain("不要在磁盘上搜索");
  });

  it("refuses another thread's document and explains bad page numbers", async () => {
    const pageTools = tools("deepseek-flash", []);
    const foreign = await call(
      pageTools,
      FD_PDF_READ_PAGES_TOOL,
      { document_id: documentId, pages: "1" },
      "another-thread",
    );
    expect(foreign).toMatchObject({
      success: false,
      text: expect.stringContaining("找不到该文档"),
    });
    const outside = await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: "9",
    });
    expect(outside).toMatchObject({ success: false, text: expect.stringContaining("共 3 页") });
    const tooMany = await call(pageTools, FD_PDF_VIEW_PAGES_TOOL, {
      document_id: documentId,
      pages: "1-5",
    });
    expect(tooMany).toMatchObject({ success: false });
    const malformed = await call(pageTools, FD_PDF_READ_PAGES_TOOL, "{not json");
    expect(malformed).toMatchObject({ success: false });
  });
});
