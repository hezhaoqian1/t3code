// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "@effect/vitest";

import { DocumentParseError, parseDocumentAttachment } from "./DocumentParser.ts";
import { formatDocumentContext } from "./DocumentContext.ts";

async function withTempFile(
  name: string,
  bytes: Uint8Array,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-file-analysis-"));
  const path = NodePath.join(directory, name);
  await NodeFS.writeFile(path, bytes);
  try {
    await run(path);
  } finally {
    await NodeFS.rm(directory, { recursive: true, force: true });
  }
}

function attachment(name: string, mimeType: string, sizeBytes: number) {
  return {
    type: "document" as const,
    id: "fixture-00000000-0000-0000-0000-000000000000",
    name,
    mimeType,
    sizeBytes,
  };
}

describe("DocumentParser", () => {
  it("extracts UTF-8 text without sending it through OfficeParser", async () => {
    const bytes = Buffer.from("标题\n这是本轮要分析的内容。", "utf8");
    await withTempFile("notes.txt", bytes, async (path) => {
      const context = await parseDocumentAttachment({
        attachment: attachment("notes.txt", "text/plain", bytes.byteLength),
        path,
      });
      expect(context.parser).toBe("native-utf8/txt");
      expect(context.sections[0]?.text).toContain("本轮要分析");
    });
  });

  it("extracts sheet names and cell values from a real XLSX container", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["产品", "销量"],
        ["AVQ27B", 27],
      ]),
      "销售汇总",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await withTempFile("sales.xlsx", bytes, async (path) => {
      const context = await parseDocumentAttachment({
        attachment: attachment(
          "sales.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes.byteLength,
        ),
        path,
      });
      expect(context.parser).toBe("xlsx@0.18.5");
      expect(context.sections[0]?.text).toContain("AVQ27B");
      expect(context.sections[0]?.title).toBe("销售汇总");
    });
  });

  it("rejects a renamed or corrupted XLSX before parser execution", async () => {
    const bytes = Buffer.from("this is not a zip archive", "utf8");
    await withTempFile("broken.xlsx", bytes, async (path) => {
      await expect(
        parseDocumentAttachment({
          attachment: attachment(
            "broken.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes.byteLength,
          ),
          path,
        }),
      ).rejects.toMatchObject({ code: "invalid_mime" });
    });
  });

  it("formats page, slide, and sheet sources for model citations", () => {
    const result = formatDocumentContext([
      {
        attachment: attachment("brief.pdf", "application/pdf", 1),
        parser: "test",
        sections: [
          {
            location: "page",
            index: 2,
            title: null,
            text: "页面内容",
            tables: [],
            imageReferences: [],
          },
          {
            location: "slide",
            index: 3,
            title: null,
            text: "幻灯片内容",
            tables: [],
            imageReferences: [],
          },
          {
            location: "sheet",
            index: 4,
            title: "销售汇总",
            text: "工作表内容",
            tables: [],
            imageReferences: [],
          },
        ],
        warnings: [],
        extractedCharacters: 15,
        truncated: false,
        ocrUsed: false,
      },
    ]);

    expect(result).toContain("来源：第 2 页");
    expect(result).toContain("来源：第 3 张幻灯片");
    expect(result).toContain("来源：工作表 4");
  });
});
