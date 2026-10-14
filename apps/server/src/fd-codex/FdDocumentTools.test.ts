import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PDF_PAGE_TOOL_SPECS, type PdfPageTools } from "../fileAnalysis/PdfPageTools.ts";
import { fdDocumentToolRuntime } from "./FdCodexAdapter.ts";

function fakeTools(execute: PdfPageTools["execute"]): PdfPageTools {
  return {
    specs: PDF_PAGE_TOOL_SPECS,
    handles: (tool) => PDF_PAGE_TOOL_SPECS.some((spec) => spec.name === tool),
    execute,
  };
}

describe("FD document tools in Codex sessions", () => {
  it.effect("registers both page tools and answers a call for the session's own thread", () =>
    Effect.gen(function* () {
      const calls: Array<{ threadId: string; tool: string; arguments: unknown }> = [];
      const runtime = fdDocumentToolRuntime(
        fakeTools(async (input) => {
          calls.push({ threadId: input.threadId, tool: input.tool, arguments: input.arguments });
          return { success: true, text: "第 2 页识别结果" };
        }),
        "thread-a",
      );
      expect(runtime.dynamicTools.map((tool) => tool.name)).toEqual([
        "fd_pdf_read_pages",
        "fd_pdf_view_pages",
      ]);
      const response = yield* runtime.dynamicToolExecutor({
        tool: "fd_pdf_view_pages",
        arguments: { document_id: "x", pages: "2" },
      });
      expect(calls).toEqual([
        {
          threadId: "thread-a",
          tool: "fd_pdf_view_pages",
          arguments: { document_id: "x", pages: "2" },
        },
      ]);
      expect(response).toEqual({
        success: true,
        contentItems: [{ type: "inputText", text: "第 2 页识别结果" }],
      });
    }),
  );

  it.effect("turns an unexpected failure into a tool error instead of failing the turn", () =>
    Effect.gen(function* () {
      const runtime = fdDocumentToolRuntime(
        fakeTools(async () => {
          throw new Error("boom");
        }),
        "thread-a",
      );
      const response = yield* runtime.dynamicToolExecutor({
        tool: "fd_pdf_read_pages",
        arguments: {},
      });
      expect(response.success).toBe(false);
      expect(response.contentItems[0]?.text).toContain("读取 PDF 页面失败");
    }),
  );
});
