// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "@effect/vitest";

import { parseDocumentAttachment } from "./DocumentParser.ts";
import { formatDocumentContext } from "./DocumentContext.ts";

async function withTempFile(
  name: string,
  bytes: Uint8Array,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-file-analysis-"));
  const path = NodePath.join(directory, name);
  await NodeFSP.writeFile(path, bytes);
  try {
    await run(path);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
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
  it.each(["xls", "xlsb", "xlsm", "ods"] as const)(
    "reads real %s workbooks with sheet provenance",
    async (format) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["Product", "Sales"],
          ["Portfolio", 123],
        ]),
        "Revenue",
      );
      const bytes = XLSX.write(workbook, { type: "buffer", bookType: format }) as Buffer;
      await withTempFile(`book.${format}`, bytes, async (path) => {
        const result = await parseDocumentAttachment({
          path,
          attachment: attachment(`book.${format}`, "application/octet-stream", bytes.length),
        });
        expect(result.sections[0]?.title).toBe("Revenue");
        expect(result.sections[0]?.text).toContain("123");
      });
    },
  );

  it.each(["odt", "odp"])("reads %s text from a real OpenDocument container", async (format) => {
    const body =
      format === "odt"
        ? "<office:text><text:p>Quarterly revenue 456</text:p></office:text>"
        : '<office:presentation><draw:page draw:name="Slide 1"><draw:frame><draw:text-box><text:p>Quarterly revenue 456</text:p></draw:text-box></draw:frame></draw:page></office:presentation>';
    const bytes = zipSync({
      mimetype: strToU8(
        `application/vnd.oasis.opendocument.${format === "odt" ? "text" : "presentation"}`,
      ),
      "content.xml": strToU8(
        `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${body}</office:body></office:document-content>`,
      ),
    });
    await withTempFile(`report.${format}`, bytes, async (path) => {
      const result = await parseDocumentAttachment({
        path,
        attachment: attachment(`report.${format}`, "application/octet-stream", bytes.length),
      });
      expect(result.sections.map((section) => section.text).join("\n")).toContain(
        "Quarterly revenue 456",
      );
    });
  });

  it.each([
    ["rtf", "{\\rtf1\\ansi Quarterly revenue 789\\par}"],
    ["html", "<html><body><h1>Quarterly revenue 789</h1></body></html>"],
    ["tsv", "Quarterly\trevenue\t789"],
    ["yaml", "revenue: 789"],
    ["jsonl", '{"revenue":789}'],
  ])("reads %s content", async (format, text) => {
    const bytes = Buffer.from(text!);
    await withTempFile(`report.${format}`, bytes, async (path) => {
      const result = await parseDocumentAttachment({
        path,
        attachment: attachment(`report.${format}`, "application/octet-stream", bytes.length),
      });
      expect(result.sections.map((section) => section.text).join("\n")).toContain("789");
    });
  });

  it("reads EPUB chapters in a real container", async () => {
    const bytes = zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      "content.opf": strToU8(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Report</dc:title><dc:identifier id="id">fixture</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      ),
      "chapter.xhtml": strToU8(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>EPUB revenue 321</p></body></html>',
      ),
    });
    await withTempFile("report.epub", bytes, async (path) => {
      const result = await parseDocumentAttachment({
        path,
        attachment: attachment("report.epub", "application/epub+zip", bytes.length),
      });
      expect(result.sections.map((section) => section.text).join("\n")).toContain(
        "EPUB revenue 321",
      );
    });
  });

  it("decodes UTF-16 text and rejects binary disguised as text", async () => {
    const bytes = Buffer.from("\uFEFF中文报告", "utf16le");
    await withTempFile("report.txt", bytes, async (path) => {
      const result = await parseDocumentAttachment({
        path,
        attachment: attachment("report.txt", "text/plain", bytes.length),
      });
      expect(result.sections[0]?.text).toBe("中文报告");
    });
    const binary = Buffer.from([0, 1, 2, 0]);
    await withTempFile("binary.txt", binary, async (path) => {
      await expect(
        parseDocumentAttachment({
          path,
          attachment: attachment("binary.txt", "text/plain", binary.length),
        }),
      ).rejects.toMatchObject({ code: "invalid_mime" });
    });
  });
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
