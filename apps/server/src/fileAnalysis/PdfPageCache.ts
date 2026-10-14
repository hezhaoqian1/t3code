// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import { attachmentSiblingPath } from "./AttachmentSiblings.ts";
import type { PdfPageSummary } from "./PdfPages.ts";

/**
 * What the page tools need after the turn that attached a PDF: the laid-out
 * text and kind of every page. Stored beside the attachment so follow-up turns
 * and app restarts do not parse the file again, and validated against the
 * attachment's size and modification time.
 */
export interface PdfPageCache {
  readonly version: 1;
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<PdfPageSummary & { readonly text: string }>;
}

export function pdfPageCachePath(attachmentPath: string): string {
  return attachmentSiblingPath(attachmentPath, "pdfpages");
}

/** Recognized text of one page image, keyed by the model that read it. */
export function pdfPageVisionCachePath(
  attachmentPath: string,
  page: number,
  model: string,
): string {
  return attachmentSiblingPath(
    attachmentPath,
    `vision-p${page}-${model.replace(/[^a-zA-Z0-9-]/g, "_")}`,
  );
}

export async function writePdfPageCache(
  attachmentPath: string,
  cache: Omit<PdfPageCache, "version" | "sizeBytes" | "modifiedMs">,
): Promise<void> {
  const stat = await NodeFSP.stat(attachmentPath);
  const value: PdfPageCache = {
    version: 1,
    sizeBytes: stat.size,
    modifiedMs: Math.trunc(stat.mtimeMs),
    ...cache,
  };
  const target = pdfPageCachePath(attachmentPath);
  const temporary = `${target}-${process.pid}-tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(value), "utf8");
  await NodeFSP.rename(temporary, target);
}

export async function readPdfPageCache(attachmentPath: string): Promise<PdfPageCache | undefined> {
  try {
    const [stat, raw] = await Promise.all([
      NodeFSP.stat(attachmentPath),
      NodeFSP.readFile(pdfPageCachePath(attachmentPath), "utf8"),
    ]);
    const value = JSON.parse(raw) as PdfPageCache;
    if (
      value.version !== 1 ||
      value.sizeBytes !== stat.size ||
      value.modifiedMs !== Math.trunc(stat.mtimeMs) ||
      !Array.isArray(value.pages) ||
      value.pages.length !== value.pageCount
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
