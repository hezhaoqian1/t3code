// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ThreadId, type ChatAttachment } from "@t3tools/contracts";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { formatAttachmentDocuments } from "./DocumentContext.ts";
import { parseDocumentAttachment } from "./DocumentParser.ts";
import { PREPARED_PROMPT_MAX_BYTES, prepareAttachments } from "./PrepareAttachments.ts";
import { readSheetManifest, sheetCsvPath } from "./SheetData.ts";
import { FD_SHEET_READ_ROWS_TOOL, makeSheetTools } from "./SheetTools.ts";
import { processAttachment } from "./VisualAttachments.ts";

const threadId = "sheet-thread";
let directory = "";

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-sheets-"));
});

afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

/** A holdings sheet like the ones employees attach: thousands of Chinese rows. */
function holdingsWorkbook(rows: number, sheets: ReadonlyArray<string> = ["持仓明细"]): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const name of sheets) {
    const data: Array<Array<string | number>> = [
      ["客户编号", "客户姓名", "理财师", "产品名称", "持仓金额（元）"],
    ];
    for (let row = 1; row <= rows; row++)
      data.push([
        `C${String(row).padStart(6, "0")}`,
        `客户${row}`,
        `理财师${row % 37}`,
        `鸣石未来7号量化选股${row % 5}`,
        row * 1000,
      ]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function storeWorkbook(name: string, bytes: Buffer): Promise<ChatAttachment> {
  const attachment: ChatAttachment = {
    type: "document",
    id: createAttachmentId(threadId)!,
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.length,
  };
  await NodeFSP.writeFile(resolveAttachmentPath({ attachmentsDir: directory, attachment })!, bytes);
  return attachment;
}

describe("spreadsheet attachments", () => {
  it("exports every row to CSV and keeps only a preview in the section", async () => {
    const attachment = await storeWorkbook("持仓.xlsx", holdingsWorkbook(6_000));
    const path = resolveAttachmentPath({ attachmentsDir: directory, attachment })!;
    const context = await parseDocumentAttachment({ attachment, path } as never);
    const section = context.sections[0]!;
    expect(section.table).toMatchObject({
      rows: 6_001,
      columns: 5,
      dataPath: sheetCsvPath(path, 1),
    });
    expect(section.text.split("\n")).toHaveLength(2_000);
    expect(context.warnings).toEqual([]);
    const csv = (await NodeFSP.readFile(sheetCsvPath(path, 1), "utf8")).replace(/^﻿/, "").trimEnd();
    const lines = csv.split("\n");
    expect(lines).toHaveLength(6_001);
    expect(lines[0]).toBe("客户编号,客户姓名,理财师,产品名称,持仓金额（元）");
    expect(lines.at(-1)).toBe("C006000,客户6000,理财师6,鸣石未来7号量化选股0,6000000");
    expect(await readSheetManifest(path)).toMatchObject({
      name: "持仓.xlsx",
      sheets: [{ index: 1, name: "持仓明细", rows: 6_001, columns: 5 }],
    });
  });

  it("sends three large spreadsheets within the budget instead of failing the turn", async () => {
    const attachments = [
      await storeWorkbook("方德客户画像体系.xlsx", holdingsWorkbook(3_000, ["画像", "说明"])),
      await storeWorkbook("理财师-客户仅持仓单只产品明细.xlsx", holdingsWorkbook(5_000)),
      await storeWorkbook("有持仓客户归属明细-汇总更新.xlsx", holdingsWorkbook(8_000)),
    ];
    const result = await prepareAttachments({
      platform: "win32",
      turn: { threadId: ThreadId.make(threadId), input: "补充了三个相关附件", attachments },
      model: "deepseek-flash",
      attachmentsDir: directory,
      signal: new AbortController().signal,
      pageTools: true,
      process: async (work) => processAttachment(work),
      vision: {
        analyze: async () => {
          throw new Error("spreadsheets need no vision");
        },
      },
    });
    const input = result.input ?? "";
    expect(Buffer.byteLength(input, "utf8")).toBeLessThanOrEqual(PREPARED_PROMPT_MAX_BYTES);
    // Every file got a share of the prompt, not just the first one.
    for (const name of [
      "方德客户画像体系.xlsx",
      "理财师-客户仅持仓单只产品明细.xlsx",
      "有持仓客户归属明细-汇总更新.xlsx",
    ])
      expect(input).toContain(`文件：${name}`);
    expect(input).toContain("[表格附件说明]");
    expect(input).toContain("共 8,001 行 × 5 列");
    expect(input).toContain(FD_SHEET_READ_ROWS_TOOL);
    expect(input).toContain(
      sheetCsvPath(
        resolveAttachmentPath({ attachmentsDir: directory, attachment: attachments[2]! })!,
        1,
      ),
    );
  });

  it("reads requested rows with the header and refuses another thread's file", async () => {
    const attachment = await storeWorkbook("持仓.xlsx", holdingsWorkbook(1_200, ["汇总", "明细"]));
    const tools = makeSheetTools({
      attachmentsDir: directory,
      platform: "win32",
      process: async (work) => processAttachment(work),
    });
    const call = (args: unknown, thread = threadId) =>
      tools.execute({
        threadId: thread,
        tool: FD_SHEET_READ_ROWS_TOOL,
        arguments: args,
        signal: new AbortController().signal,
      });

    // No export yet: the tool parses the workbook itself.
    const rows = await call({ document_id: attachment.id, sheet: "明细", rows: "1000-1002" });
    expect(rows.success).toBe(true);
    expect(rows.text).toContain("工作表“明细”第 1000–1002 行");
    expect(rows.text).toContain("客户编号,客户姓名,理财师,产品名称,持仓金额（元）");
    expect(rows.text).toContain("C000999,客户999");
    expect(rows.text).toContain("C001001,客户1001");
    expect(rows.text).not.toContain("C001002");

    expect(await call({ document_id: attachment.id, rows: "2-3" })).toMatchObject({
      success: false,
      text: expect.stringContaining("请指定工作表"),
    });
    expect(await call({ document_id: attachment.id, sheet: 2, rows: "1-600" })).toMatchObject({
      success: false,
      text: expect.stringContaining("最多 500 行"),
    });
    expect(
      await call({ document_id: attachment.id, sheet: "汇总", rows: "2" }, "another-thread"),
    ).toMatchObject({
      success: false,
      text: expect.stringContaining("找不到该表格"),
    });
  });

  it("gives each attachment a fair share and cuts tables at row boundaries", () => {
    const attachment = (id: string, name: string) =>
      ({ type: "document", id, name, mimeType: "text/plain", sizeBytes: 1 }) as const;
    const table = Array.from({ length: 1_000 }, (_, row) => `row ${row} ${"数据".repeat(20)}`).join(
      "\n",
    );
    const result = formatAttachmentDocuments(
      [
        {
          attachment: attachment("a", "big.xlsx"),
          parser: "test",
          sections: [
            {
              location: "sheet",
              index: 1,
              title: "表1",
              text: table,
              tables: [],
              imageReferences: [],
              table: { rows: 1_000, columns: 3, dataPath: "/tmp/a.sheet1-csv" },
            },
          ],
          warnings: [],
          extractedCharacters: table.length,
          truncated: false,
          ocrUsed: false,
        },
        {
          attachment: attachment("b", "small.txt"),
          parser: "test",
          sections: [
            {
              location: "document",
              index: null,
              title: null,
              text: "SMALL_PROOF",
              tables: [],
              imageReferences: [],
            },
          ],
          warnings: [],
          extractedCharacters: 11,
          truncated: false,
          ocrUsed: false,
        },
      ],
      { maxBytes: 20_000 },
    );
    expect(result.text).toContain("SMALL_PROOF");
    const partial = result.partialTables.get("a")![0]!;
    expect(partial.rows).toBe(1_000);
    expect(partial.includedRows).toBeGreaterThan(100);
    expect(partial.includedRows).toBeLessThan(1_000);
    // The last included row is complete.
    expect(result.text).toContain(
      `row ${partial.includedRows - 1} ${"数据".repeat(20)}\n[本表共 1000 行`,
    );
  });
});
