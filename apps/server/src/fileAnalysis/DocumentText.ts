// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import { attachmentSiblingPath } from "./AttachmentSiblings.ts";
import type { DocumentContext } from "./DocumentContext.ts";

/**
 * The full extracted text of a Word, PowerPoint, text or similar attachment,
 * one line per line, so `fd_document_read` can return any part of it after the
 * turn that attached it, however much of it fitted in that turn's prompt.
 * Stored beside the attachment and validated against its size and time.
 */
export interface DocumentTextCache {
  readonly version: 1;
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
  /** Pasted text is the employee's own message, not untrusted file content. */
  readonly pastedText: boolean;
  readonly lineCount: number;
  /** Where each page or slide starts (1-based line), for paged documents. */
  readonly sections: ReadonlyArray<{
    readonly label: string;
    readonly index: number | null;
    readonly startLine: number;
  }>;
  readonly text: string;
}

export function documentTextCachePath(attachmentPath: string): string {
  return attachmentSiblingPath(attachmentPath, "doctext");
}

function sectionLabel(location: string, index: number): string {
  return location === "slide" ? `第 ${index} 张幻灯片` : `第 ${index} 页`;
}

/**
 * Lays out a parsed document as numbered lines. Pages and slides get a header
 * line each; worksheets are left to the sheet tool and never included.
 */
export function layoutDocumentText(
  context: Pick<DocumentContext, "sections">,
): Pick<DocumentTextCache, "lineCount" | "sections" | "text"> {
  const lines: string[] = [];
  const sections: Array<DocumentTextCache["sections"][number]> = [];
  for (const section of context.sections) {
    if (section.table) continue;
    const body = section.text.replace(/\r\n?/g, "\n").split("\n");
    if (section.index !== null && (section.location === "page" || section.location === "slide")) {
      const label = sectionLabel(section.location, section.index);
      sections.push({ label, index: section.index, startLine: lines.length + 1 });
      lines.push(`=== ${label}${section.title ? `：${section.title}` : ""} ===`);
    }
    lines.push(...body);
  }
  return { lineCount: lines.length, sections, text: lines.join("\n") };
}

export async function writeDocumentTextCache(
  attachmentPath: string,
  input: {
    readonly name: string;
    readonly pastedText: boolean;
    readonly layout: Pick<DocumentTextCache, "lineCount" | "sections" | "text">;
  },
): Promise<void> {
  const stat = await NodeFSP.stat(attachmentPath);
  const value: DocumentTextCache = {
    version: 1,
    name: input.name,
    sizeBytes: stat.size,
    modifiedMs: Math.trunc(stat.mtimeMs),
    pastedText: input.pastedText,
    ...input.layout,
  };
  const target = documentTextCachePath(attachmentPath);
  const temporary = `${target}-${process.pid}-tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(value), "utf8");
  await NodeFSP.rename(temporary, target);
}

export async function readDocumentTextCache(
  attachmentPath: string,
): Promise<DocumentTextCache | undefined> {
  try {
    const [stat, raw] = await Promise.all([
      NodeFSP.stat(attachmentPath),
      NodeFSP.readFile(documentTextCachePath(attachmentPath), "utf8"),
    ]);
    const value = JSON.parse(raw) as DocumentTextCache;
    if (
      value.version !== 1 ||
      value.sizeBytes !== stat.size ||
      value.modifiedMs !== Math.trunc(stat.mtimeMs) ||
      typeof value.text !== "string"
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
