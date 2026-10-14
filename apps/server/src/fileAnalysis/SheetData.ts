// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import { attachmentSiblingPath } from "./AttachmentSiblings.ts";

/** Every row of a worksheet, exported beside the attachment for tools and code. */
export interface SheetManifest {
  readonly version: 1;
  readonly name: string;
  readonly sheets: ReadonlyArray<{
    readonly index: number;
    readonly name: string;
    readonly rows: number;
    readonly columns: number;
    readonly csvPath: string;
  }>;
}

/** Rows exported per sheet; the prompt itself carries far fewer. */
export const SHEET_EXPORT_MAX_ROWS = 200_000;

export function sheetCsvPath(attachmentPath: string, sheetIndex: number): string {
  return attachmentSiblingPath(attachmentPath, `sheet${sheetIndex}-csv`);
}

export function sheetManifestPath(attachmentPath: string): string {
  return attachmentSiblingPath(attachmentPath, "sheets");
}

/**
 * One CSV record per line: line breaks inside a cell become spaces so a row
 * can be found by line number, by tools and by simple commands alike.
 */
export function csvLine(cells: ReadonlyArray<string>): string {
  return cells
    .map((cell) => {
      const value = cell.replace(/\r\n|\r|\n/g, " ");
      return /[",]/.test(value) || value !== value.trim()
        ? `"${value.replaceAll('"', '""')}"`
        : value;
    })
    .join(",");
}

export async function readSheetManifest(
  attachmentPath: string,
): Promise<SheetManifest | undefined> {
  try {
    const value = JSON.parse(
      await NodeFSP.readFile(sheetManifestPath(attachmentPath), "utf8"),
    ) as SheetManifest;
    return value.version === 1 && Array.isArray(value.sheets) ? value : undefined;
  } catch {
    return undefined;
  }
}
